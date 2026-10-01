import fs from 'node:fs/promises';
import path from 'node:path';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { IClock, systemClock } from './clock.js';
import { RecordingCatalog } from './recording-catalog.js';
import {
  RecordingDto,
  SegmentCompleteWebhookPayload,
} from './recording.types.js';

export interface BufferedSegment {
  id: string;
  cameraId: string;
  mediaMtxPath: string;
  segmentPath: string;
  duration: number;
  size: number;
  startTime: Date;
  endTime: Date;
  promoted: boolean;
}

export interface MotionIncidentState {
  cameraId: string;
  active: boolean;
  lastMotionAt: Date;
  postBufferUntil: Date;
  incidentStartedAt: Date;
}

export interface MotionRingBufferOptions {
  catalog: RecordingCatalog;
  eventBus?: EventBus;
  clock?: IClock;
  preBufferSeconds?: number;
  postBufferSeconds?: number;
  bufferTtlSeconds?: number;
  fsUnlinkFn?: (filePath: string) => Promise<void>;
  fsStatFn?: (filePath: string) => Promise<{ size: number }>;
}

export class MotionRingBufferEngine {
  private readonly catalog: RecordingCatalog;
  private readonly eventBus: EventBus;
  private readonly clock: IClock;
  private preBufferSeconds: number;
  private postBufferSeconds: number;
  private bufferTtlSeconds: number;
  private readonly fsUnlinkFn: (filePath: string) => Promise<void>;
  private readonly fsStatFn: (filePath: string) => Promise<{ size: number }>;

  // Per-camera ring buffers (cameraId -> BufferedSegment[])
  private readonly queues = new Map<string, BufferedSegment[]>();

  // Per-camera incident states (cameraId -> MotionIncidentState)
  private readonly incidents = new Map<string, MotionIncidentState>();

  private unsubscribeEventBus: (() => void) | null = null;

  constructor(opts: MotionRingBufferOptions) {
    this.catalog = opts.catalog;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.clock = opts.clock || systemClock;
    this.preBufferSeconds = opts.preBufferSeconds ?? 10;
    this.postBufferSeconds = opts.postBufferSeconds ?? 30;
    this.bufferTtlSeconds = opts.bufferTtlSeconds ?? 35;
    this.fsUnlinkFn = opts.fsUnlinkFn || (async (p) => fs.unlink(p));
    this.fsStatFn = opts.fsStatFn || (async (p) => fs.stat(p));

    this.subscribeToMotionEvents();
  }

  setWindowDurations(preBufferSeconds: number, postBufferSeconds: number): void {
    this.preBufferSeconds = Math.max(2, Math.min(60, preBufferSeconds));
    this.postBufferSeconds = Math.max(5, Math.min(300, postBufferSeconds));
  }

  getWindowDurations(): { preBufferSeconds: number; postBufferSeconds: number } {
    return {
      preBufferSeconds: this.preBufferSeconds,
      postBufferSeconds: this.postBufferSeconds,
    };
  }

  private subscribeToMotionEvents(): void {
    this.unsubscribeEventBus = this.eventBus.subscribe('motion.detected', async (event) => {
      const cameraId = event.cameraId;
      if (cameraId) {
        await this.triggerMotion(
          cameraId,
          event.timestamp ? new Date(event.timestamp) : this.clock.now()
        );
      }
    });
  }

  /**
   * Triggers or extends a motion incident window for a camera.
   * Immediately promotes the preceding pre-buffer segments to permanent recordings.
   */
  async triggerMotion(cameraId: string, eventTimestamp: Date = this.clock.now()): Promise<number> {
    const existing = this.incidents.get(cameraId);
    const postBufferUntil = new Date(
      eventTimestamp.getTime() + this.postBufferSeconds * 1000
    );

    const isNewIncident = !existing || !existing.active;
    const incidentState: MotionIncidentState = {
      cameraId,
      active: true,
      lastMotionAt: eventTimestamp,
      postBufferUntil,
      incidentStartedAt: isNewIncident ? eventTimestamp : existing.incidentStartedAt,
    };
    this.incidents.set(cameraId, incidentState);

    let promotedCount = 0;

    // Promote preceding pre-buffer segments
    const queue = this.queues.get(cameraId) || [];
    const preBufferCutoff = new Date(
      eventTimestamp.getTime() - this.preBufferSeconds * 1000
    );

    for (const seg of queue) {
      if (!seg.promoted && seg.endTime >= preBufferCutoff) {
        try {
          await this.catalog.ingestSegment({
            mediaMtxPath: seg.mediaMtxPath,
            segmentPath: seg.segmentPath,
            duration: seg.duration,
            size: seg.size,
            startTime: seg.startTime.toISOString(),
          });
          seg.promoted = true;
          promotedCount++;
        } catch {
          // Failure handling per segment
        }
      }
    }

    if (isNewIncident) {
      await this.eventBus.emitEvent({
        type: 'recording.incident_started',
        source: 'motion.ring_buffer',
        cameraId,
        metadata: {
          incidentStartedAt: eventTimestamp.toISOString(),
          preBufferPromotedCount: promotedCount,
          postBufferUntil: postBufferUntil.toISOString(),
        },
      });
    }

    return promotedCount;
  }

  /**
   * Processes a newly written segment from MediaMTX.
   * If motion incident is active, promotes immediately. Otherwise enqueues into ring buffer.
   */
  async handleSegment(
    payload: SegmentCompleteWebhookPayload,
    cameraId?: string
  ): Promise<{ promoted: boolean; recording?: RecordingDto }> {
    const mediaMtxPath = payload.mediaMtxPath || (payload as any).path;
    const resolvedCamId = cameraId || `camera-${mediaMtxPath}`;
    const now = this.clock.now();

    // Check if incident is currently active
    const incident = this.incidents.get(resolvedCamId);
    const isIncidentActive =
      incident && incident.active && now.getTime() < incident.postBufferUntil.getTime();

    // If cooldown has expired, close the incident
    if (incident && incident.active && now.getTime() >= incident.postBufferUntil.getTime()) {
      incident.active = false;
      await this.eventBus.emitEvent({
        type: 'recording.incident_ended',
        source: 'motion.ring_buffer',
        cameraId: resolvedCamId,
        metadata: {
          incidentEndedAt: now.toISOString(),
          totalDurationSeconds: Math.round(
            (now.getTime() - incident.incidentStartedAt.getTime()) / 1000
          ),
        },
      });
    }

    if (isIncidentActive) {
      // Direct promotion while motion/cooldown is active
      const recording = await this.catalog.ingestSegment(payload);
      return { promoted: true, recording };
    }

    // Camera is quiet: add to rolling FIFO buffer
    let size = payload.size ?? 1024 * 1024;
    try {
      const stat = await this.fsStatFn(payload.segmentPath);
      size = stat.size;
    } catch {
      // Retain default
    }

    const { startTime, endTime } = this.catalog.parseSegmentStartTime(
      payload.segmentPath,
      payload.duration,
      payload.startTime
    );

    const seg: BufferedSegment = {
      id: `buf-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      cameraId: resolvedCamId,
      mediaMtxPath,
      segmentPath: payload.segmentPath,
      duration: payload.duration,
      size,
      startTime,
      endTime,
      promoted: false,
    };

    let queue = this.queues.get(resolvedCamId);
    if (!queue) {
      queue = [];
      this.queues.set(resolvedCamId, queue);
    }
    queue.push(seg);

    // Prune expired unpromoted segments from disk
    await this.pruneQueue(resolvedCamId);

    return { promoted: false };
  }

  /**
   * Prunes unpromoted segments older than bufferTtlSeconds from queue and disk.
   */
  async pruneQueue(cameraId: string): Promise<number> {
    const queue = this.queues.get(cameraId);
    if (!queue || queue.length === 0) return 0;

    const now = this.clock.now();
    const ttlCutoff = new Date(now.getTime() - this.bufferTtlSeconds * 1000);

    let prunedCount = 0;
    const remaining: BufferedSegment[] = [];

    for (const seg of queue) {
      if (seg.endTime >= ttlCutoff) {
        remaining.push(seg); // Still inside the pre-buffer window
      } else if (seg.promoted) {
        // Catalogued as a permanent recording; drop from the in-memory queue only
      } else {
        // Expired and unpromoted: unlink from disk
        try {
          await this.fsUnlinkFn(seg.segmentPath);
        } catch {
          // File may already be unlinked
        }
        prunedCount++;
      }
    }

    this.queues.set(cameraId, remaining);
    return prunedCount;
  }

  /**
   * Returns current buffer diagnostics across cameras or for a single camera.
   */
  getBufferStatus(cameraId?: string): {
    totalBufferedSegments: number;
    totalBufferedBytes: number;
    activeIncidentsCount: number;
    cameras: Array<{
      cameraId: string;
      bufferedSegmentsCount: number;
      bufferedBytes: number;
      incidentActive: boolean;
      postBufferRemainingSeconds: number;
    }>;
  } {
    const now = this.clock.now();
    const results: Array<{
      cameraId: string;
      bufferedSegmentsCount: number;
      bufferedBytes: number;
      incidentActive: boolean;
      postBufferRemainingSeconds: number;
    }> = [];

    const camIds = cameraId
      ? [cameraId]
      : Array.from(new Set([...this.queues.keys(), ...this.incidents.keys()]));

    let totalSegments = 0;
    let totalBytes = 0;
    let activeIncidents = 0;

    for (const id of camIds) {
      const q = this.queues.get(id) || [];
      const incident = this.incidents.get(id);
      const isActive = Boolean(
        incident && incident.active && now.getTime() < incident.postBufferUntil.getTime()
      );
      const remainingSeconds = isActive
        ? Math.max(0, Math.round((incident!.postBufferUntil.getTime() - now.getTime()) / 1000))
        : 0;

      const bytes = q.reduce((acc, s) => acc + s.size, 0);

      totalSegments += q.length;
      totalBytes += bytes;
      if (isActive) activeIncidents++;

      results.push({
        cameraId: id,
        bufferedSegmentsCount: q.length,
        bufferedBytes: bytes,
        incidentActive: isActive,
        postBufferRemainingSeconds: remainingSeconds,
      });
    }

    return {
      totalBufferedSegments: totalSegments,
      totalBufferedBytes: totalBytes,
      activeIncidentsCount: activeIncidents,
      cameras: results,
    };
  }

  clear(): void {
    if (this.unsubscribeEventBus) {
      this.unsubscribeEventBus();
      this.unsubscribeEventBus = null;
    }
    this.queues.clear();
    this.incidents.clear();
  }
}
