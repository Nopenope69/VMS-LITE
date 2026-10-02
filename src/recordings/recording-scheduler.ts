import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { MediaMtxClient, mediaMtxClient as defaultMediaMtx } from '../mediamtx/mediamtx.client.js';
import { IClock, systemClock } from './clock.js';
import {
  CameraRecordSummary,
  IRecordingRepository,
  PrismaRecordingRepository,
} from './repositories/recording.repository.js';
import {
  CameraScheduleConfig,
  RecordingMode,
  ScheduleWindow,
} from './recording.types.js';

export interface RecordingSchedulerOptions {
  repository?: IRecordingRepository;
  mediaMtx?: MediaMtxClient;
  eventBus?: EventBus;
  clock?: IClock;
}

export class RecordingSchedulerCollaborator {
  private readonly repository: IRecordingRepository;
  private readonly mediaMtx: MediaMtxClient;
  private readonly eventBus: EventBus;
  private readonly clock: IClock;

  // Track runtime state in-memory (cameraId -> boolean)
  private readonly recordingStates = new Map<string, boolean>();

  constructor(opts: RecordingSchedulerOptions = {}) {
    this.repository = opts.repository || new PrismaRecordingRepository();
    this.mediaMtx = opts.mediaMtx || defaultMediaMtx;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.clock = opts.clock || systemClock;
  }

  /**
   * Sets the camera schedule mode and active windows.
   */
  async setCameraSchedule(
    cameraId: string,
    mode: RecordingMode = 'SCHEDULED',
    windows: ScheduleWindow[] = []
  ): Promise<CameraScheduleConfig> {
    await this.repository.saveCameraSchedule(cameraId, mode, windows);
    // Immediately evaluate camera state after updating schedule
    await this.evaluateCameraById(cameraId);
    return this.getCameraSchedule(cameraId);
  }

  /**
   * Retrieves camera schedule configuration.
   */
  async getCameraSchedule(cameraId: string): Promise<CameraScheduleConfig> {
    return this.repository.getCameraSchedule(cameraId);
  }

  /**
   * Evaluates if camera should record at a specific timestamp.
   * Accurately supports overnight windows spanning midnight and wrapping days/weeks.
   */
  isCameraActiveAt(config: CameraScheduleConfig, date: Date = this.clock.now()): boolean {
    if (config.mode === 'CONTINUOUS') {
      return true;
    }
    if (config.mode === 'MANUAL_OFF' || config.mode === 'MOTION_ONLY') {
      return false;
    }

    const currentDay = date.getDay(); // 0 = Sunday, 1 = Monday, ...
    const prevDay = (currentDay + 6) % 7; // Yesterday with week-boundary wrap
    const currentMins = date.getHours() * 60 + date.getMinutes();

    for (const win of config.windows) {
      const startMins = win.startHour * 60 + win.startMin;
      const endMins = win.endHour * 60 + win.endMin;

      // Case 1: Window defined for TODAY
      if (win.dayOfWeek === currentDay) {
        if (startMins <= endMins) {
          // Standard daytime window (e.g. 09:00 to 18:00)
          if (currentMins >= startMins && currentMins < endMins) {
            return true;
          }
        } else {
          // Overnight window spanning into tomorrow (e.g. 22:00 to 06:00):
          // Today's evening portion
          if (currentMins >= startMins) {
            return true;
          }
        }
      }

      // Case 2: Window defined for YESTERDAY with overnight span into TODAY
      if (win.dayOfWeek === prevDay) {
        if (startMins > endMins) {
          // Yesterday's overnight window: morning portion continuing into today
          if (currentMins < endMins) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Whether MediaMTX should write segments for this camera right now.
   * MOTION_ONLY records continuously into the motion ring buffer, which keeps only
   * segments around motion incidents; with record disabled it would have nothing to keep.
   */
  shouldRecordToDisk(config: CameraScheduleConfig, date: Date = this.clock.now()): boolean {
    return config.mode === 'MOTION_ONLY' || this.isCameraActiveAt(config, date);
  }

  /**
   * Evaluates a camera and reconciles MediaMTX with the desired state.
   *
   * Runs every scheduler tick and is idempotent: missing paths (after a MediaMTX
   * restart or appliance reboot), changed RTSP sources and a drifted record flag are
   * all corrected here, so the database stays the single source of truth.
   */
  async evaluateCamera(
    camera: CameraRecordSummary,
    date: Date = this.clock.now()
  ): Promise<boolean> {
    const schedule = await this.getCameraSchedule(camera.id);
    const shouldRecord = this.shouldRecordToDisk(schedule, date);
    const previous = this.recordingStates.get(camera.id);

    try {
      await this.reconcileMediaPaths(camera, shouldRecord, previous !== shouldRecord);
    } catch (err) {
      // Leave state unchanged so the next tick retries
      console.warn(
        `[RecordingScheduler] Failed to reconcile media paths for camera ${camera.id}: ${(err as Error).message}`
      );
      return previous ?? false;
    }

    if (previous !== shouldRecord) {
      this.recordingStates.set(camera.id, shouldRecord);
      await this.eventBus.emitEvent({
        type: shouldRecord ? 'recording.started' : 'recording.stopped',
        source: 'recording.engine',
        cameraId: camera.id,
        metadata: {
          mediaMtxPath: camera.mediaMtxPath,
          cameraName: camera.name,
          mode: schedule.mode,
          timestamp: date.toISOString(),
        },
      });
    }

    return shouldRecord;
  }

  private async reconcileMediaPaths(
    camera: CameraRecordSummary,
    record: boolean,
    stateChanged: boolean
  ): Promise<void> {
    if (!camera.rtspUrl) {
      // Source unknown (legacy callers): only drive the record flag on transitions
      if (stateChanged) {
        await this.mediaMtx.patchPath(camera.mediaMtxPath, { record });
      }
      return;
    }

    const main = await this.mediaMtx.getPath(camera.mediaMtxPath);
    const desiredSource = this.mediaMtx.sanitizeRtspUrl(camera.rtspUrl);
    if (!main || main.conf?.source !== desiredSource) {
      await this.mediaMtx.addPath(camera.mediaMtxPath, camera.rtspUrl, { sourceOnDemand: false, record });
    } else if (main.conf?.record !== record) {
      await this.mediaMtx.patchPath(camera.mediaMtxPath, { record });
    }

    if (camera.subStreamUrl) {
      const subPath = camera.subMediaMtxPath || `${camera.mediaMtxPath}_sub`;
      const sub = await this.mediaMtx.getPath(subPath);
      if (!sub || sub.conf?.source !== this.mediaMtx.sanitizeRtspUrl(camera.subStreamUrl)) {
        await this.mediaMtx.addPath(subPath, camera.subStreamUrl, { sourceOnDemand: true, record: false });
      }
    }
  }

  /**
   * Evaluates a camera by its ID.
   */
  async evaluateCameraById(cameraId: string, date: Date = this.clock.now()): Promise<boolean> {
    const cameras = await this.repository.listAllCameras();
    const camera = cameras.find((c) => c.id === cameraId) || {
      id: cameraId,
      name: `cam_${cameraId}`,
      mediaMtxPath: `cam_${cameraId}`,
    };
    return this.evaluateCamera(camera, date);
  }

  /**
   * Evaluates all cameras across the system.
   */
  async evaluateAllCameras(date: Date = this.clock.now()): Promise<void> {
    const cameras = await this.repository.listAllCameras();
    for (const camera of cameras) {
      try {
        await this.evaluateCamera(camera, date);
      } catch (err) {
        console.warn(`[RecordingScheduler] Evaluation failed for camera ${camera.id}: ${(err as Error).message}`);
      }
    }
  }

  isRecording(cameraId: string): boolean {
    return this.recordingStates.get(cameraId) ?? false;
  }
}
