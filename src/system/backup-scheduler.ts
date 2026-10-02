import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createBackup } from './backup.service.js';
import { prisma as defaultPrisma } from '../db/prisma.js';

/**
 * Daily configuration backups (sites, cameras, users, permissions, schedules...),
 * written to BACKUPS_PATH (default: data/backups, the app's data volume in docker).
 * Recordings are not included.
 *
 * Runs at startup when the newest backup is older than a day, then every 24h; keeps
 * the newest BACKUP_RETENTION_COUNT archives (default 14). AUTO_BACKUP=false turns
 * it off. Archives contain password hashes and camera credentials: files are 0600.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_PATTERN = /^vms-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.tar\.gz$/;

export interface BackupFileInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

export class BackupScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    readonly dir: string = process.env.BACKUPS_PATH || path.resolve(process.cwd(), 'data', 'backups'),
    private readonly keep: number = Math.max(1, Number(process.env.BACKUP_RETENTION_COUNT) || 14)
  ) {}

  static isBackupFileName(name: string): boolean {
    return FILE_PATTERN.test(name);
  }

  start(): void {
    if (this.timer || process.env.AUTO_BACKUP === 'false') return;
    const tick = () =>
      this.runIfDue().catch((err) => console.warn('[Backup] Scheduled backup failed:', err?.message ?? err));
    tick();
    this.timer = setInterval(tick, 60 * 60 * 1000); // checks hourly, backs up daily
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Creates a backup when the newest one is a day old (or none exists). */
  async runIfDue(now = new Date()): Promise<string | null> {
    const [newest] = await this.list();
    if (newest && now.getTime() - Date.parse(newest.createdAt) < DAY_MS) return null;
    return this.runNow(now);
  }

  async runNow(now = new Date()): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const archive = await createBackup(this.prisma);
    const name = `vms-backup-${now.toISOString().slice(0, 19).replace(/:/g, '-')}Z.tar.gz`;
    const target = path.join(this.dir, name);
    const temp = `${target}.partial`;
    await fs.writeFile(temp, archive, { mode: 0o600 });
    await fs.rename(temp, target);
    await this.prune();
    return name;
  }

  /** Newest first */
  async list(): Promise<BackupFileInfo[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const files: BackupFileInfo[] = [];
    for (const name of names.filter((n) => BackupScheduler.isBackupFileName(n))) {
      const stat = await fs.stat(path.join(this.dir, name));
      files.push({ name, sizeBytes: stat.size, createdAt: fileNameDate(name) });
    }
    return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async read(name: string): Promise<Buffer | null> {
    if (!BackupScheduler.isBackupFileName(name)) return null;
    try {
      return await fs.readFile(path.join(this.dir, name));
    } catch {
      return null;
    }
  }

  private async prune(): Promise<void> {
    const files = await this.list();
    for (const old of files.slice(this.keep)) {
      await fs.rm(path.join(this.dir, old.name), { force: true });
    }
  }
}

function fileNameDate(name: string): string {
  // vms-backup-2026-10-02T08-30-00Z.tar.gz -> 2026-10-02T08:30:00Z
  const stamp = name.slice('vms-backup-'.length, -'.tar.gz'.length);
  const [date, time] = stamp.split('T');
  return new Date(`${date}T${time.replace(/-/g, ':')}`).toISOString();
}

export const backupScheduler = new BackupScheduler(defaultPrisma);
