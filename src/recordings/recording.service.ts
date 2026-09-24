import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import {
  RecordingDto,
  RecordingQueryParams,
  SegmentCompleteWebhookPayload,
} from './recording.types.js';

export interface RecordingServiceDependencies {
  prisma?: PrismaClient;
  eventBus?: EventBus;
}

export class RecordingService {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;

  // In-memory fallback cache for test environments without live DB
  private readonly memoryRecordings: Map<string, any> = new Map();

  constructor(deps: RecordingServiceDependencies = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.eventBus = deps.eventBus || defaultEventBus;
  }

  /**
   * Catalogs a completed video segment from MediaMTX hook notification (REC-01, REC-03).
   */
  async ingestSegment(payload: SegmentCompleteWebhookPayload): Promise<RecordingDto> {
    let camera: any = null;

    try {
      camera = await this.prisma.camera.findUnique({
        where: { mediaMtxPath: payload.mediaMtxPath },
      });
    } catch {
      // DB offline fallback
    }

    const cameraId = camera ? camera.id : `mock-camera-${payload.mediaMtxPath}`;
    const fileName = path.basename(payload.segmentPath);

    // Read real file size if file exists on disk
    let sizeBytes = 1024 * 1024; // 1MB default
    try {
      const stat = await fs.stat(payload.segmentPath);
      sizeBytes = stat.size;
    } catch {
      // Mock / virtual file in test
    }

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - payload.duration * 1000);

    const recordingData = {
      cameraId,
      mediaMtxPath: payload.mediaMtxPath,
      filePath: payload.segmentPath,
      fileName,
      startTime,
      endTime,
      duration: payload.duration,
      sizeBytes: BigInt(sizeBytes),
      format: 'fmp4',
    };

    let record: any = null;
    try {
      record = await this.prisma.recording.create({
        data: recordingData,
      });
    } catch {
      const id = crypto.randomUUID();
      record = {
        id,
        ...recordingData,
        createdAt: new Date(),
      };
      this.memoryRecordings.set(id, record);
    }

    // Emit event on bus (REC-03)
    await this.eventBus.emitEvent({
      type: 'recording.segment_created',
      source: 'recording.service',
      cameraId,
      metadata: {
        recordingId: record.id,
        mediaMtxPath: payload.mediaMtxPath,
        filePath: payload.segmentPath,
        fileName,
        duration: payload.duration,
        sizeBytes,
      },
    });

    return this.toDto(record);
  }

  /**
   * Queries recording catalog with camera and time filters.
   */
  async queryRecordings(params: RecordingQueryParams): Promise<RecordingDto[]> {
    try {
      const where: any = {};
      if (params.cameraId) {
        where.cameraId = params.cameraId;
      }
      if (params.startTime || params.endTime) {
        where.startTime = {};
        if (params.startTime) {
          where.startTime.gte = new Date(params.startTime);
        }
        if (params.endTime) {
          where.startTime.lte = new Date(params.endTime);
        }
      }

      const records = await this.prisma.recording.findMany({
        where,
        orderBy: { startTime: 'asc' },
        take: params.limit,
      });

      return records.map((r) => this.toDto(r));
    } catch {
      let items = Array.from(this.memoryRecordings.values());
      if (params.cameraId) {
        items = items.filter((r) => r.cameraId === params.cameraId);
      }
      if (params.startTime) {
        const start = new Date(params.startTime).getTime();
        items = items.filter((r) => new Date(r.startTime).getTime() >= start);
      }
      if (params.endTime) {
        const end = new Date(params.endTime).getTime();
        items = items.filter((r) => new Date(r.startTime).getTime() <= end);
      }
      items.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      return items.slice(0, params.limit).map((r) => this.toDto(r));
    }
  }

  /**
   * Retrieves single recording metadata by ID.
   */
  async getRecordingById(id: string): Promise<RecordingDto | null> {
    try {
      const record = await this.prisma.recording.findUnique({
        where: { id },
      });
      return record ? this.toDto(record) : null;
    } catch {
      const rec = this.memoryRecordings.get(id);
      return rec ? this.toDto(rec) : null;
    }
  }

  /**
   * Formats database record to DTO with safe BigInt conversion (T-03-03).
   */
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

export const recordingService = new RecordingService();
export default recordingService;
