import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AuditLog } from '@prisma/client';
import { prisma } from '../db/prisma.js';

export interface CreateSnapshotAuditInput {
  imageBuffer: Buffer;
  userId: string;
  username: string;
  cameraId: string;
  timestampUtc: Date;
  streamProfile?: string;
  resolution?: string;
  playbackSegmentId?: string;
  mediaOffsetSeconds?: number;
  clientIp: string;
}

export interface SnapshotAuditResult {
  id: string;
  sha256: string;
  filename: string;
  filePath: string;
  downloadUrl: string;
}

export class AuditService {
  private readonly configuredDir?: string;

  constructor(storageDir?: string) {
    if (storageDir) {
      this.configuredDir = path.resolve(storageDir);
    }
  }

  getStorageDir(): string {
    return (
      this.configuredDir ||
      path.resolve(process.env.SNAPSHOTS_PATH || path.resolve(process.cwd(), 'recordings/snapshots'))
    );
  }

  async recordSnapshot(input: CreateSnapshotAuditInput): Promise<SnapshotAuditResult> {
    const storageDir = this.getStorageDir();
    await fs.mkdir(storageDir, { recursive: true });

    // Server-authoritative SHA-256 hash computed over exact persisted bytes
    const sha256 = crypto.createHash('sha256').update(input.imageBuffer).digest('hex');
    const safeCamId = input.cameraId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `SNAP_${safeCamId}_${Date.now()}_${sha256.slice(0, 8)}.jpg`;
    const filePath = path.join(storageDir, filename);

    // Persist exact bytes to storage
    await fs.writeFile(filePath, input.imageBuffer);

    let logEntry: AuditLog;
    try {
      logEntry = await prisma.auditLog.create({
        data: {
          userId: input.userId,
          username: input.username,
          action: 'SNAPSHOT_CAPTURED',
          cameraId: input.cameraId,
          timestampUtc: input.timestampUtc,
          streamProfile: input.streamProfile || null,
          resolution: input.resolution || null,
          playbackSegmentId: input.playbackSegmentId || null,
          mediaOffsetSeconds: input.mediaOffsetSeconds ?? null,
          sha256,
          filePath,
          clientIp: input.clientIp,
        },
      });
    } catch (err) {
      // Compensating file cleanup: fail-loud runtime ensures zero orphaned unindexed files on disk
      await fs.unlink(filePath).catch(() => {});
      throw err;
    }

    return {
      id: logEntry.id,
      sha256,
      filename,
      filePath,
      downloadUrl: `/api/audit/snapshot/${logEntry.id}/download`,
    };
  }

  async getSnapshotById(id: string): Promise<AuditLog | null> {
    return prisma.auditLog.findUnique({
      where: { id },
    });
  }
}

export const auditService = new AuditService();
