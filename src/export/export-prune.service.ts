import fs from 'node:fs/promises';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { DiskUsageStatus, ExportJobDto } from './export.types.js';
import { ExportService, exportService as defaultExportService } from './export.service.js';

export interface PruneServiceOptions {
  prisma?: any;
  exportService?: ExportService;
  unlinkFn?: (filePath: string) => Promise<void>;
  getDiskUsageFn?: () => Promise<DiskUsageStatus>;
}

export class ExportPruneService {
  public static readonly EXPORT_PRUNE_THRESHOLD = 0.85; // 85% normal capacity threshold
  public static readonly EMERGENCY_THRESHOLD = 0.90; // 90% emergency capacity threshold

  private readonly prisma: any;
  private readonly exportService: ExportService;
  private readonly unlinkFn: (filePath: string) => Promise<void>;
  private readonly getDiskUsageFn?: () => Promise<DiskUsageStatus>;

  constructor(opts: PruneServiceOptions = {}) {
    this.prisma = opts.prisma || defaultPrisma;
    this.exportService = opts.exportService || defaultExportService;
    this.unlinkFn = opts.unlinkFn || (async (p) => fs.unlink(p));
    this.getDiskUsageFn = opts.getDiskUsageFn;
  }

  /**
   * Prunes all exports whose 48-hour TTL has expired.
   * Unlinks files from disk and transitions status to EXPIRED.
   */
  async pruneExpiredExports(now: Date = new Date()): Promise<number> {
    let prunedCount = 0;
    const allJobs = await this.exportService.listExportJobs();

    for (const job of allJobs) {
      if (job.status === 'COMPLETED' && new Date(job.expiresAt) <= now) {
        if (job.filePath) {
          try {
            await this.unlinkFn(job.filePath);
          } catch {
            // File might already have been unlinked
          }
        }
        await this.updateJobStatus(job.id, 'EXPIRED');
        prunedCount++;
      }
    }

    return prunedCount;
  }

  /**
   * Enforces the two-tier disk cleanup hierarchy:
   * 1. If usage >= 85%: prunes expired exports (>48h TTL).
   * 2. If usage >= 90%: emergency purge of unexpired exports (FIFO oldest first).
   * Note: Continuous recordings are NEVER deleted merely because exports exist.
   */
  async enforceStorageHierarchy(simulatedUsageRatio?: number): Promise<{
    expiredPruned: number;
    emergencyPruned: number;
    usageRatio: number;
  }> {
    let usageRatio = simulatedUsageRatio ?? 0;
    if (simulatedUsageRatio === undefined && this.getDiskUsageFn) {
      const disk = await this.getDiskUsageFn();
      usageRatio = disk.usageRatio;
    }

    let expiredPruned = 0;
    let emergencyPruned = 0;

    // Normal tier: usage >= 85%
    if (usageRatio >= ExportPruneService.EXPORT_PRUNE_THRESHOLD) {
      expiredPruned = await this.pruneExpiredExports();
    }

    // Emergency tier: usage >= 90%
    if (usageRatio >= ExportPruneService.EMERGENCY_THRESHOLD) {
      // Find unexpired completed exports in FIFO order (oldest createdAt first)
      const allJobs = await this.exportService.listExportJobs();
      const unexpired = allJobs
        .filter((j) => j.status === 'COMPLETED' && new Date(j.expiresAt) > new Date())
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      for (const job of unexpired) {
        if (job.filePath) {
          try {
            await this.unlinkFn(job.filePath);
          } catch {
            // Ignore if file missing
          }
        }
        await this.updateJobStatus(job.id, 'EXPIRED');
        emergencyPruned++;
      }
    }

    return {
      expiredPruned,
      emergencyPruned,
      usageRatio,
    };
  }

  private async updateJobStatus(id: string, status: 'EXPIRED'): Promise<void> {
    const job = await this.exportService.getExportJob(id);
    if (job) {
      const updated: ExportJobDto = {
        ...job,
        status,
      };
      // Updates via exportService internal persistence
      await (this.exportService as any).persistJob(updated);
    }
  }
}

export const exportPruneService = new ExportPruneService();
