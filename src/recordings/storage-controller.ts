import path from 'node:path';
import fs from 'node:fs/promises';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { RecordingCatalog } from './recording-catalog.js';
import { getRecordingsRoot } from './recordings-root.js';
import { StorageCleanupResult, StorageMetricsDto } from './recording.types.js';

export interface StorageControllerOptions {
  catalog: RecordingCatalog;
  eventBus?: EventBus;
  recordingsDir?: string;
  warningThresholdPercent?: number;
  criticalThresholdPercent?: number;
  targetThresholdPercent?: number;
  retentionDays?: number;
  batchSize?: number;
  maxIterations?: number;
  statfsFn?: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;
  isBookmarkedFn?: (segment: any) => Promise<boolean>;
}

export class StorageController {
  private readonly catalog: RecordingCatalog;
  private readonly eventBus: EventBus;
  private readonly recordingsRoot: string;
  private warningThresholdPercent: number;
  private criticalThresholdPercent: number;
  private targetThresholdPercent: number;
  private retentionDays: number;
  private readonly batchSize: number;
  private readonly maxIterations: number;
  private readonly statfsFn: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;
  private isBookmarkedFn?: (segment: any) => Promise<boolean>;

  constructor(opts: StorageControllerOptions) {
    this.catalog = opts.catalog;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.recordingsRoot = getRecordingsRoot(opts.recordingsDir);
    this.warningThresholdPercent = opts.warningThresholdPercent ?? 80;
    this.criticalThresholdPercent = opts.criticalThresholdPercent ?? 90;
    this.targetThresholdPercent = opts.targetThresholdPercent ?? 80;
    this.retentionDays = opts.retentionDays ?? 15;
    this.batchSize = opts.batchSize ?? 50;
    this.maxIterations = opts.maxIterations ?? 10;
    this.statfsFn = opts.statfsFn || (async (p) => fs.statfs(p));
    this.isBookmarkedFn = opts.isBookmarkedFn;
  }

  setRetentionDays(days: number): void {
    this.retentionDays = Math.max(0, days);
  }

  getRetentionDays(): number {
    return this.retentionDays;
  }

  setThresholds(warning: number, critical: number, target?: number): void {
    this.warningThresholdPercent = warning;
    this.criticalThresholdPercent = critical;
    if (target !== undefined) {
      this.targetThresholdPercent = target;
    }
  }

  setBookmarkChecker(fn: (segment: any) => Promise<boolean>): void {
    this.isBookmarkedFn = fn;
  }

  /**
   * Retrieves disk metrics against the configured recordings root only.
   */
  async getStorageMetrics(): Promise<StorageMetricsDto> {
    await fs.mkdir(this.recordingsRoot, { recursive: true }).catch(() => {});
    const stats = await this.statfsNearestExisting(this.recordingsRoot);
    const bsize = BigInt(stats.bsize);
    const blocks = BigInt(stats.blocks);
    const bfree = BigInt(stats.bfree);

    const totalBytes = Number(blocks * bsize);
    const freeBytes = Number(bfree * bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent,
      mountPath: this.recordingsRoot,
      warningThresholdPercent: this.warningThresholdPercent,
      criticalThresholdPercent: this.criticalThresholdPercent,
    };
  }

  /**
   * statfs the recordings root, or its closest existing ancestor (same filesystem in
   * practice) when the directory cannot be created. Throws if nothing can be measured:
   * reporting a fabricated 0% here would silently disable FIFO rollover.
   */
  private async statfsNearestExisting(dir: string) {
    let current = dir;
    for (;;) {
      try {
        return await this.statfsFn(current);
      } catch (err) {
        const parent = path.dirname(current);
        if (parent === current) {
          throw new Error(`Unable to read filesystem statistics for ${dir}: ${(err as Error).message}`);
        }
        current = parent;
      }
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
    const { deletedSegmentsCount, freedBytes: totalFreedBytes } = await this.deleteOldestSegments({
      shouldContinue: async () => {
        currentMetrics = await this.getStorageMetrics();
        return currentMetrics.usedPercent > this.targetThresholdPercent;
      },
    });
    currentMetrics = await this.getStorageMetrics();

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

  /**
   * Purges recordings exceeding target retention days (excluding bookmarked segments).
   */
  async purgeRetention(overrideDays?: number): Promise<{ deletedSegmentsCount: number; freedBytes: number }> {
    const days = overrideDays ?? this.retentionDays;
    if (!days || days <= 0) {
      return { deletedSegmentsCount: 0, freedBytes: 0 };
    }

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.deleteOldestSegments({
      isEligible: (segment) => new Date(segment.startTime) < cutoff,
    });
    return result;
  }

  /**
   * Deletes catalogued segments oldest-first.
   *
   * Segments that must be kept (bookmarked) or cannot be deleted are skipped by
   * advancing the page offset, so a run of protected footage at the head of the
   * catalog no longer stalls rollover forever. Stops at the first segment that is
   * not eligible (catalog is ordered by start time), when shouldContinue() says so,
   * or after maxIterations batches.
   */
  private async deleteOldestSegments(opts: {
    isEligible?: (segment: any) => boolean;
    shouldContinue?: () => Promise<boolean>;
  }): Promise<{ deletedSegmentsCount: number; freedBytes: number }> {
    let deletedSegmentsCount = 0;
    let freedBytes = 0;
    let skip = 0;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      if (opts.shouldContinue && !(await opts.shouldContinue())) break;

      const candidates = await this.catalog.getOldestRecordings(this.batchSize, skip);
      if (candidates.length === 0) break;

      let reachedIneligible = false;
      for (const segment of candidates) {
        if (opts.isEligible && !opts.isEligible(segment)) {
          reachedIneligible = true;
          break;
        }
        if (this.isBookmarkedFn && (await this.isBookmarkedFn(segment))) {
          skip++; // Preserve bookmarked evidence
          continue;
        }
        try {
          const res = await this.catalog.deleteSegmentInternal(
            segment.id,
            segment.filePath,
            Number(segment.sizeBytes)
          );
          if (res.success) {
            deletedSegmentsCount++;
            freedBytes += res.freedBytes || 0;
          } else {
            skip++;
          }
        } catch {
          skip++; // Outside the recordings root or other non-retryable error
        }
      }
      if (reachedIneligible) break;
    }

    return { deletedSegmentsCount, freedBytes };
  }
}
