import path from 'node:path';
import fs from 'node:fs/promises';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { RecordingCatalog } from './recording-catalog.js';
import { RetentionPolicy } from './retention-policy.js';
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
  /** Decides which segments may be deleted; defaults to one over the catalog's repository. */
  retention?: RetentionPolicy;
  canaryWriteFn?: (probePath: string) => Promise<{ latencyMs: number }>;
}

export class StorageController {
  private readonly catalog: RecordingCatalog;
  private readonly eventBus: EventBus;
  private readonly recordingsRoot: string;
  private warningThresholdPercent: number;
  private criticalThresholdPercent: number;
  private targetThresholdPercent: number;
  private readonly retention: RetentionPolicy;
  private maxProtectedThresholdPercent: number;
  private readonly batchSize: number;
  private readonly maxIterations: number;
  private readonly statfsFn: (dirPath: string) => Promise<{
    bsize: number | bigint;
    blocks: number | bigint;
    bfree: number | bigint;
  }>;
  private readonly canaryWriteFn?: (probePath: string) => Promise<{ latencyMs: number }>;
  /** Whether the last metrics read found protected footage above its share of the disk */
  private protectedOverflow = false;

  private lastHealthStatus: StorageHealthStatus = 'HEALTHY';
  private lastCanaryLatencyMs: number | null = null;

  constructor(opts: StorageControllerOptions) {
    this.catalog = opts.catalog;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.recordingsRoot = getRecordingsRoot(opts.recordingsDir);
    this.warningThresholdPercent = opts.warningThresholdPercent ?? 80;
    this.criticalThresholdPercent = opts.criticalThresholdPercent ?? 90;
    this.targetThresholdPercent = opts.targetThresholdPercent ?? 80;
    this.retention = opts.retention || new RetentionPolicy({ repository: opts.catalog.getRepository() });
    this.retention.setDays({
      ...(opts.continuousRetentionDays !== undefined || opts.retentionDays !== undefined
        ? { continuous: opts.continuousRetentionDays ?? opts.retentionDays }
        : {}),
      ...(opts.eventRetentionDays !== undefined ? { event: opts.eventRetentionDays } : {}),
      ...(opts.incidentRetentionDays !== undefined ? { incident: opts.incidentRetentionDays } : {}),
    });
    this.maxProtectedThresholdPercent = opts.maxProtectedThresholdPercent ?? 25;
    this.batchSize = opts.batchSize ?? 50;
    this.maxIterations = opts.maxIterations ?? 10;
    this.statfsFn = opts.statfsFn || (async (p) => fs.statfs(p));
    this.canaryWriteFn = opts.canaryWriteFn;
  }

  /** Lifetime of CONTINUOUS footage (the operational "retention days" setting). */
  setRetentionDays(days: number): void {
    this.retention.setDays({ continuous: days });
  }

  getRetentionDays(): number {
    return this.retention.getDays().continuous;
  }

  setTieredRetentionDays(tiers: { continuous?: number; event?: number; incident?: number }): void {
    this.retention.setDays(tiers);
  }

  getTieredRetentionDays() {
    return this.retention.getDays();
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
   * Bytes held by legal holds, bookmarks and running exports, which rollover never frees.
   */
  async calculateProtectedBytes(): Promise<number> {
    try {
      return await this.retention.protectedBytes();
    } catch {
      return 0;
    }
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

    // Protected footage pressure (Rule 5): alert once on crossing, once on recovery.
    // Protected evidence is never deleted automatically.
    const overflow = protectedPercent >= this.maxProtectedThresholdPercent;
    if (overflow && !this.protectedOverflow) {
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
    } else if (!overflow && this.protectedOverflow) {
      await this.eventBus.emitEvent({
        type: 'storage.protected_recovered',
        source: 'storage.controller',
        metadata: { protectedBytes, protectedPercent, maxProtectedThresholdPercent: this.maxProtectedThresholdPercent },
      });
    }
    this.protectedOverflow = overflow;

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
      continuousRetentionDays: this.retention.getDays().continuous,
      eventRetentionDays: this.retention.getDays().event,
      incidentRetentionDays: this.retention.getDays().incident,
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
      mode: 'capacity',
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
    const result = await this.deleteOldestSegments({ mode: 'age', overrideDays });
    return { deletedSegmentsCount: result.deletedSegmentsCount, freedBytes: result.freedBytes };
  }

  /**
   * Deletes catalogued segments oldest-first, as far as the Retention Policy allows.
   * Under capacity pressure, quarantined segments go before any good footage.
   */
  private async deleteOldestSegments(opts: {
    mode: 'age' | 'capacity';
    overrideDays?: number;
    shouldContinue?: () => Promise<boolean>;
  }): Promise<{ deletedSegmentsCount: number; freedBytes: number; allRemainingProtected: boolean }> {
    let deletedSegmentsCount = 0;
    let freedBytes = 0;
    let allRemainingProtected = false;
    const passes = opts.mode === 'capacity' ? [['QUARANTINED'] as const, undefined] : [undefined];

    for (const statuses of passes) {
      let skip = 0;
      for (let iteration = 0; iteration < this.maxIterations; iteration++) {
        const candidates = await this.catalog.getOldestRecordings(this.batchSize, skip, statuses ? [...statuses] : undefined);
        if (candidates.length === 0) {
          allRemainingProtected = statuses === undefined && skip > 0;
          break;
        }
        // Checked only when there is something to delete: each check runs the write canary
        if (opts.shouldContinue && !(await opts.shouldContinue())) {
          return { deletedSegmentsCount, freedBytes, allRemainingProtected: false };
        }

        const deletable = new Set((await this.retention.deletable(candidates, opts.mode, opts.overrideDays)).map((s) => s.id));
        let batchDeleted = 0;
        for (const segment of candidates) {
          if (!deletable.has(segment.id)) {
            skip++;
            continue;
          }
          try {
            const res = await this.catalog.deleteSegmentInternal(segment.id, segment.filePath, Number(segment.sizeBytes));
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
          // Every remaining candidate is held
          allRemainingProtected = statuses === undefined;
          break;
        }
      }
    }

    return { deletedSegmentsCount, freedBytes, allRemainingProtected };
  }

}
