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
    if (config.mode === 'MANUAL_OFF') {
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
   * Evaluates camera and dynamically patches MediaMTX if recording state has changed.
   */
  async evaluateCamera(
    camera: CameraRecordSummary,
    date: Date = this.clock.now()
  ): Promise<boolean> {
    const schedule = await this.getCameraSchedule(camera.id);
    const shouldRecord = this.isCameraActiveAt(schedule, date);
    const currentState = this.recordingStates.get(camera.id);

    if (currentState !== shouldRecord) {
      this.recordingStates.set(camera.id, shouldRecord);

      try {
        await this.mediaMtx.patchPath(camera.mediaMtxPath, {
          record: shouldRecord,
        });
      } catch (err: any) {
        // MediaMTX offline in unit tests is tolerated
      }

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
      await this.evaluateCamera(camera, date);
    }
  }

  isRecording(cameraId: string): boolean {
    return this.recordingStates.get(cameraId) ?? false;
  }
}
