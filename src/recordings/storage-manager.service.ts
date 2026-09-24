import path from 'node:path';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { StorageMetricsDto } from './recording.types.js';
import { RecordingService, recordingService as defaultRecordingService } from './recording.service.js';

export interface StorageConfig {
  recordingsDir: string;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  targetThresholdPercent: number;
  batchSize: number;
}

export interface StorageManagerDependencies {
  prisma?: PrismaClient;
  eventBus?: EventBus;
  recordingService?: RecordingService;
  config?: Partial<StorageConfig>;
  statfsFn?: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;
}

export class StorageManager {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly recordingService: RecordingService;
  private readonly config: StorageConfig;
  private readonly statfsFn?: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;

  constructor(deps: StorageManagerDependencies = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.eventBus = deps.eventBus || defaultEventBus;
    this.recordingService = deps.recordingService || defaultRecordingService;
    this.statfsFn = deps.statfsFn;

    this.config = {
      recordingsDir:
        deps.config?.recordingsDir ||
        process.env.RECORDINGS_PATH ||
        '/var/recordings',
      warningThresholdPercent: deps.config?.warningThresholdPercent ?? 80,
      criticalThresholdPercent: deps.config?.criticalThresholdPercent ?? 90,
      targetThresholdPercent: deps.config?.targetThresholdPercent ?? 80,
      batchSize: deps.config?.batchSize ?? 50,
    };
  }

  /**
   * Retrieves current disk metrics using Node 20 LTS native fs.statfs (REC-04).
   */
  async getStorageMetrics(targetDir?: string): Promise<StorageMetricsDto> {
    const mountPath = targetDir || this.config.recordingsDir;

    try {
      // Ensure recordings directory exists
      try {
        await fs.mkdir(mountPath, { recursive: true });
      } catch {
        // Directory may already exist or cannot be created
      }

      const statfsImpl = this.statfsFn || fs.statfs;
      const stats = await statfsImpl(mountPath);

      const bsize = BigInt(stats.bsize);
      const blocks = BigInt(stats.blocks);
      const bfree = BigInt(stats.bfree);

      const totalBytes = Number(blocks * bsize);
      const freeBytes = Number(bfree * bsize);
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      const usedPercent =
        totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

      return {
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent,
        mountPath,
        warningThresholdPercent: this.config.warningThresholdPercent,
        criticalThresholdPercent: this.config.criticalThresholdPercent,
      };
    } catch {
      // Safe fallback if statfs is unavailable or targetDir is inaccessible
      return {
        totalBytes: 100 * 1024 * 1024 * 1024, // 100GB
        freeBytes: 100 * 1024 * 1024 * 1024,
        usedBytes: 0,
        usedPercent: 0,
        mountPath,
        warningThresholdPercent: this.config.warningThresholdPercent,
        criticalThresholdPercent: this.config.criticalThresholdPercent,
      };
    }
  }

  /**
   * Checks storage capacity against warning (80%) and critical (90%) thresholds (REC-04, REC-05).
   * Emits events on the bus and automatically triggers FIFO rollover when critical.
   */
  async checkStorage(): Promise<{
    status: 'ok' | 'warning' | 'critical';
    metrics: StorageMetricsDto;
    purgedSegments?: number;
    reclaimedBytes?: number;
  }> {
    const metrics = await this.getStorageMetrics();

    if (metrics.usedPercent >= this.config.criticalThresholdPercent) {
      await this.eventBus.emitEvent({
        type: 'storage.full',
        source: 'storage.manager',
        severity: 'critical',
        metadata: {
          usedPercent: metrics.usedPercent,
          totalBytes: metrics.totalBytes,
          freeBytes: metrics.freeBytes,
          mountPath: metrics.mountPath,
        },
      });

      // Automatically enforce quota via FIFO purge (REC-05)
      const rolloverResult = await this.enforceDiskQuota(
        this.config.targetThresholdPercent
      );
      const updatedMetrics = await this.getStorageMetrics();

      return {
        status: 'critical',
        metrics: updatedMetrics,
        purgedSegments: rolloverResult.purgedCount,
        reclaimedBytes: rolloverResult.reclaimedBytes,
      };
    }

    if (metrics.usedPercent >= this.config.warningThresholdPercent) {
      await this.eventBus.emitEvent({
        type: 'storage.warning',
        source: 'storage.manager',
        severity: 'warning',
        metadata: {
          usedPercent: metrics.usedPercent,
          totalBytes: metrics.totalBytes,
          freeBytes: metrics.freeBytes,
          mountPath: metrics.mountPath,
        },
      });

      return {
        status: 'warning',
        metrics,
      };
    }

    return {
      status: 'ok',
      metrics,
    };
  }

  /**
   * Enforces disk quota by purging the oldest recording segments in FIFO order (REC-05).
   * Validates paths to prevent arbitrary file deletion (T-03-06).
   */
  async enforceDiskQuota(
    targetPercent: number = this.config.targetThresholdPercent
  ): Promise<{
    purgedCount: number;
    reclaimedBytes: number;
  }> {
    let purgedCount = 0;
    let reclaimedBytes = 0;
    const resolvedRecordingsDir = path.resolve(this.config.recordingsDir);

    // Limit iterations to prevent runaway loops
    const maxIterations = 10;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      let segmentsToPurge: Array<{
        id: string;
        filePath: string;
        sizeBytes: bigint | number;
      }> = [];

      try {
        segmentsToPurge = await this.prisma.recording.findMany({
          orderBy: { startTime: 'asc' },
          take: this.config.batchSize,
          select: { id: true, filePath: true, sizeBytes: true },
        });
      } catch {
        // Fallback to recording service in-memory store
        segmentsToPurge = this.recordingService.getOldestRecordings(
          this.config.batchSize
        );
      }

      if (segmentsToPurge.length === 0) {
        break; // No recordings available to purge
      }

      for (const segment of segmentsToPurge) {
        const resolvedPath = path.resolve(segment.filePath);

        // Security check (T-03-06): strictly verify segment resides in recordings directory
        const isInsideRecordingsDir =
          resolvedPath.startsWith(resolvedRecordingsDir + path.sep) ||
          resolvedPath === resolvedRecordingsDir;

        if (!isInsideRecordingsDir) {
          // Path traversal attempt or foreign file: remove DB pointer without unlinking foreign path
          await this.deleteSegmentRecord(segment.id);
          continue;
        }

        // Safely unlink file on disk
        try {
          await fs.unlink(resolvedPath);
        } catch {
          // File may have been removed or virtual
        }

        // Delete metadata from database / memory
        await this.deleteSegmentRecord(segment.id);

        purgedCount++;
        reclaimedBytes += Number(segment.sizeBytes);
      }

      // Check if current utilization is within target
      const currentMetrics = await this.getStorageMetrics();
      if (currentMetrics.usedPercent <= targetPercent) {
        break;
      }
    }

    if (purgedCount > 0) {
      await this.eventBus.emitEvent({
        type: 'storage.rollover',
        source: 'storage.manager',
        severity: 'info',
        metadata: {
          purgedCount,
          reclaimedBytes,
          targetPercent,
          recordingsDir: this.config.recordingsDir,
        },
      });
    }

    return { purgedCount, reclaimedBytes };
  }

  /**
   * Deletes a recording segment record from DB and memory.
   */
  private async deleteSegmentRecord(id: string): Promise<void> {
    try {
      await this.prisma.recording.delete({ where: { id } });
    } catch {
      // In-memory fallback
    }
    this.recordingService.deleteMemoryRecording(id);
  }

  /**
   * Returns current configuration.
   */
  getConfig(): StorageConfig {
    return { ...this.config };
  }
}

export const storageManager = new StorageManager();
export default storageManager;
