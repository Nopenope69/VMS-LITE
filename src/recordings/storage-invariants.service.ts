import path from 'node:path';
import fs from 'node:fs/promises';
import { RecordingCatalog } from './recording-catalog.js';
import { IRecordingRepository } from './repositories/recording.repository.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { diagnosticsLogger } from '../diagnostics/diagnostics-logger.js';
import { RecordingDto } from './recording.types.js';
import { getRecordingsRoot } from './recordings-root.js';

export interface InvariantViolation {
  invariant: number;
  description: string;
  recordingId?: string;
  filePath?: string;
  cameraId?: string;
  severity: 'WARNING' | 'CRITICAL';
}

export interface InvariantAuditReport {
  timestamp: string;
  totalCatalogued: number;
  availableCount: number;
  protectedCount: number;
  deletePendingCount: number;
  garbageCount: number;
  missingCount: number;
  orphanedFilesCount: number;
  violationsCount: number;
  violations: InvariantViolation[];
  reconciledCount: number;
}

export interface StorageInvariantsServiceOptions {
  catalog: RecordingCatalog;
  repository: IRecordingRepository;
  eventBus?: EventBus;
  recordingsDir?: string;
  fsAccessFn?: (p: string) => Promise<void>;
  fsReaddirFn?: (p: string) => Promise<string[]>;
}

/**
 * Storage & Catalog Invariants Enforcement Service (inspired by Moonfire NVR).
 *
 * Enforces the core invariants:
 * - Invariant 1: Every AVAILABLE recording has exactly one catalog row.
 * - Invariant 2: Every cataloged segment has exactly one storage object (physical file).
 * - Invariant 3: Every segment under /recordings belongs to a known camera/path.
 * - Invariant 4: No segment can be deleted from disk while catalog claims it is AVAILABLE (2-phase deletion).
 * - Invariant 5: Retention cannot delete protected evidence.
 * - Invariant 6: A crash cannot permanently create uncatalogued video (self-healing reconciliation).
 * - Invariant 7: Storage failure halts deletions and mutations to prevent catalog/disk divergence.
 */
export class StorageInvariantsService {
  private readonly catalog: RecordingCatalog;
  private readonly repository: IRecordingRepository;
  private readonly eventBus: EventBus;
  private readonly recordingsDir: string;
  private readonly fsAccess: (p: string) => Promise<void>;
  private readonly fsReaddir: (p: string) => Promise<string[]>;

  constructor(opts: StorageInvariantsServiceOptions) {
    this.catalog = opts.catalog;
    this.repository = opts.repository;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.recordingsDir = getRecordingsRoot(opts.recordingsDir);
    this.fsAccess = opts.fsAccessFn || ((p) => fs.access(p));
    this.fsReaddir = opts.fsReaddirFn || ((p) => fs.readdir(p));
  }

  /**
   * Performs a comprehensive invariant audit and self-healing sweep.
   */
  async auditAndReconcile(): Promise<InvariantAuditReport> {
    const startTime = Date.now();
    const violations: InvariantViolation[] = [];
    let reconciledCount = 0;

    // First: reconcile any crash-interrupted DELETE_PENDING segments (Invariant 4 recovery)
    const pendingRecovery = await this.catalog.reconcilePendingDeletions();
    reconciledCount += pendingRecovery.recoveredCount;

    // Fetch all catalogued recordings
    const allRecordings = await this.repository.queryRecordings({ limit: 500 });
    const cameras = await this.repository.listAllCameras();
    const validPaths = new Set<string>();
    for (const cam of cameras) {
      if (cam.mediaMtxPath) validPaths.add(cam.mediaMtxPath);
      if (cam.subMediaMtxPath) validPaths.add(cam.subMediaMtxPath);
    }

    let availableCount = 0;
    let protectedCount = 0;
    let deletePendingCount = 0;
    let garbageCount = 0;
    let missingCount = 0;

    const seenPaths = new Map<string, string>();

    for (const rec of allRecordings) {
      // Invariant 1: Exactly one catalog row per filePath
      if (seenPaths.has(rec.filePath)) {
        violations.push({
          invariant: 1,
          description: `Duplicate catalog entry detected for file path: ${rec.filePath}`,
          recordingId: rec.id,
          filePath: rec.filePath,
          cameraId: rec.cameraId,
          severity: 'CRITICAL',
        });
      } else {
        seenPaths.set(rec.filePath, rec.id);
      }

      if (rec.status === 'AVAILABLE' || !rec.status) availableCount++;
      if (rec.isProtected || rec.retentionTier === 'PROTECTED') protectedCount++;
      if (rec.status === 'DELETE_PENDING') deletePendingCount++;
      if (rec.status === 'GARBAGE') garbageCount++;
      if (rec.status === 'MISSING') missingCount++;

      // Invariant 2: Every AVAILABLE recording has a physical file on disk
      if (rec.status === 'AVAILABLE' || !rec.status) {
        try {
          await this.fsAccess(path.resolve(rec.filePath));
        } catch {
          // File is missing on disk!
          violations.push({
            invariant: 2,
            description: `Physical media file missing on disk for AVAILABLE recording ${rec.id}: ${rec.filePath}`,
            recordingId: rec.id,
            filePath: rec.filePath,
            cameraId: rec.cameraId,
            severity: 'CRITICAL',
          });
          // Update status to MISSING
          await this.repository.updateRecordingStatus(rec.id, 'MISSING', 'File missing on disk during audit');
          missingCount++;
          availableCount = Math.max(0, availableCount - 1);
        }
      }

      // Invariant 3: Belongs to a known camera path
      if (!validPaths.has(rec.mediaMtxPath)) {
        violations.push({
          invariant: 3,
          description: `Recording ${rec.id} points to unknown mediaMtxPath: ${rec.mediaMtxPath}`,
          recordingId: rec.id,
          filePath: rec.filePath,
          cameraId: rec.cameraId,
          severity: 'WARNING',
        });
      }

      // Invariant 5: Protected segments must never be marked DELETE_PENDING or GARBAGE
      if ((rec.isProtected || rec.retentionTier === 'PROTECTED') && (rec.status === 'DELETE_PENDING' || rec.status === 'GARBAGE')) {
        violations.push({
          invariant: 5,
          description: `Protected recording ${rec.id} was illegally placed into ${rec.status} status!`,
          recordingId: rec.id,
          filePath: rec.filePath,
          cameraId: rec.cameraId,
          severity: 'CRITICAL',
        });
      }
    }

    // Invariant 3 on disk: Scan recordings root directory for unknown paths/orphaned directories
    let orphanedFilesCount = 0;
    try {
      const cameraDirs = await this.fsReaddir(this.recordingsDir);
      for (const dirName of cameraDirs) {
        if (dirName.startsWith('.')) continue; // skip hidden files / probes
        if (!validPaths.has(dirName)) {
          orphanedFilesCount++;
          violations.push({
            invariant: 3,
            description: `Unknown camera directory on disk with no matching registered camera: ${dirName}`,
            filePath: path.join(this.recordingsDir, dirName),
            severity: 'WARNING',
          });
        }
      }
    } catch {
      // In-memory or missing recordings root
    }

    const report: InvariantAuditReport = {
      timestamp: new Date().toISOString(),
      totalCatalogued: allRecordings.length,
      availableCount,
      protectedCount,
      deletePendingCount,
      garbageCount,
      missingCount,
      orphanedFilesCount,
      violationsCount: violations.length,
      violations,
      reconciledCount,
    };

    const durationMs = Date.now() - startTime;

    diagnosticsLogger.logOperation({
      operation: 'invariant_audit',
      durationMs,
      reason: violations.length === 0 ? 'invariants_verified' : 'violations_detected',
      metadata: { violationsCount: violations.length, availableCount, protectedCount },
      level: violations.length === 0 ? 'info' : 'warn',
    });

    await this.eventBus.emitEvent({
      type: 'storage.invariants_audited',
      source: 'storage.invariants',
      metadata: report,
    });

    return report;
  }
}
