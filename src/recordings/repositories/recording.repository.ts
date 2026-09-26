import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../db/prisma.js';
import {
  CameraScheduleConfig,
  RecordingDto,
  RecordingMode,
  RecordingQueryParams,
  ScheduleWindow,
} from '../recording.types.js';

export interface CameraRecordSummary {
  id: string;
  name: string;
  mediaMtxPath: string;
}

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
  }): Promise<RecordingDto>;

  findRecordingById(id: string): Promise<RecordingDto | null>;
  queryRecordings(params: RecordingQueryParams): Promise<RecordingDto[]>;
  findOldestRecordings(limit: number): Promise<RecordingDto[]>;
  deleteRecording(id: string): Promise<boolean>;

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

export class PrismaRecordingRepository implements IRecordingRepository {
  private readonly memoryFallback = new InMemoryRecordingRepository();

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
  }): Promise<RecordingDto> {
    try {
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
        },
      });

      return this.toDto(record);
    } catch {
      return this.memoryFallback.createRecording(data);
    }
  }

  async findRecordingById(id: string): Promise<RecordingDto | null> {
    try {
      const record = await this.prisma.recording.findUnique({
        where: { id },
      });
      return record ? this.toDto(record) : this.memoryFallback.findRecordingById(id);
    } catch {
      return this.memoryFallback.findRecordingById(id);
    }
  }

  async queryRecordings(params: RecordingQueryParams): Promise<RecordingDto[]> {
    try {
      const where: any = {};
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
    } catch {
      return this.memoryFallback.queryRecordings(params);
    }
  }

  async findOldestRecordings(limit: number): Promise<RecordingDto[]> {
    try {
      const records = await this.prisma.recording.findMany({
        orderBy: { startTime: 'asc' },
        take: limit,
      });
      return records.map((r) => this.toDto(r));
    } catch {
      return this.memoryFallback.findOldestRecordings(limit);
    }
  }

  async deleteRecording(id: string): Promise<boolean> {
    try {
      await this.prisma.recording.delete({
        where: { id },
      });
      return true;
    } catch {
      return this.memoryFallback.deleteRecording(id);
    }
  }

  async getCameraSchedule(cameraId: string): Promise<CameraScheduleConfig> {
    // Mode is persisted in Camera model or RecordingSchedule
    let mode: RecordingMode = 'CONTINUOUS';

    try {
      const camera = await this.prisma.camera.findUnique({
        where: { id: cameraId },
        select: { status: true },
      });
      if (camera && (camera as any).recordingMode) {
        mode = (camera as any).recordingMode as RecordingMode;
      }
    } catch {
      // Fallback
    }

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

    if (records.length > 0 && mode === 'CONTINUOUS') {
      mode = 'SCHEDULED';
    }

    return { mode, windows };
  }

  async saveCameraSchedule(
    cameraId: string,
    mode: RecordingMode,
    windows: ScheduleWindow[]
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
    try {
      const cameras = await this.prisma.camera.findMany({
        select: { id: true, name: true, mediaMtxPath: true },
      });
      if (cameras.length > 0) return cameras;
      return this.memoryFallback.listAllCameras();
    } catch {
      return this.memoryFallback.listAllCameras();
    }
  }

  async getCameraByMediaMtxPath(mediaMtxPath: string): Promise<CameraRecordSummary | null> {
    try {
      const camera = await this.prisma.camera.findUnique({
        where: { mediaMtxPath },
        select: { id: true, name: true, mediaMtxPath: true },
      });
      if (camera) return camera;
      return this.memoryFallback.getCameraByMediaMtxPath(mediaMtxPath);
    } catch {
      return this.memoryFallback.getCameraByMediaMtxPath(mediaMtxPath);
    }
  }

  async getCameraById(cameraId: string): Promise<CameraRecordSummary | null> {
    try {
      const camera = await this.prisma.camera.findUnique({
        where: { id: cameraId },
        select: { id: true, name: true, mediaMtxPath: true },
      });
      if (camera) return camera;
      return this.memoryFallback.getCameraById(cameraId);
    } catch {
      return this.memoryFallback.getCameraById(cameraId);
    }
  }

  registerCamera(camera: CameraRecordSummary): void {
    this.memoryFallback.registerCamera(camera);
  }

  private toDto(record: any): RecordingDto {
    return {
      id: record.id,
      cameraId: record.cameraId,
      mediaMtxPath: record.mediaMtxPath,
      filePath: record.filePath,
      fileName: record.fileName,
      startTime: record.startTime instanceof Date ? record.startTime.toISOString() : String(record.startTime),
      endTime: record.endTime instanceof Date ? record.endTime.toISOString() : String(record.endTime),
      duration: Number(record.duration),
      sizeBytes: Number(record.sizeBytes),
      format: record.format,
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
    };
  }
}

export class InMemoryRecordingRepository implements IRecordingRepository {
  private readonly recordings = new Map<string, RecordingDto>();
  private readonly schedules = new Map<string, CameraScheduleConfig>();
  private readonly cameras = new Map<string, CameraRecordSummary>();

  registerCamera(camera: CameraRecordSummary): void {
    this.cameras.set(camera.id, camera);
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
  }): Promise<RecordingDto> {
    const id = crypto.randomUUID();
    const dto: RecordingDto = {
      id,
      cameraId: data.cameraId,
      mediaMtxPath: data.mediaMtxPath,
      filePath: data.filePath,
      fileName: data.fileName,
      startTime: data.startTime.toISOString(),
      endTime: data.endTime.toISOString(),
      duration: data.duration,
      sizeBytes: Number(data.sizeBytes),
      format: data.format || 'fmp4',
      createdAt: new Date().toISOString(),
    };
    this.recordings.set(id, dto);
    return dto;
  }

  async findRecordingById(id: string): Promise<RecordingDto | null> {
    return this.recordings.get(id) || null;
  }

  async queryRecordings(params: RecordingQueryParams): Promise<RecordingDto[]> {
    let list = Array.from(this.recordings.values());

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

  async findOldestRecordings(limit: number): Promise<RecordingDto[]> {
    const list = Array.from(this.recordings.values());
    list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return list.slice(0, limit);
  }

  async deleteRecording(id: string): Promise<boolean> {
    return this.recordings.delete(id);
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
      if (cam.mediaMtxPath === mediaMtxPath) {
        return cam;
      }
    }
    return null;
  }

  async getCameraById(cameraId: string): Promise<CameraRecordSummary | null> {
    const cam = this.cameras.get(cameraId);
    if (!cam) return null;
    return { id: cam.id, name: cam.name, mediaMtxPath: cam.mediaMtxPath };
  }
}
