import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../db/prisma.js';
import {
  CameraScheduleConfig,
  RecordingDto,
  RecordingMode,
  RecordingQueryParams,
  ScheduleWindow,
  SegmentStatusType,
  RetentionTierType,
  StreamRoleType,
} from '../recording.types.js';

export interface CameraRecordSummary {
  id: string;
  name: string;
  mediaMtxPath: string;
  siteId?: string | null;
  /** Present when known; required for the scheduler to (re)provision MediaMTX paths. */
  rtspUrl?: string | null;
  subStreamUrl?: string | null;
  subMediaMtxPath?: string | null;
}

/** Upper bound on segments returned for one timeline window (24h of 30s segments). */
export const MAX_TIMELINE_SEGMENTS = 3000;

export interface IRecordingRepository {
  createRecording(data: {
    cameraId: string;
    mediaMtxPath: string;
    filePath: string;
    fileName: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    sizeBytes: bigint | number;
    format?: string;
    streamRole?: StreamRoleType;
    status?: SegmentStatusType;
    retentionTier?: RetentionTierType;
    isProtected?: boolean;
    protectionReason?: string | null;
    sha256?: string | null;
    validatedAt?: Date | null;
    storageProvider?: string;
    storageKey?: string | null;
    videoCodec?: string;
    errorReason?: string | null;
    hasAudio?: boolean;
    width?: number | null;
    height?: number | null;
    fps?: number | null;
  }): Promise<RecordingDto>;

  findRecordingById(id: string): Promise<RecordingDto | null>;
  findRecordingByFilePath(filePath: string): Promise<RecordingDto | null>;
  /** Most recent catalogued segment start for a camera (Segment Ingest resume point). */
  findLatestStartTime(cameraId: string): Promise<Date | null>;
  queryRecordings(params: RecordingQueryParams): Promise<RecordingDto[]>;
  /** Segments with the given status (default AVAILABLE) overlapping [start, end) for one camera, ascending by start time. */
  findRecordingsInRange(cameraId: string, start: Date, end: Date, status?: SegmentStatusType): Promise<RecordingDto[]>;
  /**
   * When the appliance received persisted motion.detected events for one camera, within
   * [from, to]. Receive time, not the camera's own timestamp: camera clocks often drift.
   */
  findMotionTimes(cameraId: string, from: Date, to: Date): Promise<Date[]>;
  findOldestRecordings(limit: number, skip?: number): Promise<RecordingDto[]>;
  deleteRecording(id: string): Promise<boolean>;
  updateRecordingStatus(id: string, status: SegmentStatusType, errorReason?: string | null): Promise<RecordingDto | null>;
  findRecordingsByStatus(status: SegmentStatusType, limit?: number): Promise<RecordingDto[]>;

  getCameraSchedule(cameraId: string): Promise<CameraScheduleConfig>;
  saveCameraSchedule(
    cameraId: string,
    mode: RecordingMode,
    windows: ScheduleWindow[]
  ): Promise<void>;

  listAllCameras(): Promise<CameraRecordSummary[]>;
  getCameraByMediaMtxPath(mediaMtxPath: string): Promise<CameraRecordSummary | null>;
  getCameraById(cameraId: string): Promise<CameraRecordSummary | null>;
}

export class CameraNotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(cameraId: string) {
    super(`Camera with id ${cameraId} not found`);
    this.name = 'CameraNotFoundError';
  }
}

export class PrismaRecordingRepository implements IRecordingRepository {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async createRecording(data: {
    cameraId: string;
    mediaMtxPath: string;
    filePath: string;
    fileName: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    sizeBytes: bigint | number;
    format?: string;
    streamRole?: StreamRoleType;
    status?: SegmentStatusType;
    retentionTier?: RetentionTierType;
    isProtected?: boolean;
    protectionReason?: string | null;
    sha256?: string | null;
    validatedAt?: Date | null;
    storageProvider?: string;
    storageKey?: string | null;
    videoCodec?: string;
    errorReason?: string | null;
    hasAudio?: boolean;
    width?: number | null;
    height?: number | null;
    fps?: number | null;
  }): Promise<RecordingDto> {
    const record = await this.prisma.recording.create({
      data: {
        cameraId: data.cameraId,
        mediaMtxPath: data.mediaMtxPath,
        filePath: data.filePath,
        fileName: data.fileName,
        startTime: data.startTime,
        endTime: data.endTime,
        duration: data.duration,
        sizeBytes: BigInt(data.sizeBytes),
        format: data.format || 'fmp4',
        streamRole: (data.streamRole as any) || 'PRIMARY',
        status: (data.status as any) || 'AVAILABLE',
        retentionTier: (data.retentionTier as any) || 'CONTINUOUS',
        isProtected: data.isProtected ?? false,
        protectionReason: data.protectionReason ?? null,
        sha256: data.sha256 ?? null,
        validatedAt: data.validatedAt ?? null,
        storageProvider: data.storageProvider || 'local',
        storageKey: data.storageKey ?? null,
        videoCodec: data.videoCodec || 'h264',
        errorReason: data.errorReason ?? null,
        hasAudio: data.hasAudio ?? false,
        width: data.width ?? null,
        height: data.height ?? null,
        fps: data.fps ?? null,
      },
    });

    return this.toDto(record);
  }

  async findRecordingById(id: string): Promise<RecordingDto | null> {
    const record = await this.prisma.recording.findUnique({
      where: { id },
    });
    return record ? this.toDto(record) : null;
  }

  async queryRecordings(params: RecordingQueryParams): Promise<RecordingDto[]> {
    const where: any = { status: 'AVAILABLE' };
    if (params.cameraId) {
      where.cameraId = params.cameraId;
    }
    if (params.startTime || params.endTime) {
      where.startTime = {};
      if (params.startTime) where.startTime.gte = new Date(params.startTime);
      if (params.endTime) where.startTime.lte = new Date(params.endTime);
    }

    const records = await this.prisma.recording.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: params.limit || 100,
    });

    return records.map((r) => this.toDto(r));
  }

  async findRecordingByFilePath(filePath: string): Promise<RecordingDto | null> {
    const record = await this.prisma.recording.findUnique({ where: { filePath } });
    return record ? this.toDto(record) : null;
  }

  async findLatestStartTime(cameraId: string): Promise<Date | null> {
    const latest = await this.prisma.recording.findFirst({
      where: { cameraId },
      orderBy: { startTime: 'desc' },
      select: { startTime: true },
    });
    return latest ? new Date(latest.startTime) : null;
  }

  async findRecordingsInRange(
    cameraId: string,
    start: Date,
    end: Date,
    status: SegmentStatusType = 'AVAILABLE'
  ): Promise<RecordingDto[]> {
    const records = await this.prisma.recording.findMany({
      where: {
        cameraId,
        status: status as any,
        startTime: { lt: end },
        endTime: { gt: start },
      },
      orderBy: { startTime: 'asc' },
      take: MAX_TIMELINE_SEGMENTS,
    });
    return records.map((r) => this.toDto(r));
  }

  async findMotionTimes(cameraId: string, from: Date, to: Date): Promise<Date[]> {
    const events = await this.prisma.event.findMany({
      where: { cameraId, type: 'motion.detected', createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
    });
    return events.map((e: { createdAt: Date | string }) => new Date(e.createdAt));
  }

  async findOldestRecordings(limit: number, skip = 0): Promise<RecordingDto[]> {
    const records = await this.prisma.recording.findMany({
      orderBy: { startTime: 'asc' },
      take: limit,
      skip,
    });
    return records.map((r) => this.toDto(r));
  }

  async deleteRecording(id: string): Promise<boolean> {
    await this.prisma.recording.delete({
      where: { id },
    });
    return true;
  }

  async updateRecordingStatus(id: string, status: SegmentStatusType, errorReason?: string | null): Promise<RecordingDto | null> {
    try {
      const record = await this.prisma.recording.update({
        where: { id },
        data: {
          status: status as any,
          errorReason: errorReason ?? null,
        },
      });
      return this.toDto(record);
    } catch {
      return null;
    }
  }

  async findRecordingsByStatus(status: SegmentStatusType, limit = 100): Promise<RecordingDto[]> {
    const records = await this.prisma.recording.findMany({
      where: { status: status as any },
      take: limit,
      orderBy: { startTime: 'asc' },
    });
    return records.map((r) => this.toDto(r));
  }

  async getCameraSchedule(cameraId: string): Promise<CameraScheduleConfig> {
    // Mode is persisted on the Camera row; windows in recording_schedules
    const camera = await this.prisma.camera.findUnique({
      where: { id: cameraId },
      select: { recordingMode: true },
    });
    const mode: RecordingMode = (camera?.recordingMode as RecordingMode) || 'CONTINUOUS';

    const records = await this.prisma.recordingSchedule.findMany({
      where: { cameraId },
      orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }],
    });

    const windows: ScheduleWindow[] = records.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      startHour: r.startHour,
      startMin: r.startMin,
      endHour: r.endHour,
      endMin: r.endMin,
    }));

    return { mode, windows };
  }

  async saveCameraSchedule(
    cameraId: string,
    mode: RecordingMode,
    windows: ScheduleWindow[]
  ): Promise<void> {
    const exists = await this.prisma.camera.findUnique({ where: { id: cameraId }, select: { id: true } });
    if (!exists) {
      throw new CameraNotFoundError(cameraId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.camera.update({
        where: { id: cameraId },
        data: { recordingMode: mode },
      });

      // Clear existing schedule windows
      await tx.recordingSchedule.deleteMany({
        where: { cameraId },
      });

      // Insert new windows
      if (windows.length > 0) {
        await tx.recordingSchedule.createMany({
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
    });
  }

  async listAllCameras(): Promise<CameraRecordSummary[]> {
    return this.prisma.camera.findMany({
      select: {
        id: true,
        name: true,
        mediaMtxPath: true,
        siteId: true,
        rtspUrl: true,
        subStreamUrl: true,
        subMediaMtxPath: true,
      },
    });
  }

  async getCameraByMediaMtxPath(mediaMtxPath: string): Promise<CameraRecordSummary | null> {
    return this.prisma.camera.findFirst({
      where: {
        OR: [
          { mediaMtxPath },
          { subMediaMtxPath: mediaMtxPath },
        ],
      },
      select: {
        id: true,
        name: true,
        mediaMtxPath: true,
        siteId: true,
        rtspUrl: true,
        subStreamUrl: true,
        subMediaMtxPath: true,
      },
    });
  }

  async getCameraById(cameraId: string): Promise<CameraRecordSummary | null> {
    return this.prisma.camera.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        name: true,
        mediaMtxPath: true,
        siteId: true,
        rtspUrl: true,
        subStreamUrl: true,
        subMediaMtxPath: true,
      },
    });
  }

  registerCamera(_camera: CameraRecordSummary): void {
    // No-op in Prisma repository: cameras are managed via CameraService
  }

  private toDto(record: any): RecordingDto {
    return {
      id: record.id,
      cameraId: record.cameraId,
      mediaMtxPath: record.mediaMtxPath,
      streamRole: record.streamRole || 'PRIMARY',
      filePath: record.filePath,
      fileName: record.fileName,
      startTime: record.startTime instanceof Date ? record.startTime.toISOString() : String(record.startTime),
      endTime: record.endTime instanceof Date ? record.endTime.toISOString() : String(record.endTime),
      duration: Number(record.duration),
      sizeBytes: Number(record.sizeBytes),
      format: record.format,
      videoCodec: record.videoCodec || 'h264',
      hasAudio: Boolean(record.hasAudio),
      width: record.width ?? null,
      height: record.height ?? null,
      fps: record.fps ?? null,
      status: record.status || 'AVAILABLE',
      retentionTier: record.retentionTier || 'CONTINUOUS',
      isProtected: Boolean(record.isProtected),
      protectionReason: record.protectionReason ?? null,
      errorReason: record.errorReason ?? null,
      sha256: record.sha256 ?? null,
      validatedAt: record.validatedAt instanceof Date ? record.validatedAt.toISOString() : record.validatedAt ?? null,
      storageProvider: record.storageProvider || 'local',
      storageKey: record.storageKey ?? null,
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
    };
  }
}

export class InMemoryRecordingRepository implements IRecordingRepository {
  private readonly recordings = new Map<string, RecordingDto>();
  private readonly schedules = new Map<string, CameraScheduleConfig>();
  private readonly cameras = new Map<string, CameraRecordSummary>();
  private readonly motionTimes = new Map<string, Date[]>();

  registerCamera(camera: CameraRecordSummary): void {
    this.cameras.set(camera.id, camera);
  }

  /** Test stand-in for a persisted motion.detected event. */
  recordMotion(cameraId: string, at: Date): void {
    const times = this.motionTimes.get(cameraId) || [];
    times.push(at);
    this.motionTimes.set(cameraId, times);
  }

  async findMotionTimes(cameraId: string, from: Date, to: Date): Promise<Date[]> {
    return (this.motionTimes.get(cameraId) || [])
      .filter((t) => t.getTime() >= from.getTime() && t.getTime() <= to.getTime())
      .sort((a, b) => a.getTime() - b.getTime());
  }

  async createRecording(data: {
    cameraId: string;
    mediaMtxPath: string;
    filePath: string;
    fileName: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    sizeBytes: bigint | number;
    format?: string;
    streamRole?: StreamRoleType;
    status?: SegmentStatusType;
    retentionTier?: RetentionTierType;
    isProtected?: boolean;
    protectionReason?: string | null;
    errorReason?: string | null;
    sha256?: string | null;
    validatedAt?: Date | null;
    storageProvider?: string;
    storageKey?: string | null;
    videoCodec?: string;
    hasAudio?: boolean;
    width?: number | null;
    height?: number | null;
    fps?: number | null;
  }): Promise<RecordingDto> {
    const id = crypto.randomUUID();
    const dto: RecordingDto = {
      id,
      cameraId: data.cameraId,
      mediaMtxPath: data.mediaMtxPath,
      streamRole: data.streamRole || 'PRIMARY',
      filePath: data.filePath,
      fileName: data.fileName,
      startTime: data.startTime.toISOString(),
      endTime: data.endTime.toISOString(),
      duration: data.duration,
      sizeBytes: Number(data.sizeBytes),
      format: data.format || 'fmp4',
      videoCodec: data.videoCodec || 'h264',
      hasAudio: data.hasAudio ?? false,
      width: data.width ?? null,
      height: data.height ?? null,
      fps: data.fps ?? null,
      status: data.status || 'AVAILABLE',
      retentionTier: data.retentionTier || 'CONTINUOUS',
      isProtected: data.isProtected ?? false,
      protectionReason: data.protectionReason ?? null,
      errorReason: data.errorReason ?? null,
      sha256: data.sha256 ?? null,
      validatedAt: data.validatedAt ? data.validatedAt.toISOString() : null,
      storageProvider: data.storageProvider || 'local',
      storageKey: data.storageKey ?? null,
      createdAt: new Date().toISOString(),
    };
    this.recordings.set(id, dto);
    return dto;
  }

  async findRecordingById(id: string): Promise<RecordingDto | null> {
    return this.recordings.get(id) || null;
  }

  async queryRecordings(params: RecordingQueryParams): Promise<RecordingDto[]> {
    let list = Array.from(this.recordings.values()).filter((r) => (r.status || 'AVAILABLE') === 'AVAILABLE');

    if (params.cameraId) {
      list = list.filter((r) => r.cameraId === params.cameraId);
    }
    if (params.startTime) {
      const since = new Date(params.startTime).getTime();
      list = list.filter((r) => new Date(r.startTime).getTime() >= since);
    }
    if (params.endTime) {
      const until = new Date(params.endTime).getTime();
      list = list.filter((r) => new Date(r.startTime).getTime() <= until);
    }

    list.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    return list.slice(0, params.limit || 100);
  }

  async findRecordingByFilePath(filePath: string): Promise<RecordingDto | null> {
    for (const r of this.recordings.values()) {
      if (r.filePath === filePath) return r;
    }
    return null;
  }

  async findLatestStartTime(cameraId: string): Promise<Date | null> {
    let latest: number | null = null;
    for (const r of this.recordings.values()) {
      if (r.cameraId !== cameraId) continue;
      const t = new Date(r.startTime).getTime();
      if (latest === null || t > latest) latest = t;
    }
    return latest === null ? null : new Date(latest);
  }

  async findRecordingsInRange(
    cameraId: string,
    start: Date,
    end: Date,
    status: SegmentStatusType = 'AVAILABLE'
  ): Promise<RecordingDto[]> {
    return Array.from(this.recordings.values())
      .filter(
        (r) =>
          r.cameraId === cameraId &&
          (r.status || 'AVAILABLE') === status &&
          new Date(r.startTime).getTime() < end.getTime() &&
          new Date(r.endTime).getTime() > start.getTime()
      )
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, MAX_TIMELINE_SEGMENTS);
  }

  async findOldestRecordings(limit: number, skip = 0): Promise<RecordingDto[]> {
    const list = Array.from(this.recordings.values());
    list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return list.slice(skip, skip + limit);
  }

  async deleteRecording(id: string): Promise<boolean> {
    return this.recordings.delete(id);
  }

  async updateRecordingStatus(id: string, status: SegmentStatusType, errorReason?: string | null): Promise<RecordingDto | null> {
    const rec = this.recordings.get(id);
    if (!rec) return null;
    rec.status = status;
    rec.errorReason = errorReason ?? null;
    return { ...rec };
  }

  async findRecordingsByStatus(status: SegmentStatusType, limit = 100): Promise<RecordingDto[]> {
    const list = Array.from(this.recordings.values())
      .filter((r) => r.status === status)
      .slice(0, limit);
    return list;
  }

  async getCameraSchedule(cameraId: string): Promise<CameraScheduleConfig> {
    return this.schedules.get(cameraId) || { mode: 'CONTINUOUS', windows: [] };
  }

  async saveCameraSchedule(
    cameraId: string,
    mode: RecordingMode,
    windows: ScheduleWindow[]
  ): Promise<void> {
    this.schedules.set(cameraId, { mode, windows });
  }

  async listAllCameras(): Promise<CameraRecordSummary[]> {
    return Array.from(this.cameras.values());
  }

  async getCameraByMediaMtxPath(mediaMtxPath: string): Promise<CameraRecordSummary | null> {
    for (const cam of this.cameras.values()) {
      if (cam.mediaMtxPath === mediaMtxPath || cam.subMediaMtxPath === mediaMtxPath) {
        return cam;
      }
    }
    return null;
  }

  async getCameraById(cameraId: string): Promise<CameraRecordSummary | null> {
    const cam = this.cameras.get(cameraId);
    return cam ? { ...cam } : null;
  }
}
