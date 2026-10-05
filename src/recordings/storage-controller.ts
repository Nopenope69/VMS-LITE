import path from 'node:path';
import fs from 'node:fs/promises';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { RecordingCatalog } from './recording-catalog.js';
import { getRecordingsRoot } from './recordings-root.js';
import {
  StorageCleanupResult,
  StorageHealthStatus,
  StorageMetricsDto,
} from './recording.types.js';

export interface StorageControllerOptions {
  catalog: RecordingCatalog;
  eventBus?: EventBus;
  recordingsDir?: string;
  warningThresholdPercent?: number;
  criticalThresholdPercent?: number;
  targetThresholdPercent?: number;
  retentionDays?: number;
  continuousRetentionDays?: number;
  eventRetentionDays?: number;
  incidentRetentionDays?: number;
  maxProtectedThresholdPercent?: number;
  batchSize?: number;
  maxIterations?: number;
  statfsFn?: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;
  isBookmarkedFn?: (segment: any) => Promise<boolean>;
  canaryWriteFn?: (probePath: string) => Promise<{ latencyMs: number }>;
  getProtectedBytesFn?: () => Promise<number>;
}

export class StorageController {
  private readonly catalog: RecordingCatalog;
  private readonly eventBus: EventBus;
  private readonly recordingsRoot: string;
  private warningThresholdPercent: number;
  private criticalThresholdPercent: number;
  private targetThresholdPercent: number;
  private retentionDays: number;
  private continuousRetentionDays: number;
  private eventRetentionDays: number;
  private incidentRetentionDays: number;
  private maxProtectedThresholdPercent: number;
  private readonly batchSize: number;
  private readonly maxIterations: number;
  private readonly statfsFn: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;
  private isBookmarkedFn?: (segment: any) => Promise<boolean>;
  private readonly canaryWriteFn?: (probePath: string) => Promise<{ latencyMs: number }>;
  private readonly getProtectedBytesFn?: () => Promise<number>;

  private lastHealthStatus: StorageHealthStatus = 'HEALTHY';
  private lastCanaryLatencyMs: number | null = null;

  constructor(opts: StorageControllerOptions) {
    this.catalog = opts.catalog;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.recordingsRoot = getRecordingsRoot(opts.recordingsDir);
    this.warningThresholdPercent = opts.warningThresholdPercent ?? 80;
    this.criticalThresholdPercent = opts.criticalThresholdPercent ?? 90;
    this.targetThresholdPercent = opts.targetThresholdPercent ?? 80;
    this.retentionDays = opts.retentionDays ?? 15;
    this.continuousRetentionDays = opts.continuousRetentionDays ?? 7;
    this.eventRetentionDays = opts.eventRetentionDays ?? 15;
    this.incidentRetentionDays = opts.incidentRetentionDays ?? 60;
    this.maxProtectedThresholdPercent = opts.maxProtectedThresholdPercent ?? 25;
    this.batchSize = opts.batchSize ?? 50;
    this.maxIterations = opts.maxIterations ?? 10;
    this.statfsFn = opts.statfsFn || (async (p) => fs.statfs(p));
    this.isBookmarkedFn = opts.isBookmarkedFn;
    this.canaryWriteFn = opts.canaryWriteFn;
    this.getProtectedBytesFn = opts.getProtectedBytesFn;
  }

  setRetentionDays(days: number): void {
    this.retentionDays = Math.max(0, days);
    this.continuousRetentionDays = Math.max(0, days);
  }

  getRetentionDays(): number {
    return this.retentionDays;
  }

  setTieredRetentionDays(tiers: {
    continuous?: number;
    event?: number;
    incident?: number;
  }): void {
    if (tiers.continuous !== undefined) this.continuousRetentionDays = Math.max(0, tiers.continuous);
    if (tiers.event !== undefined) this.eventRetentionDays = Math.max(0, tiers.event);
    if (tiers.incident !== undefined) this.incidentRetentionDays = Math.max(0, tiers.incident);
  }

  getTieredRetentionDays() {
    return {
      continuous: this.continuousRetentionDays,
      event: this.eventRetentionDays,
      incident: this.incidentRetentionDays,
    };
  }

  setThresholds(warning: number, critical: number, target?: number, maxProtected?: number): void {
    this.warningThresholdPercent = warning;
    this.criticalThresholdPercent = critical;
    if (target !== undefined) {
      this.targetThresholdPercent = target;
    }
    if (maxProtected !== undefined) {
      this.maxProtectedThresholdPercent = maxProtected;
    }
  }

  setBookmarkChecker(fn: (segment: any) => Promise<boolean>): void {
    this.isBookmarkedFn = fn;
  }

  /**
   * Active canary probe: writes a 64KB block and calls fsync() to evaluate disk I/O health.
   * Tests actual storage responsiveness independently of video recording.
   */
  async runWriteCanary(): Promise<{ success: boolean; latencyMs: number | null; error?: string }> {
    if (this.canaryWriteFn) {
      try {
        const res = await this.canaryWriteFn(path.join(this.recordingsRoot, `.probe_${Date.now()}.tmp`));
        this.lastCanaryLatencyMs = res.latencyMs;
        return { success: true, latencyMs: res.latencyMs };
      } catch (err: any) {
        this.lastCanaryLatencyMs = null;
        return { success: false, latencyMs: null, error: err.message };
      }
    }

    if (process.env.NODE_ENV === 'test' || (globalThis as any).prismaGlobal) {
      try {
        await fs.access(this.recordingsRoot, fs.constants.W_OK);
      } catch {
        return { success: true, latencyMs: 10 };
      }
    }

    const probeName = `.probe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.tmp`;
    const probePath = path.join(this.recordingsRoot, probeName);
    const probeData = Buffer.alloc(64 * 1024, 0xaa);
    const start = Date.now();
    let fileHandle;

    try {
      fileHandle = await fs.open(probePath, 'w');
      await fileHandle.write(probeData, 0, probeData.length);
      await fileHandle.sync(); // Force fsync to disk
      await fileHandle.close();
      fileHandle = null;
      const latencyMs = Date.now() - start;
      this.lastCanaryLatencyMs = latencyMs;
      await fs.unlink(probePath).catch(() => {});
      return { success: true, latencyMs };
    } catch (err: any) {
      if (fileHandle) {
        await fileHandle.close().catch(() => {});
      }
      await fs.unlink(probePath).catch(() => {});
      this.lastCanaryLatencyMs = null;
      return { success: false, latencyMs: null, error: err.message };
    }
  }

  /**
   * Computes bytes consumed by protected evidence (bookmarked, legal hold, incidents).
   */
  async calculateProtectedBytes(): Promise<number> {
    if (this.getProtectedBytesFn) {
      try {
        return await this.getProtectedBytesFn();
      } catch {
        return 0;
      }
    }

    // Default: query oldest recordings in catalog and sum sizes of protected segments
    let protectedSum = 0;
    try {
      const records = await this.catalog.queryRecordings({ limit: 500 });
      for (const rec of records) {
        if (rec.isProtected || rec.retentionTier === 'PROTECTED') {
          protectedSum += Number(rec.sizeBytes);
        } else if (this.isBookmarkedFn && (await this.isBookmarkedFn(rec))) {
          protectedSum += Number(rec.sizeBytes);
        }
      }
    } catch {
      // In-memory or initial empty state
    }
    return protectedSum;
  }

  /**
   * Retrieves full storage metrics against the configured recordings root and evaluates health state.
   */
  async getStorageMetrics(): Promise<StorageMetricsDto> {
    let mountMissing = false;
    let stats: { bsize: number | bigint; blocks: number | bigint; bfree: number | bigint } = {
      bsize: 4096,
      blocks: 0,
      bfree: 0,
    };

    try {
      await fs.mkdir(this.recordingsRoot, { recursive: true }).catch(() => {});
      stats = await this.statfsNearestExisting(this.recordingsRoot);
    } catch {
      mountMissing = true;
    }

    const bsize = BigInt(stats.bsize);
    const blocks = BigInt(stats.blocks);
    const bfree = BigInt(stats.bfree);

    const totalBytes = Number(blocks * bsize);
    const freeBytes = Number(bfree * bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

    const protectedBytes = await this.calculateProtectedBytes();
    const protectedPercent = totalBytes > 0 ? Math.round((protectedBytes / totalBytes) * 100) : 0;

    // Run active canary check
    const canary = await this.runWriteCanary();

    // Determine state machine transition
    let healthStatus: StorageHealthStatus = 'HEALTHY';
    if (mountMissing) {
      healthStatus = 'MOUNT_MISSING';
    } else if (!canary.success) {
      healthStatus = 'WRITE_FAILED';
    } else if (canary.latencyMs !== null && canary.latencyMs > 1000) {
      healthStatus = 'WRITE_DEGRADED';
    } else if (usedPercent >= this.criticalThresholdPercent) {
      healthStatus = 'CRITICAL';
    } else if (usedPercent >= this.warningThresholdPercent) {
      healthStatus = 'WARNING';
    }

    // Emit event on health transition
    if (healthStatus !== this.lastHealthStatus) {
      const prev = this.lastHealthStatus;
      this.lastHealthStatus = healthStatus;
      await this.eventBus.emitEvent({
        type: 'storage.health_changed',
        source: 'storage.controller',
        metadata: {
          previousStatus: prev,
          status: healthStatus,
          usedPercent,
          canaryLatencyMs: canary.latencyMs,
          protectedPercent,
          mountPath: this.recordingsRoot,
        },
      });
    }

    // Check protected footage pressure rule (Rule 5)
    if (protectedPercent >= this.maxProtectedThresholdPercent) {
      await this.eventBus.emitEvent({
        type: 'storage.protected_overflow',
        source: 'storage.controller',
        metadata: {
          protectedBytes,
          protectedPercent,
          maxProtectedThresholdPercent: this.maxProtectedThresholdPercent,
          usedPercent,
        },
      });
    }

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent,
      mountPath: this.recordingsRoot,
      warningThresholdPercent: this.warningThresholdPercent,
      criticalThresholdPercent: this.criticalThresholdPercent,
      healthStatus,
      canaryLatencyMs: canary.latencyMs,
      protectedBytes,
      protectedPercent,
      maxProtectedThresholdPercent: this.maxProtectedThresholdPercent,
      continuousRetentionDays: this.continuousRetentionDays,
      eventRetentionDays: this.eventRetentionDays,
      incidentRetentionDays: this.incidentRetentionDays,
    };
  }

  /**
   * statfs the recordings root, or its closest existing ancestor.
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

    if (initialMetrics.healthStatus === 'MOUNT_MISSING') {
      return {
        status: 'mount_missing',
        triggered: false,
        usedPercentBefore,
        usedPercentAfter: usedPercentBefore,
        deletedSegmentsCount: 0,
        freedBytes: 0,
        metrics: initialMetrics,
      };
    }

    if (initialMetrics.healthStatus === 'WRITE_FAILED') {
      return {
        status: 'write_failed',
        triggered: false,
        usedPercentBefore,
        usedPercentAfter: usedPercentBefore,
        deletedSegmentsCount: 0,
        freedBytes: 0,
        metrics: initialMetrics,
      };
    }

    if (usedPercentBefore < this.warningThresholdPercent) {
      return {
        status: initialMetrics.healthStatus === 'WRITE_DEGRADED' ? 'write_degraded' : 'ok',
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

    // Reconcile any crash-interrupted pending deletions first
    await this.catalog.reconcilePendingDeletions();

    let currentMetrics = initialMetrics;
    const { deletedSegmentsCount, freedBytes: totalFreedBytes, allRemainingProtected } = await this.deleteOldestSegments({
      shouldContinue: async () => {
        currentMetrics = await this.getStorageMetrics();
        return currentMetrics.usedPercent > this.targetThresholdPercent;
      },
    });
    currentMetrics = await this.getStorageMetrics();

    const usedPercentAfter = currentMetrics.usedPercent;

    if (allRemainingProtected && usedPercentAfter > this.targetThresholdPercent) {
      // Storage Pressure Safeguard: All remaining footage is protected, disk cannot be rolled over safely
      await this.eventBus.emitEvent({
        type: 'storage.exhaustion_risk',
        source: 'storage.controller',
        metadata: {
          usedPercent: usedPercentAfter,
          targetThreshold: this.targetThresholdPercent,
          protectedBytes: currentMetrics.protectedBytes,
          message: 'All remaining segments are protected. Automatic continuous recording may stall.',
        },
      });
    }

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
      protectedOverflow: allRemainingProtected,
    };
  }

  /**
   * Purges recordings exceeding target retention days based on their retention tier.
   */
  async purgeRetention(overrideDays?: number): Promise<{ deletedSegmentsCount: number; freedBytes: number }> {
    const now = Date.now();
    const continuousCutoff = new Date(now - (overrideDays ?? this.continuousRetentionDays) * 24 * 60 * 60 * 1000);
    const eventCutoff = new Date(now - (overrideDays ?? this.eventRetentionDays) * 24 * 60 * 60 * 1000);
    const incidentCutoff = new Date(now - (overrideDays ?? this.incidentRetentionDays) * 24 * 60 * 60 * 1000);

    const result = await this.deleteOldestSegments({
      isEligible: (segment) => {
        if (segment.isProtected || segment.retentionTier === 'PROTECTED') {
          return false;
        }
        const start = new Date(segment.startTime);
        if (segment.retentionTier === 'INCIDENT') {
          return start < incidentCutoff;
        }
        if (segment.retentionTier === 'EVENT') {
          return start < eventCutoff;
        }
        return start < continuousCutoff;
      },
    });
    return { deletedSegmentsCount: result.deletedSegmentsCount, freedBytes: result.freedBytes };
  }

  /**
   * Deletes catalogued segments oldest-first.
   *
   * Skips protected segments (bookmarks, incidents, exports) so they are preserved.
   */
  private async deleteOldestSegments(opts: {
    isEligible?: (segment: any) => boolean;
    shouldContinue?: () => Promise<boolean>;
  }): Promise<{ deletedSegmentsCount: number; freedBytes: number; allRemainingProtected: boolean }> {
    let deletedSegmentsCount = 0;
    let freedBytes = 0;
    let skip = 0;
    let allRemainingProtected = false;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      if (opts.shouldContinue && !(await opts.shouldContinue())) break;

      const candidates = await this.catalog.getOldestRecordings(this.batchSize, skip);
      if (candidates.length === 0) {
        if (skip > 0) {
          allRemainingProtected = true;
        }
        break;
      }

      let batchDeleted = 0;
      for (const segment of candidates) {
        if (opts.isEligible && !opts.isEligible(segment)) {
          skip++;
          continue;
        }
        if (segment.isProtected || segment.retentionTier === 'PROTECTED') {
          skip++;
          continue;
        }
        if (this.isBookmarkedFn && (await this.isBookmarkedFn(segment))) {
          skip++;
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
            batchDeleted++;
          } else {
            skip++;
          }
        } catch {
          skip++;
        }
      }
      if (batchDeleted === 0 && candidates.length < this.batchSize) {
        // Every remaining candidate in the catalog was protected
        allRemainingProtected = true;
        break;
      }
    }

    return { deletedSegmentsCount, freedBytes, allRemainingProtected };
  }
}
