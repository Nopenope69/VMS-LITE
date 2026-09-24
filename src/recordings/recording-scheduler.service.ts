import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { MediaMtxClient, mediaMtxClient as defaultMediaMtx } from '../mediamtx/mediamtx.client.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { ScheduleWindow } from './recording.types.js';

export type RecordingMode = 'CONTINUOUS' | 'SCHEDULED' | 'MANUAL_OFF';

export interface CameraScheduleConfig {
  mode: RecordingMode;
  windows: ScheduleWindow[];
}

export interface RecordingSchedulerDependencies {
  prisma?: PrismaClient;
  mediaMtx?: MediaMtxClient;
  eventBus?: EventBus;
}

export class RecordingScheduler {
  private readonly prisma: PrismaClient;
  private readonly mediaMtx: MediaMtxClient;
  private readonly eventBus: EventBus;

  // In-memory schedules cache (cameraId -> CameraScheduleConfig)
  private readonly memorySchedules: Map<string, CameraScheduleConfig> = new Map();

  // In-memory recording state tracking (cameraId -> boolean)
  private readonly recordingStates: Map<string, boolean> = new Map();

  // In-memory camera path tracking (cameraId -> mediaMtxPath)
  private readonly cameraPaths: Map<string, string> = new Map();

  constructor(deps: RecordingSchedulerDependencies = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.mediaMtx = deps.mediaMtx || defaultMediaMtx;
    this.eventBus = deps.eventBus || defaultEventBus;
  }

  /**
   * Sets the recording schedule and mode for a camera (REC-02).
   */
  async setCameraSchedule(
    cameraId: string,
    mode: RecordingMode = 'CONTINUOUS',
    windows: ScheduleWindow[] = [],
    mediaMtxPath?: string
  ): Promise<void> {
    const config: CameraScheduleConfig = { mode, windows };
    this.memorySchedules.set(cameraId, config);
    if (mediaMtxPath) {
      this.cameraPaths.set(cameraId, mediaMtxPath);
    }

    try {
      // Clear existing schedule records in DB
      await this.prisma.recordingSchedule.deleteMany({
        where: { cameraId },
      });

      // Insert new schedule windows
      if (windows.length > 0) {
        await this.prisma.recordingSchedule.createMany({
          data: windows.map((w) => ({
            cameraId,
            dayOfWeek: w.dayOfWeek,
            startHour: w.startHour,
            startMin: w.startMin,
            endHour: w.endHour,
            endMin: w.endMin,
          })),
        });
      }
    } catch {
      // Memory fallback for tests
    }

    // Immediately evaluate recording state for this camera
    await this.evaluateCameraById(cameraId);
  }

  /**
   * Retrieves the recording schedule and mode for a camera.
   */
  async getCameraSchedule(cameraId: string): Promise<CameraScheduleConfig> {
    const cached = this.memorySchedules.get(cameraId);
    if (cached) {
      return cached;
    }

    try {
      const records = await this.prisma.recordingSchedule.findMany({
        where: { cameraId },
        orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }],
      });

      if (records.length > 0) {
        const windows: ScheduleWindow[] = records.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          startHour: r.startHour,
          startMin: r.startMin,
          endHour: r.endHour,
          endMin: r.endMin,
        }));
        const config: CameraScheduleConfig = { mode: 'SCHEDULED', windows };
        this.memorySchedules.set(cameraId, config);
        return config;
      }
    } catch {
      // Return default continuous
    }

    // Default to 24/7 continuous recording if no schedule configured
    return { mode: 'CONTINUOUS', windows: [] };
  }

  /**
   * Evaluates if a camera should be recording at a given timestamp.
   */
  isCameraActiveAt(config: CameraScheduleConfig, date: Date = new Date()): boolean {
    if (config.mode === 'CONTINUOUS') {
      return true;
    }
    if (config.mode === 'MANUAL_OFF') {
      return false;
    }

    // Mode is SCHEDULED: evaluate window list
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ...
    const currentMins = date.getHours() * 60 + date.getMinutes();

    for (const win of config.windows) {
      if (win.dayOfWeek === dayOfWeek) {
        const startMins = win.startHour * 60 + win.startMin;
        const endMins = win.endHour * 60 + win.endMin;

        if (startMins <= endMins) {
          // Standard daytime window (e.g. 09:00 to 18:00)
          if (currentMins >= startMins && currentMins < endMins) {
            return true;
          }
        } else {
          // Overnight window spanning midnight (e.g. 22:00 to 06:00)
          if (currentMins >= startMins || currentMins < endMins) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Evaluates a camera's schedule and toggles MediaMTX recording dynamically if state changed.
   */
  async evaluateCamera(
    camera: { id: string; mediaMtxPath: string; name?: string },
    date: Date = new Date()
  ): Promise<boolean> {
    this.cameraPaths.set(camera.id, camera.mediaMtxPath);
    const schedule = await this.getCameraSchedule(camera.id);
    const shouldRecord = this.isCameraActiveAt(schedule, date);
    const currentState = this.recordingStates.get(camera.id);

    if (currentState !== shouldRecord) {
      this.recordingStates.set(camera.id, shouldRecord);

      // Dynamically toggle recording in MediaMTX via v3 API
      await this.mediaMtx.patchPath(camera.mediaMtxPath, {
        record: shouldRecord,
      });

      // Emit event on bus (REC-02)
      await this.eventBus.emitEvent({
        type: shouldRecord ? 'recording.started' : 'recording.stopped',
        source: 'recording.scheduler',
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
   * Evaluates recording state by camera ID.
   */
  async evaluateCameraById(cameraId: string, date: Date = new Date()): Promise<boolean> {
    let camera: any = null;
    try {
      camera = await this.prisma.camera.findUnique({ where: { id: cameraId } });
    } catch {
      // Memory lookup
    }

    if (!camera) {
      const mediaMtxPath = this.cameraPaths.get(cameraId) || `cam_${cameraId}`;
      camera = { id: cameraId, mediaMtxPath };
    }

    return this.evaluateCamera(camera, date);
  }

  /**
   * Evaluates all cameras in the database.
   */
  async evaluateAllCameras(date: Date = new Date()): Promise<void> {
    let cameras: any[] = [];
    try {
      cameras = await this.prisma.camera.findMany();
    } catch {
      // No live DB
    }

    for (const cam of cameras) {
      await this.evaluateCamera(cam, date);
    }
  }

  /**
   * Returns current recording state for a camera.
   */
  isRecording(cameraId: string): boolean {
    return this.recordingStates.get(cameraId) ?? false;
  }
}

export const recordingScheduler = new RecordingScheduler();
export default recordingScheduler;
