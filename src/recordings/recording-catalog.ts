import path from 'node:path';
import fs from 'node:fs/promises';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { IClock, systemClock } from './clock.js';
import { getRecordingsRoot, isWithinRoot } from './recordings-root.js';
import {
  IRecordingRepository,
  PrismaRecordingRepository,
} from './repositories/recording.repository.js';
import {
  PlaybackStreamUrlDto,
  RecordingDto,
  RecordingQueryParams,
  TimelineQueryParams,
  TimelineResponseDto,
  TimelineSpanDto,
} from './recording.types.js';

export interface RecordingCatalogOptions {
  repository?: IRecordingRepository;
  eventBus?: EventBus;
  clock?: IClock;
  recordingsDir?: string;
  fsStatFn?: (filePath: string) => Promise<{ size: number }>;
  fsUnlinkFn?: (filePath: string) => Promise<void>;
  fsAccessFn?: (filePath: string) => Promise<void>;
  cameraLookup?: (cameraId: string) => Promise<{ id: string; name: string; mediaMtxPath: string } | null>;
}

/** Segments closer than this are shown as one continuous span on the timeline. */
const SPAN_GAP_TOLERANCE_MS = 5_000;

export interface SegmentDeletionResult {
  success: boolean;
  recordingId: string;
  wasStale?: boolean;
  freedBytes?: number;
  error?: string;
}

export class RecordingCatalog {
  private readonly repository: IRecordingRepository;
  private readonly eventBus: EventBus;
  private readonly clock: IClock;
  private readonly recordingsRoot: string;
  private readonly fsStatFn: (filePath: string) => Promise<{ size: number }>;
  private readonly fsUnlinkFn: (filePath: string) => Promise<void>;
  private readonly fsAccessFn: (filePath: string) => Promise<void>;
  private readonly cameraLookup?: (cameraId: string) => Promise<{ id: string; name: string; mediaMtxPath: string } | null>;

  constructor(opts: RecordingCatalogOptions = {}) {
    this.repository = opts.repository || new PrismaRecordingRepository();
    this.eventBus = opts.eventBus || defaultEventBus;
    this.clock = opts.clock || systemClock;
    this.recordingsRoot = getRecordingsRoot(opts.recordingsDir);
    this.fsStatFn = opts.fsStatFn || (async (p) => fs.stat(p));
    this.fsUnlinkFn = opts.fsUnlinkFn || (async (p) => fs.unlink(p));
    this.fsAccessFn = opts.fsAccessFn || (async (p) => fs.access(p));
    this.cameraLookup = opts.cameraLookup;
  }

  /**
   * Queries catalog recordings.
   */
  async queryRecordings(params: RecordingQueryParams = {}): Promise<RecordingDto[]> {
    return this.repository.queryRecordings(params);
  }

  /**
   * Retrieves single recording by ID.
   */
  async getRecordingById(id: string): Promise<RecordingDto | null> {
    return this.repository.findRecordingById(id);
  }

  /**
   * Retrieves oldest recordings for FIFO rollover.
   */
  async getOldestRecordings(limit: number, skip = 0): Promise<RecordingDto[]> {
    return this.repository.findOldestRecordings(limit, skip);
  }

  /**
   * Internal deletion primitive with explicit filesystem and database failure semantics.
   */
  async deleteSegmentInternal(recordingId: string, rawFilePath: string, reportedSize: number = 0): Promise<SegmentDeletionResult> {
    const resolvedPath = path.resolve(rawFilePath);

    // Verify containment under normalized root (prevent directory traversal)
    if (!isWithinRoot(this.recordingsRoot, resolvedPath)) {
      throw new Error(`Directory traversal denied: path ${resolvedPath} is outside ${this.recordingsRoot}`);
    }

    // Invariant 4: No segment can be deleted from disk while its catalog still claims it is AVAILABLE.
    // Phase 1: Mark DELETE_PENDING in catalog
    await this.repository.updateRecordingStatus(recordingId, 'DELETE_PENDING');

    let freedBytes = reportedSize;

    // Phase 2: Unlink physical file on disk
    try {
      await this.fsUnlinkFn(resolvedPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File already missing on disk: delete stale catalog row
        await this.repository.deleteRecording(recordingId);
        return {
          success: true,
          recordingId,
          wasStale: true,
          freedBytes: 0,
        };
      }

      // Filesystem error (EPERM, EROFS, EBUSY):
      // Mark as GARBAGE so it is neither AVAILABLE on the timeline nor forgotten by storage
      await this.repository.updateRecordingStatus(recordingId, 'GARBAGE', `Filesystem unlink error: ${err.message}`);
      return {
        success: false,
        recordingId,
        error: `Filesystem unlink error: ${err.message}`,
      };
    }

    // Phase 3: Unlink succeeded: delete DB row
    try {
      await this.repository.deleteRecording(recordingId);
    } catch (dbErr: any) {
      await this.repository.updateRecordingStatus(recordingId, 'GARBAGE', `Database deletion failed: ${dbErr.message}`);
      return {
        success: false,
        recordingId,
        error: `Database deletion failed after file unlink: ${dbErr.message}`,
      };
    }

    return {
      success: true,
      recordingId,
      freedBytes,
    };
  }

  /**
   * Recovers segments that were in DELETE_PENDING after a crash, restart, or power loss.
   */
  async reconcilePendingDeletions(): Promise<{ recoveredCount: number; garbageCount: number }> {
    const pending = await this.repository.findRecordingsByStatus('DELETE_PENDING', 200);
    let recoveredCount = 0;
    let garbageCount = 0;

    for (const seg of pending) {
      const resolved = path.resolve(seg.filePath);
      try {
        await this.fsAccessFn(resolved);
        // File still on disk: try to unlink it
        try {
          await this.fsUnlinkFn(resolved);
          await this.repository.deleteRecording(seg.id);
          recoveredCount++;
        } catch (unlinkErr: any) {
          await this.repository.updateRecordingStatus(seg.id, 'GARBAGE', `Reconciliation unlink failed: ${unlinkErr.message}`);
          garbageCount++;
        }
      } catch {
        // File does not exist on disk: safely delete stale DB row
        await this.repository.deleteRecording(seg.id);
        recoveredCount++;
      }
    }

    return { recoveredCount, garbageCount };
  }

  /**
   * Retrieves recorded timeline spans for a 24-hour window (PLAY-01).
   */
  async getTimelineSpans(
    params: TimelineQueryParams,
    playbackBaseUrl: string
  ): Promise<TimelineResponseDto> {
    let startDate: Date;
    let endDate: Date;
    let dateStr: string;

    if (params.startTime && params.endTime) {
      startDate = new Date(params.startTime);
      endDate = new Date(params.endTime);
      dateStr = startDate.toISOString().split('T')[0];
    } else if (params.date) {
      dateStr = params.date;
      startDate = new Date(`${params.date}T00:00:00.000Z`);
      endDate = new Date(`${params.date}T23:59:59.999Z`);
    } else {
      const now = this.clock.now();
      dateStr = now.toISOString().split('T')[0];
      startDate = new Date(`${dateStr}T00:00:00.000Z`);
      endDate = new Date(`${dateStr}T23:59:59.999Z`);
    }

    const records = await this.repository.findRecordingsInRange(params.cameraId, startDate, endDate);

    // Stitch contiguous segments into continuous spans (MediaMTX writes back-to-back
    // segments; small gaps come from rounding and segment rollover).
    const spans: TimelineSpanDto[] = [];
    for (const r of records) {
      const start = new Date(r.startTime).getTime();
      const end = new Date(r.endTime).getTime();
      const last = spans[spans.length - 1];
      if (last && start - new Date(last.endTime).getTime() <= SPAN_GAP_TOLERANCE_MS) {
        const lastEnd = Math.max(new Date(last.endTime).getTime(), end);
        last.endTime = new Date(lastEnd).toISOString();
        last.durationSeconds = Math.round((lastEnd - new Date(last.startTime).getTime()) / 1000);
      } else {
        spans.push({
          recordingId: r.id,
          startTime: r.startTime,
          endTime: r.endTime,
          durationSeconds: Math.round((end - start) / 1000),
        });
      }
    }

    const totalDurationSeconds = spans.reduce((sum, s) => sum + s.durationSeconds, 0);

    return {
      cameraId: params.cameraId,
      date: dateStr,
      playbackBaseUrl,
      totalDurationSeconds,
      spans,
    };
  }

  /**
   * Resolves MediaMTX fMP4 stream URL for a camera at a given timestamp (PLAY-03).
   */
  async getPlaybackStreamUrl(
    cameraId: string,
    startTime: string,
    durationSeconds: number = 300,
    playbackBaseUrl: string
  ): Promise<PlaybackStreamUrlDto> {
    let camera = await this.repository.getCameraById(cameraId);
    if (!camera && this.cameraLookup) {
      const lookup = await this.cameraLookup(cameraId);
      if (lookup) {
        camera = { id: lookup.id, name: lookup.name, mediaMtxPath: lookup.mediaMtxPath };
        if ('registerCamera' in (this.repository as any)) {
          (this.repository as any).registerCamera(camera);
        }
      }
    }
    if (!camera) {
      throw new Error(`Camera with id ${cameraId} not found`);
    }

    const base = playbackBaseUrl.replace(/\/$/, '');
    const encodedStart = encodeURIComponent(new Date(startTime).toISOString());
    const fmp4StreamUrl = `${base}/get?path=${encodeURIComponent(camera.mediaMtxPath)}&start=${encodedStart}&duration=${durationSeconds}`;

    return {
      cameraId,
      mediaMtxPath: camera.mediaMtxPath,
      fmp4StreamUrl,
      startTime: new Date(startTime).toISOString(),
      duration: durationSeconds,
    };
  }
}
