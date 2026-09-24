import path from 'node:path';
import fs from 'node:fs/promises';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { IClock, systemClock } from './clock.js';
import {
  IRecordingRepository,
  PrismaRecordingRepository,
} from './repositories/recording.repository.js';
import {
  RecordingDto,
  RecordingQueryParams,
  SegmentCompleteWebhookPayload,
} from './recording.types.js';

export interface RecordingCatalogOptions {
  repository?: IRecordingRepository;
  eventBus?: EventBus;
  clock?: IClock;
  recordingsDir?: string;
  fsStatFn?: (filePath: string) => Promise<{ size: number }>;
  fsUnlinkFn?: (filePath: string) => Promise<void>;
}

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

  constructor(opts: RecordingCatalogOptions = {}) {
    this.repository = opts.repository || new PrismaRecordingRepository();
    this.eventBus = opts.eventBus || defaultEventBus;
    this.clock = opts.clock || systemClock;
    this.recordingsRoot = path.resolve(
      opts.recordingsDir || process.env.RECORDINGS_PATH || '/var/recordings'
    );
    this.fsStatFn = opts.fsStatFn || (async (p) => fs.stat(p));
    this.fsUnlinkFn = opts.fsUnlinkFn || (async (p) => fs.unlink(p));
  }

  /**
   * Deterministically parses segment timestamp from filename or payload.
   * Format example: 2026-09-24_16-40-00.mp4
   */
  parseSegmentStartTime(segmentPath: string, duration: number, payloadStartTime?: string): { startTime: Date; endTime: Date } {
    if (payloadStartTime) {
      const parsed = new Date(payloadStartTime);
      if (!isNaN(parsed.getTime())) {
        return {
          startTime: parsed,
          endTime: new Date(parsed.getTime() + duration * 1000),
        };
      }
    }

    const match = segmentPath.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day, hour, min, sec] = match;
      const startTime = new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec));
      if (!isNaN(startTime.getTime())) {
        return {
          startTime,
          endTime: new Date(startTime.getTime() + duration * 1000),
        };
      }
    }

    // Fallback: derive from clock
    const endTime = this.clock.now();
    const startTime = new Date(endTime.getTime() - duration * 1000);
    return { startTime, endTime };
  }

  /**
   * Catalogs a completed video segment notification from MediaMTX.
   */
  async ingestSegment(payload: SegmentCompleteWebhookPayload): Promise<RecordingDto> {
    const mediaMtxPath = payload.mediaMtxPath || (payload as any).path;
    let camera = await this.repository.getCameraByMediaMtxPath(mediaMtxPath);

    if (!camera) {
      try {
        const { cameraService } = await import('../cameras/camera.service.js');
        const cams = await cameraService.listCameras();
        const found = cams.find((c) => c.mediaMtxPath === mediaMtxPath);
        if (found) {
          camera = { id: found.id, name: found.name, mediaMtxPath: found.mediaMtxPath };
        }
      } catch {
        // Ignored
      }
    }

    const cameraId = camera ? camera.id : `camera-${mediaMtxPath}`;
    const fileName = path.basename(payload.segmentPath);

    let sizeBytes = payload.size ?? 1024 * 1024;
    try {
      const stat = await this.fsStatFn(payload.segmentPath);
      sizeBytes = stat.size;
    } catch {
      // Retain existing size
    }

    const { startTime, endTime } = this.parseSegmentStartTime(
      payload.segmentPath,
      payload.duration,
      payload.startTime
    );

    const recording = await this.repository.createRecording({
      cameraId,
      mediaMtxPath,
      filePath: payload.segmentPath,
      fileName,
      startTime,
      endTime,
      duration: payload.duration,
      sizeBytes,
      format: 'fmp4',
    });

    await this.eventBus.emitEvent({
      type: 'recording.segment_created',
      source: 'recording.engine',
      cameraId,
      metadata: {
        recordingId: recording.id,
        mediaMtxPath: payload.mediaMtxPath,
        filePath: payload.segmentPath,
        duration: payload.duration,
        sizeBytes: Number(recording.sizeBytes),
        startTime: recording.startTime,
        endTime: recording.endTime,
      },
    });

    return recording;
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
  async getOldestRecordings(limit: number): Promise<RecordingDto[]> {
    return this.repository.findOldestRecordings(limit);
  }

  /**
   * Internal deletion primitive with explicit filesystem and database failure semantics.
   */
  async deleteSegmentInternal(recordingId: string, rawFilePath: string, reportedSize: number = 0): Promise<SegmentDeletionResult> {
    const resolvedPath = path.resolve(rawFilePath);

    // Verify containment under normalized root (prevent directory traversal)
    if (!resolvedPath.startsWith(this.recordingsRoot + path.sep) && resolvedPath !== this.recordingsRoot) {
      throw new Error(`Directory traversal denied: path ${resolvedPath} is outside ${this.recordingsRoot}`);
    }

    let freedBytes = reportedSize;

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

      // Other filesystem error: DO NOT delete catalog row, report failure
      return {
        success: false,
        recordingId,
        error: `Filesystem unlink error: ${err.message}`,
      };
    }

    // Unlink succeeded: delete DB row
    try {
      await this.repository.deleteRecording(recordingId);
    } catch (dbErr: any) {
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
}
