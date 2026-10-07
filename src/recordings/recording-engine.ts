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
import { StorageInvariantsService } from './storage-invariants.service.js';
import { MotionBufferStatus, SegmentIngest } from './segment-ingest.js';
import { getRecordingsRoot } from './recordings-root.js';

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
  indexIntervalMs?: number;
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
  private readonly segmentIngest: SegmentIngest;
  private readonly invariants: StorageInvariantsService;
  private readonly clock: IClock;
  private readonly playbackBaseUrl: string;

  private isRunning = false;
  private scheduleTimerId?: NodeJS.Timeout;
  private storageTimerId?: NodeJS.Timeout;
  private indexTimerId?: NodeJS.Timeout;
  private readonly indexIntervalMs: number;
  private isIndexing = false;

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
      opts.playbackBaseUrl || '/api/media/playback';

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

    this.scheduleIntervalMs = opts.scheduleIntervalMs ?? 30_000;
    this.storageIntervalMs = opts.storageIntervalMs ?? 60_000;
    this.indexIntervalMs = opts.indexIntervalMs ?? 10_000;

    this.catalog = new RecordingCatalog({
      repository,
      eventBus,
      clock: this.clock,
      recordingsDir: opts.recordingsDir,
      fsStatFn: opts.fsStatFn,
      fsUnlinkFn: opts.fsUnlinkFn,
      cameraLookup,
    });

    const registerFromEvent = (evt: any) => {
      if (evt.cameraId && evt.metadata?.mediaMtxPath) {
        if ('registerCamera' in (repository as any)) {
          (repository as any).registerCamera({
            id: evt.cameraId,
            name: evt.metadata.name || evt.cameraId,
            mediaMtxPath: evt.metadata.mediaMtxPath,
          });
        }
      }
    };
    eventBus.subscribe('camera.added', registerFromEvent);
    eventBus.subscribe('camera.online', registerFromEvent);

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

    this.invariants = new StorageInvariantsService({
      catalog: this.catalog,
      repository,
      eventBus,
      recordingsDir: opts.recordingsDir,
    });

    this.segmentIngest = new SegmentIngest({
      repository,
      recordingsRoot: getRecordingsRoot(opts.recordingsDir),
      deleteSegment: (segment) =>
        this.catalog.deleteSegmentInternal(segment.id, segment.filePath, Number(segment.sizeBytes || 0)),
      eventBus,
      clock: this.clock,
      preBufferSeconds: opts.preBufferSeconds,
      postBufferSeconds: opts.postBufferSeconds,
    });
    eventBus.subscribe('camera.deleted', (evt: any) => {
      if (evt.cameraId) this.segmentIngest.forgetCamera(evt.cameraId);
    });
    // Receive time, not the camera's timestamp: camera clocks often drift (no NTP)
    eventBus.subscribe('motion.detected', async (evt: any) => {
      if (evt.cameraId) await this.segmentIngest.onMotion(evt.cameraId, this.clock.now());
    });
  }

  // ==========================================
  // Public Seam Methods
  // ==========================================

  async getMotionBufferStatus(cameraId?: string): Promise<MotionBufferStatus> {
    return this.segmentIngest.bufferStatus(cameraId);
  }

  setMotionWindow(preBufferSeconds: number, postBufferSeconds: number): void {
    this.segmentIngest.setMotionWindow(preBufferSeconds, postBufferSeconds);
  }

  getMotionWindow(): { preBufferSeconds: number; postBufferSeconds: number } {
    return this.segmentIngest.getMotionWindow();
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

  /** Lifetime of CONTINUOUS footage (the operational "retention days" setting). */
  setRetentionDays(days: number): void {
    this.storageController.setRetentionDays(days);
  }

  setStorageThresholds(warningPercent: number, criticalPercent: number): void {
    this.storageController.setThresholds(warningPercent, criticalPercent);
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
    await this.auditAfterCrash();

    // 2. Launch periodic loops
    this.scheduleTimerId = this.clock.setInterval(async () => {
      await this.tickSchedule();
    }, this.scheduleIntervalMs);

    this.storageTimerId = this.clock.setInterval(async () => {
      await this.tickStorage();
    }, this.storageIntervalMs);

    await this.tickIndex();
    this.indexTimerId = this.clock.setInterval(async () => {
      await this.tickIndex();
    }, this.indexIntervalMs);
  }

  /**
   * Crash recovery at boot: finishes interrupted deletions and marks catalogued files
   * that are gone as MISSING. Only on mounted, writable storage: a volume that is late
   * to mount must not make every recording look missing.
   */
  private async auditAfterCrash(): Promise<void> {
    try {
      const { healthStatus } = await this.storageController.getStorageMetrics();
      if (healthStatus === 'MOUNT_MISSING' || healthStatus === 'WRITE_FAILED') {
        console.warn(`[RecordingEngine] Skipping boot invariants audit: storage is ${healthStatus}`);
        return;
      }
      await this.invariants.auditAndReconcile();
    } catch (err) {
      console.warn(`[RecordingEngine] Boot invariants audit failed: ${(err as Error).message}`);
    }
  }

  /**
   * Single-flight scan of the recordings volume for finished segments.
   */
  private async tickIndex(): Promise<void> {
    if (this.isIndexing) return;
    this.isIndexing = true;
    try {
      await this.segmentIngest.scan();
    } catch (err) {
      console.warn(`[RecordingEngine] Segment indexing failed: ${(err as Error).message}`);
    } finally {
      this.isIndexing = false;
    }
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

    if (this.indexTimerId) {
      this.clock.clearInterval(this.indexTimerId);
      this.indexTimerId = undefined;
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
    } catch (err) {
      console.warn(`[RecordingEngine] Schedule evaluation failed: ${(err as Error).message}`);
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
      // Age-based retention first, then capacity-based FIFO rollover
      await this.storageController.purgeRetention();
      await this.storageController.checkStorage();
    } catch (err) {
      console.warn(`[RecordingEngine] Storage maintenance failed: ${(err as Error).message}`);
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
