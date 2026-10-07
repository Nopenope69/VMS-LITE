import fs from 'node:fs/promises';
import path from 'node:path';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { IClock, systemClock } from './clock.js';
import { CameraRecordSummary, IRecordingRepository } from './repositories/recording.repository.js';
import { RecordingDto, RecordingMode, SegmentStatusType } from './recording.types.js';
import { parseSegmentFileTime, SegmentValidator } from './segment-validator.js';

const SEGMENT_FILE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d{1,6})?\.mp4$/;
const MAX_BUFFERED_SCAN = 5_000;

export interface SegmentIngestOptions {
  repository: IRecordingRepository;
  recordingsRoot: string;
  /** Removes a catalogued segment through the catalog's two-phase delete. */
  deleteSegment: (recording: RecordingDto) => Promise<unknown>;
  eventBus?: EventBus;
  clock?: IClock;
  validator?: SegmentValidator;
  /** The newest file of a camera is complete once it has not been written for this long. */
  quietPeriodMs?: number;
  preBufferSeconds?: number;
  postBufferSeconds?: number;
  /** How late a motion event may arrive and still keep a Motion Buffer segment. */
  lateMotionGraceSeconds?: number;
}

export interface MotionBufferStatus {
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
}

/**
 * Segment Ingest: the only way a Video Segment enters the catalog.
 *
 * Each scan walks every camera's directory on the recordings volume (MediaMTX has no
 * completion hook in this deployment) and gives each finished file exactly one fate:
 * - AVAILABLE: valid, and the camera records continuously or motion is near it
 * - BUFFERED: valid, but the camera is MOTION_ONLY and no motion is near it yet
 * - QUARANTINED: failed validation; kept in the catalog so FIFO rollover reclaims it
 *
 * Every outcome is a catalog row, so the newest row is a restart-safe resume point and
 * no file is ever left on disk uncatalogued. Motion Buffer decisions use segment time
 * against persisted motion events, never processing time.
 */
export class SegmentIngest {
  private readonly repository: IRecordingRepository;
  private readonly recordingsRoot: string;
  private readonly deleteSegment: (recording: RecordingDto) => Promise<unknown>;
  private readonly eventBus: EventBus;
  private readonly clock: IClock;
  private readonly validator: SegmentValidator;
  private readonly quietPeriodMs: number;
  private readonly lateMotionGraceSeconds: number;
  private preBufferSeconds: number;
  private postBufferSeconds: number;
  /** Start time of the newest handled segment per camera; a cache of the catalog. */
  private readonly watermarks = new Map<string, number>();

  constructor(opts: SegmentIngestOptions) {
    this.repository = opts.repository;
    this.recordingsRoot = opts.recordingsRoot;
    this.deleteSegment = opts.deleteSegment;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.clock = opts.clock || systemClock;
    this.quietPeriodMs = opts.quietPeriodMs ?? 15_000;
    this.lateMotionGraceSeconds = opts.lateMotionGraceSeconds ?? 30;
    this.preBufferSeconds = opts.preBufferSeconds ?? 10;
    this.postBufferSeconds = opts.postBufferSeconds ?? 30;
    this.validator =
      opts.validator ||
      new SegmentValidator({ recordingsRoot: this.recordingsRoot, now: () => this.clock.now().getTime() });
  }

  /** Catalogues every finished segment on disk, then expires stale Motion Buffer segments. */
  async scan(): Promise<number> {
    const cameras = await this.repository.listAllCameras();
    let catalogued = 0;
    for (const camera of cameras) {
      try {
        catalogued += await this.scanCamera(camera);
      } catch (err) {
        console.warn(`[SegmentIngest] Scan failed for camera ${camera.id}: ${(err as Error).message}`);
      }
    }
    await this.expireBufferedSegments();
    return catalogued;
  }

  /** Keeps every Motion Buffer segment near a motion event. Returns how many were kept. */
  async onMotion(cameraId: string, at: Date): Promise<number> {
    const buffered = await this.repository.findRecordingsInRange(
      cameraId,
      new Date(at.getTime() - this.preBufferSeconds * 1000),
      new Date(at.getTime() + this.postBufferSeconds * 1000),
      'BUFFERED'
    );
    for (const segment of buffered) {
      const kept = await this.repository.updateRecordingStatus(segment.id, 'AVAILABLE');
      if (kept) await this.emitSegmentCreated(kept);
    }
    return buffered.length;
  }

  async bufferStatus(cameraId?: string): Promise<MotionBufferStatus> {
    const buffered = (await this.repository.findRecordingsByStatus('BUFFERED', MAX_BUFFERED_SCAN)).filter(
      (r) => !cameraId || r.cameraId === cameraId
    );
    const cameraIds = cameraId ? [cameraId] : Array.from(new Set(buffered.map((r) => r.cameraId)));
    const now = this.clock.now().getTime();

    const cameras = await Promise.all(
      cameraIds.map(async (id) => {
        const segments = buffered.filter((r) => r.cameraId === id);
        const recentMotion = await this.repository.findMotionTimes(
          id,
          new Date(now - this.postBufferSeconds * 1000),
          new Date(now)
        );
        const lastMotion = recentMotion.length ? recentMotion[recentMotion.length - 1].getTime() : null;
        return {
          cameraId: id,
          bufferedSegmentsCount: segments.length,
          bufferedBytes: segments.reduce((sum, s) => sum + Number(s.sizeBytes || 0), 0),
          incidentActive: lastMotion !== null,
          postBufferRemainingSeconds:
            lastMotion === null ? 0 : Math.max(0, Math.round((lastMotion + this.postBufferSeconds * 1000 - now) / 1000)),
        };
      })
    );

    return {
      totalBufferedSegments: cameras.reduce((sum, c) => sum + c.bufferedSegmentsCount, 0),
      totalBufferedBytes: cameras.reduce((sum, c) => sum + c.bufferedBytes, 0),
      activeIncidentsCount: cameras.filter((c) => c.incidentActive).length,
      cameras,
    };
  }

  setMotionWindow(preBufferSeconds: number, postBufferSeconds: number): void {
    this.preBufferSeconds = Math.max(2, Math.min(60, preBufferSeconds));
    this.postBufferSeconds = Math.max(5, Math.min(300, postBufferSeconds));
  }

  getMotionWindow(): { preBufferSeconds: number; postBufferSeconds: number } {
    return { preBufferSeconds: this.preBufferSeconds, postBufferSeconds: this.postBufferSeconds };
  }

  forgetCamera(cameraId: string): void {
    this.watermarks.delete(cameraId);
  }

  private async scanCamera(camera: CameraRecordSummary): Promise<number> {
    const dir = path.join(this.recordingsRoot, camera.mediaMtxPath);
    let names: string[];
    try {
      names = (await fs.readdir(dir)).filter((n) => SEGMENT_FILE.test(n));
    } catch (err: any) {
      if (err.code === 'ENOENT') return 0; // Nothing recorded yet
      throw err;
    }
    names.sort(); // Timestamped names sort chronologically

    if (!this.watermarks.has(camera.id)) {
      const latest = await this.repository.findLatestStartTime(camera.id);
      this.watermarks.set(camera.id, latest ? latest.getTime() : -Infinity);
    }
    const watermark = this.watermarks.get(camera.id)!;
    let mode: RecordingMode | undefined;

    let catalogued = 0;
    for (let i = 0; i < names.length; i++) {
      const start = parseSegmentFileTime(names[i]);
      if (!start || start.getTime() <= watermark) continue;

      const filePath = path.join(dir, names[i]);
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue; // Removed between readdir and stat
      }

      // The newest file may still be written; MediaMTX flushes a part every second
      const hasNewer = i < names.length - 1;
      if (!hasNewer && this.clock.now().getTime() - stat.mtimeMs < this.quietPeriodMs) {
        break;
      }

      mode ??= (await this.repository.getCameraSchedule(camera.id)).mode;
      const duration = Math.max(0.1, Math.round(stat.mtimeMs - start.getTime()) / 1000);
      if (await this.catalogueFile(camera, filePath, start, duration, mode)) catalogued++;
      this.watermarks.set(camera.id, start.getTime());
    }
    return catalogued;
  }

  /** Writes the one catalog row for a finished file. Returns null when the file is gone. */
  private async catalogueFile(
    camera: CameraRecordSummary,
    filePath: string,
    start: Date,
    duration: number,
    mode: RecordingMode
  ): Promise<RecordingDto | null> {
    const existing = await this.repository.findRecordingByFilePath(filePath);
    if (existing) return existing;

    const validation = await this.validator.validate({
      filePath,
      recordingsRoot: this.recordingsRoot,
      mediaMtxPath: camera.mediaMtxPath,
      duration,
      payloadStartTime: start.toISOString(),
      quietPeriodMs: 0,
    });

    const base = {
      cameraId: camera.id,
      mediaMtxPath: camera.mediaMtxPath,
      filePath,
      fileName: path.basename(filePath),
      format: 'fmp4',
      retentionTier: 'CONTINUOUS' as const,
      isProtected: false,
      validatedAt: this.clock.now(),
    };

    if (!validation.isValid) {
      if (validation.reason === 'FILE_NOT_FOUND' || validation.reason === 'OUTSIDE_ROOT') return null;
      console.warn(`[SegmentIngest] Segment quarantined for camera ${camera.id}: ${validation.reason} ${validation.error || ''}`);
      let sizeBytes = 0;
      try {
        sizeBytes = (await fs.stat(filePath)).size;
      } catch {
        // Size unknown
      }
      return this.repository.createRecording({
        ...base,
        startTime: start,
        endTime: new Date(start.getTime() + Math.round(duration * 1000)),
        duration,
        sizeBytes,
        status: 'QUARANTINED',
        errorReason: `${validation.reason}${validation.error ? `: ${validation.error}` : ''}`,
      });
    }

    const status: SegmentStatusType =
      mode === 'MOTION_ONLY' && !(await this.isNearMotion(camera.id, validation.startTime, validation.endTime))
        ? 'BUFFERED'
        : 'AVAILABLE';

    const recording = await this.repository.createRecording({
      ...base,
      startTime: validation.startTime,
      endTime: validation.endTime,
      duration: validation.duration,
      sizeBytes: validation.sizeBytes,
      streamRole: validation.streamRole,
      status,
      videoCodec: validation.videoCodec,
      hasAudio: validation.hasAudio,
      sha256: validation.sha256,
    });
    if (status === 'AVAILABLE') await this.emitSegmentCreated(recording, camera);
    return recording;
  }

  /** True when a motion event falls within [start - post-buffer, end + pre-buffer]. */
  private async isNearMotion(cameraId: string, start: Date, end: Date): Promise<boolean> {
    const motion = await this.repository.findMotionTimes(
      cameraId,
      new Date(start.getTime() - this.postBufferSeconds * 1000),
      new Date(end.getTime() + this.preBufferSeconds * 1000)
    );
    return motion.length > 0;
  }

  /** Deletes Motion Buffer segments that no motion event can still keep. */
  private async expireBufferedSegments(): Promise<void> {
    const cutoff = this.clock.now().getTime() - (this.preBufferSeconds + this.lateMotionGraceSeconds) * 1000;
    const buffered = await this.repository.findRecordingsByStatus('BUFFERED', MAX_BUFFERED_SCAN);
    for (const segment of buffered) {
      if (new Date(segment.endTime).getTime() >= cutoff) continue;
      try {
        await this.deleteSegment(segment);
      } catch (err) {
        console.warn(`[SegmentIngest] Could not expire buffered segment ${segment.id}: ${(err as Error).message}`);
      }
    }
  }

  private async emitSegmentCreated(recording: RecordingDto, camera?: CameraRecordSummary): Promise<void> {
    const owner = camera || (await this.repository.getCameraById(recording.cameraId));
    await this.eventBus.emitEvent({
      type: 'recording.segment_created',
      source: 'recording.engine',
      cameraId: recording.cameraId,
      metadata: {
        recordingId: recording.id,
        cameraId: recording.cameraId,
        siteId: (owner as any)?.siteId ?? null,
        mediaMtxPath: recording.mediaMtxPath,
        filePath: recording.filePath,
        storageUri: `file://${path.resolve(recording.filePath)}`,
        duration: recording.duration,
        sizeBytes: Number(recording.sizeBytes),
        startTime: recording.startTime,
        endTime: recording.endTime,
        format: recording.format || 'fmp4',
        streamRole: recording.streamRole || 'PRIMARY',
        status: recording.status || 'AVAILABLE',
        retentionTier: recording.retentionTier || 'CONTINUOUS',
        isProtected: recording.isProtected ?? false,
      },
    });
  }
}
