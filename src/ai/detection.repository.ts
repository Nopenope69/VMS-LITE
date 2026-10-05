import { PrismaClient, Detection } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { AiDetectionItem } from './ai.types.js';

export interface DetectionQueryFilter {
  cameraId?: string;
  siteId?: string;
  recordingId?: string;
  label?: string;
  minConfidence?: number;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}

export interface IDetectionRepository {
  saveDetections(
    recordingId: string,
    cameraId: string,
    siteId: string | null,
    detections: AiDetectionItem[],
    modelVersion: string,
    segmentStartTime: Date
  ): Promise<Detection[]>;

  queryDetections(filter: DetectionQueryFilter): Promise<Detection[]>;
  countDetections(filter: DetectionQueryFilter): Promise<number>;
  getDetectionsByRecording(recordingId: string): Promise<Detection[]>;
}

/**
 * High-performance relational detection store.
 * Indexes detections by (cameraId, label, timestamp) and (siteId, label, timestamp)
 * for sub-second spatio-temporal smart search on the 24h timeline.
 */
export class PrismaDetectionRepository implements IDetectionRepository {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async saveDetections(
    recordingId: string,
    cameraId: string,
    siteId: string | null,
    detections: AiDetectionItem[],
    modelVersion: string,
    segmentStartTime: Date
  ): Promise<Detection[]> {
    if (detections.length === 0) {
      return [];
    }

    const created: Detection[] = [];
    const baseTimeMs = segmentStartTime.getTime();

    for (const item of detections) {
      const detectionTimestamp = new Date(baseTimeMs + item.timestampOffsetMs);
      const record = await this.prisma.detection.create({
        data: {
          recordingId,
          cameraId,
          siteId: siteId ?? null,
          timestamp: detectionTimestamp,
          label: item.label,
          confidence: item.confidence,
          bboxX: item.boundingBox.x,
          bboxY: item.boundingBox.y,
          bboxW: item.boundingBox.width,
          bboxH: item.boundingBox.height,
          trackId: item.id || null,
          modelVersion,
        },
      });
      created.push(record);
    }

    return created;
  }

  async queryDetections(filter: DetectionQueryFilter): Promise<Detection[]> {
    const where: any = {};

    if (filter.cameraId) where.cameraId = filter.cameraId;
    if (filter.siteId) where.siteId = filter.siteId;
    if (filter.recordingId) where.recordingId = filter.recordingId;
    if (filter.label) where.label = filter.label;
    if (filter.minConfidence !== undefined) {
      where.confidence = { gte: filter.minConfidence };
    }

    if (filter.startTime || filter.endTime) {
      where.timestamp = {};
      if (filter.startTime) where.timestamp.gte = filter.startTime;
      if (filter.endTime) where.timestamp.lte = filter.endTime;
    }

    return this.prisma.detection.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: filter.limit ?? 100,
      skip: filter.offset ?? 0,
    });
  }

  async countDetections(filter: DetectionQueryFilter): Promise<number> {
    const results = await this.queryDetections({ ...filter, limit: 10000 });
    return results.length;
  }

  async getDetectionsByRecording(recordingId: string): Promise<Detection[]> {
    return this.prisma.detection.findMany({
      where: { recordingId },
      orderBy: { timestamp: 'asc' },
    });
  }
}
