import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { MediaMtxClient, mediaMtxClient as defaultMediaMtx } from '../mediamtx/mediamtx.client.js';
import { IClock, systemClock } from './clock.js';
import { RecordingCatalog } from './recording-catalog.js';
import { RecordingSchedulerCollaborator } from './recording-scheduler.js';
import {
  CameraScheduleConfig,
  IRecordingEngine,
  PlaybackStreamUrlDto,
  RecordingDto,
  RecordingMode,
  RecordingQueryParams,
  ScheduleWindow,
  SegmentCompleteWebhookPayload,
  StorageCleanupResult,
  StorageMetricsDto,
  TimelineQueryParams,
  TimelineResponseDto,
} from './recording.types.js';
import {
  InMemoryRecordingRepository,
  IRecordingRepository,
  PrismaRecordingRepository,
} from './repositories/recording.repository.js';
import { StorageController } from './storage-controller.js';
import { MotionRingBufferEngine } from './motion-ring-buffer.js';

export interface RecordingEngineOptions {
  repository?: IRecordingRepository;
  mediaMtx?: MediaMtxClient;
  eventBus?: EventBus;
  clock?: IClock;
  recordingsDir?: string;
  warningThresholdPercent?: number;
  criticalThresholdPercent?: number;
  targetThresholdPercent?: number;
  preBufferSeconds?: number;
  postBufferSeconds?: number;
  batchSize?: number;
  scheduleIntervalMs?: number;
  storageIntervalMs?: number;
  statfsFn?: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;
  fsStatFn?: (filePath: string) => Promise<{ size: number }>;
  fsUnlinkFn?: (filePath: string) => Promise<void>;
  playbackBaseUrl?: string;
  cameraLookup?: (cameraId: string) => Promise<{ id: string; name: string; mediaMtxPath: string } | null>;
}

export class RecordingEngine implements IRecordingEngine {
  private readonly repository: IRecordingRepository;
  private readonly catalog: RecordingCatalog;
  private readonly scheduler: RecordingSchedulerCollaborator;
  private readonly storageController: StorageController;
  private readonly motionRingBuffer: MotionRingBufferEngine;
  private readonly clock: IClock;
  private readonly playbackBaseUrl: string;

  private isRunning = false;
  private scheduleTimerId?: NodeJS.Timeout;
  private storageTimerId?: NodeJS.Timeout;

  private readonly scheduleIntervalMs: number;
  private readonly storageIntervalMs: number;

  // Single-flight protection flags
  private isEvaluatingSchedule = false;
  private isCheckingStorage = false;

  constructor(opts: RecordingEngineOptions = {}) {
    const repository = opts.repository || new PrismaRecordingRepository();
    this.repository = repository;
    const mediaMtx = opts.mediaMtx || defaultMediaMtx;
    const eventBus = opts.eventBus || defaultEventBus;
    this.clock = opts.clock || systemClock;
    this.playbackBaseUrl =
      opts.playbackBaseUrl ||
      process.env.MEDIAMTX_PLAYBACK_BASE_URL ||
      'http://localhost:9996';

    const cameraLookup =
      opts.cameraLookup ||
      (async (id: string) => {
        try {
          const { cameraService } = await import('../cameras/camera.service.js');
          return await cameraService.getCameraById(id);
        } catch {
          return null;
        }
      });

    this.scheduleIntervalMs = opts.scheduleIntervalMs ?? 60_000;
    this.storageIntervalMs = opts.storageIntervalMs ?? 60_000;

    this.catalog = new RecordingCatalog({
      repository,
      eventBus,
      clock: this.clock,
      recordingsDir: opts.recordingsDir,
      fsStatFn: opts.fsStatFn,
      fsUnlinkFn: opts.fsUnlinkFn,
      cameraLookup,
    });

    eventBus.subscribe('camera.online', (evt: any) => {
      if (evt.cameraId && evt.metadata?.mediaMtxPath) {
        if ('registerCamera' in (repository as any)) {
          (repository as any).registerCamera({
            id: evt.cameraId,
            name: evt.metadata.name || evt.cameraId,
            mediaMtxPath: evt.metadata.mediaMtxPath,
          });
        }
      }
    });

    this.scheduler = new RecordingSchedulerCollaborator({
      repository,
      mediaMtx,
      eventBus,
      clock: this.clock,
    });

    this.storageController = new StorageController({
      catalog: this.catalog,
      eventBus,
      recordingsDir: opts.recordingsDir,
      warningThresholdPercent: opts.warningThresholdPercent,
      criticalThresholdPercent: opts.criticalThresholdPercent,
      targetThresholdPercent: opts.targetThresholdPercent,
      batchSize: opts.batchSize,
      statfsFn: opts.statfsFn,
    });

    this.motionRingBuffer = new MotionRingBufferEngine({
      catalog: this.catalog,
      eventBus,
      clock: this.clock,
      preBufferSeconds: opts.preBufferSeconds,
      postBufferSeconds: opts.postBufferSeconds,
      fsUnlinkFn: opts.fsUnlinkFn,
      fsStatFn: opts.fsStatFn,
    });
  }

  // ==========================================
  // Public Seam Methods
  // ==========================================

  async ingestSegment(payload: SegmentCompleteWebhookPayload): Promise<RecordingDto | null> {
    const mediaMtxPath = payload.mediaMtxPath || (payload as any).path;
    let camera = await this.repository.getCameraByMediaMtxPath(mediaMtxPath);
    let isMotionOnly = false;

    if (camera) {
      try {
        const schedule = await this.scheduler.getCameraSchedule(camera.id);
        if (schedule.mode === 'MOTION_ONLY') {
          isMotionOnly = true;
        }
      } catch {
        // Fallback
      }
    }

    if (isMotionOnly && camera) {
      const res = await this.motionRingBuffer.handleSegment(payload, camera.id);
      return res.recording || null;
    }

    return this.catalog.ingestSegment(payload);
  }

  getMotionRingBuffer(): MotionRingBufferEngine {
    return this.motionRingBuffer;
  }

  async queryRecordings(params: RecordingQueryParams = {}): Promise<RecordingDto[]> {
    return this.catalog.queryRecordings(params);
  }

  async getRecordingById(id: string): Promise<RecordingDto | null> {
    return this.catalog.getRecordingById(id);
  }

  async getSchedule(cameraId: string): Promise<CameraScheduleConfig> {
    return this.scheduler.getCameraSchedule(cameraId);
  }

  async setSchedule(
    cameraId: string,
    mode: RecordingMode = 'SCHEDULED',
    windows: ScheduleWindow[] = []
  ): Promise<CameraScheduleConfig> {
    return this.scheduler.setCameraSchedule(cameraId, mode, windows);
  }

  async getTimelineSpans(params: TimelineQueryParams): Promise<TimelineResponseDto> {
    return this.catalog.getTimelineSpans(params, this.playbackBaseUrl);
  }

  async getPlaybackStreamUrl(
    cameraId: string,
    startTime: string,
    durationSeconds: number = 300
  ): Promise<PlaybackStreamUrlDto> {
    return this.catalog.getPlaybackStreamUrl(cameraId, startTime, durationSeconds, this.playbackBaseUrl);
  }

  async getStorageStatus(): Promise<StorageMetricsDto> {
    return this.storageController.getStorageMetrics();
  }

  async runStorageCleanup(): Promise<StorageCleanupResult> {
    return this.storageController.checkStorage();
  }

  async purgeRetention(days?: number): Promise<{ deletedSegmentsCount: number; freedBytes: number }> {
    return this.storageController.purgeRetention(days);
  }

  getStorageController(): StorageController {
    return this.storageController;
  }

  // ==========================================
  // Lifecycle & Worker Ownership
  // ==========================================

  /**
   * Starts background loops with immediate reconciliation and single-flight protection.
   * Idempotent: multiple calls will not leak timers or run duplicate workers.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    // 1. Initial boot reconciliation (deterministic boot without waiting 60s)
    await this.tickSchedule();
    await this.tickStorage();

    // 2. Launch periodic loops
    this.scheduleTimerId = this.clock.setInterval(async () => {
      await this.tickSchedule();
    }, this.scheduleIntervalMs);

    this.storageTimerId = this.clock.setInterval(async () => {
      await this.tickStorage();
    }, this.storageIntervalMs);
  }

  /**
   * Stops background loops and clears active timers.
   * Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;

    if (this.scheduleTimerId) {
      this.clock.clearInterval(this.scheduleTimerId);
      this.scheduleTimerId = undefined;
    }

    if (this.storageTimerId) {
      this.clock.clearInterval(this.storageTimerId);
      this.storageTimerId = undefined;
    }
  }

  /**
   * Single-flight execution of schedule evaluation tick.
   */
  private async tickSchedule(): Promise<void> {
    if (this.isEvaluatingSchedule) {
      return; // Skip overlapping tick
    }
    this.isEvaluatingSchedule = true;
    try {
      await this.scheduler.evaluateAllCameras(this.clock.now());
    } catch {
      // Tolerate tick errors without crashing process
    } finally {
      this.isEvaluatingSchedule = false;
    }
  }

  /**
   * Single-flight execution of storage monitoring tick.
   */
  private async tickStorage(): Promise<void> {
    if (this.isCheckingStorage) {
      return; // Skip overlapping tick
    }
    this.isCheckingStorage = true;
    try {
      await this.storageController.checkStorage();
    } catch {
      // Tolerate tick errors without crashing process
    } finally {
      this.isCheckingStorage = false;
    }
  }

  // Helpers for testing
  isActive(): boolean {
    return this.isRunning;
  }

  isCameraRecording(cameraId: string): boolean {
    return this.scheduler.isRecording(cameraId);
  }
}

export const recordingEngine = new RecordingEngine();
export default recordingEngine;
