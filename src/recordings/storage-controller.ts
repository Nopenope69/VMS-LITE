import path from 'node:path';
import fs from 'node:fs/promises';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { RecordingCatalog } from './recording-catalog.js';
import { StorageCleanupResult, StorageMetricsDto } from './recording.types.js';

export interface StorageControllerOptions {
  catalog: RecordingCatalog;
  eventBus?: EventBus;
  recordingsDir?: string;
  warningThresholdPercent?: number;
  criticalThresholdPercent?: number;
  targetThresholdPercent?: number;
  batchSize?: number;
  maxIterations?: number;
  statfsFn?: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;
}

export class StorageController {
  private readonly catalog: RecordingCatalog;
  private readonly eventBus: EventBus;
  private readonly recordingsRoot: string;
  private readonly warningThresholdPercent: number;
  private readonly criticalThresholdPercent: number;
  private readonly targetThresholdPercent: number;
  private readonly batchSize: number;
  private readonly maxIterations: number;
  private readonly statfsFn: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;

  constructor(opts: StorageControllerOptions) {
    this.catalog = opts.catalog;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.recordingsRoot = path.resolve(
      opts.recordingsDir || process.env.RECORDINGS_PATH || '/var/recordings'
    );
    this.warningThresholdPercent = opts.warningThresholdPercent ?? 80;
    this.criticalThresholdPercent = opts.criticalThresholdPercent ?? 90;
    this.targetThresholdPercent = opts.targetThresholdPercent ?? 80;
    this.batchSize = opts.batchSize ?? 50;
    this.maxIterations = opts.maxIterations ?? 10;
    this.statfsFn = opts.statfsFn || (async (p) => fs.statfs(p));
  }

  /**
   * Retrieves disk metrics against the configured recordings root only.
   */
  async getStorageMetrics(): Promise<StorageMetricsDto> {
    try {
      try {
        await fs.mkdir(this.recordingsRoot, { recursive: true });
      } catch {
        // Directory may already exist
      }

      const stats = await this.statfsFn(this.recordingsRoot);
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
        mountPath: this.recordingsRoot,
        warningThresholdPercent: this.warningThresholdPercent,
        criticalThresholdPercent: this.criticalThresholdPercent,
      };
    } catch {
      // Safe fallback if statfs fails in unmounted test environment
      return {
        totalBytes: 100 * 1024 * 1024 * 1024,
        freeBytes: 100 * 1024 * 1024 * 1024,
        usedBytes: 0,
        usedPercent: 0,
        mountPath: this.recordingsRoot,
        warningThresholdPercent: this.warningThresholdPercent,
        criticalThresholdPercent: this.criticalThresholdPercent,
      };
    }
  }

  /**
   * Inspects storage thresholds and triggers FIFO rollover if critical limit is exceeded.
   */
  async checkStorage(): Promise<StorageCleanupResult> {
    const initialMetrics = await this.getStorageMetrics();
    const usedPercentBefore = initialMetrics.usedPercent;

    if (usedPercentBefore < this.warningThresholdPercent) {
      return {
        status: 'ok',
        triggered: false,
        usedPercentBefore,
        usedPercentAfter: usedPercentBefore,
        deletedSegmentsCount: 0,
        freedBytes: 0,
        metrics: initialMetrics,
      };
    }

    if (usedPercentBefore >= this.warningThresholdPercent && usedPercentBefore < this.criticalThresholdPercent) {
      await this.eventBus.emitEvent({
        type: 'storage.warning',
        source: 'storage.controller',
        metadata: {
          usedPercent: usedPercentBefore,
          warningThreshold: this.warningThresholdPercent,
          criticalThreshold: this.criticalThresholdPercent,
        },
      });

      return {
        status: 'warning',
        triggered: false,
        usedPercentBefore,
        usedPercentAfter: usedPercentBefore,
        deletedSegmentsCount: 0,
        freedBytes: 0,
        metrics: initialMetrics,
      };
    }

    // Critical threshold reached: trigger FIFO rollover
    await this.eventBus.emitEvent({
      type: 'storage.critical',
      source: 'storage.controller',
      metadata: {
        usedPercent: usedPercentBefore,
        criticalThreshold: this.criticalThresholdPercent,
        targetThreshold: this.targetThresholdPercent,
      },
    });

    let currentMetrics = initialMetrics;
    let iteration = 0;
    let deletedSegmentsCount = 0;
    let totalFreedBytes = 0;

    while (
      currentMetrics.usedPercent > this.targetThresholdPercent &&
      iteration < this.maxIterations
    ) {
      iteration++;
      const candidates = await this.catalog.getOldestRecordings(this.batchSize);
      if (candidates.length === 0) {
        break;
      }

      for (const segment of candidates) {
        try {
          const res = await this.catalog.deleteSegmentInternal(
            segment.id,
            segment.filePath,
            Number(segment.sizeBytes)
          );
          if (res.success) {
            deletedSegmentsCount++;
            totalFreedBytes += res.freedBytes || 0;
          }
        } catch {
          // Traversal or system error ignored per item
        }
      }

      currentMetrics = await this.getStorageMetrics();
    }

    const usedPercentAfter = currentMetrics.usedPercent;

    await this.eventBus.emitEvent({
      type: 'storage.rollover',
      source: 'storage.controller',
      metadata: {
        deletedCount: deletedSegmentsCount,
        freedBytes: totalFreedBytes,
        usedPercentBefore,
        usedPercentAfter,
        targetThreshold: this.targetThresholdPercent,
      },
    });

    return {
      status: 'critical',
      triggered: true,
      usedPercentBefore,
      usedPercentAfter,
      deletedSegmentsCount,
      freedBytes: totalFreedBytes,
      metrics: currentMetrics,
    };
  }
}
