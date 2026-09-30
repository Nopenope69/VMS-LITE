import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import os from 'node:os';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BackupManifest {
  version: string;
  schemaVersion: string;
  createdAt: string;
  hostname: string;
  modelCounts: Record<string, number>;
  configSha256: string;
}

export interface BackupConfig {
  users: any[];
  cameras: any[];
  motionZones: any[];
  recordingSchedules: any[];
  cameraPermissions: any[];
  bookmarks: any[];
  webhookEndpoints: any[];
  notificationConfigs: any[];
}

export interface RestoreSummary {
  restored: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}

export type RestoreMode = 'skip-existing' | 'overwrite';

// ── Minimal POSIX tar builder (no external deps) ───────────────────────────────

function createTarEntry(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);

  // File name (100 bytes)
  header.write(name, 0, Math.min(name.length, 100), 'utf-8');

  // File mode (8 bytes) – 0644
  header.write('0000644\0', 100, 8, 'utf-8');

  // Owner UID (8 bytes) – 0
  header.write('0000000\0', 108, 8, 'utf-8');

  // Group GID (8 bytes) – 0
  header.write('0000000\0', 116, 8, 'utf-8');

  // File size in octal (12 bytes)
  const sizeOctal = content.length.toString(8).padStart(11, '0') + '\0';
  header.write(sizeOctal, 124, 12, 'utf-8');

  // Modification time (12 bytes) – current epoch
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
  header.write(mtime, 136, 12, 'utf-8');

  // Checksum placeholder (8 bytes of spaces for calculation)
  header.write('        ', 148, 8, 'utf-8');

  // Type flag – '0' for regular file
  header.write('0', 156, 1, 'utf-8');

  // USTAR magic
  header.write('ustar\0', 257, 6, 'utf-8');
  header.write('00', 263, 2, 'utf-8');

  // Calculate header checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');

  // Pad content to 512-byte boundary
  const paddingSize = (512 - (content.length % 512)) % 512;
  const padding = Buffer.alloc(paddingSize, 0);

  return Buffer.concat([header, content, padding]);
}

function buildTarGz(files: Array<{ name: string; content: Buffer }>): Buffer {
  const entries = files.map((f) => createTarEntry(f.name, f.content));
  // End-of-archive: two 512-byte zero blocks
  const endBlock = Buffer.alloc(1024, 0);
  const tarBuffer = Buffer.concat([...entries, endBlock]);
  return zlib.gzipSync(tarBuffer);
}

function extractTarGz(archive: Buffer): Map<string, Buffer> {
  let tarBuffer: Buffer;
  try {
    tarBuffer = zlib.gunzipSync(archive);
  } catch {
    throw new Error('Invalid gzip archive: decompression failed');
  }

  const files = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);

    // Check for end-of-archive (all zeros)
    if (header.every((b) => b === 0)) break;

    // Read file name (first 100 bytes, null-terminated)
    const nameEnd = header.indexOf(0, 0);
    const name = header.subarray(0, Math.min(nameEnd >= 0 ? nameEnd : 100, 100)).toString('utf-8');

    // Read file size (12 bytes at offset 124, octal)
    const sizeStr = header.subarray(124, 135).toString('utf-8').trim();
    const size = parseInt(sizeStr, 8);

    if (isNaN(size) || size < 0) {
      throw new Error(`Invalid tar entry size for "${name}"`);
    }

    offset += 512; // Past header

    if (size > 0) {
      const content = tarBuffer.subarray(offset, offset + size);
      files.set(name, Buffer.from(content));
      // Advance past content + padding
      offset += size + ((512 - (size % 512)) % 512);
    }
  }

  return files;
}

// ── Backup Service ─────────────────────────────────────────────────────────────

export async function createBackup(prisma: PrismaClient): Promise<Buffer> {
  // Query all config models
  const [
    users,
    cameras,
    motionZones,
    recordingSchedules,
    cameraPermissions,
    bookmarks,
    webhookEndpoints,
    notificationConfigs,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.camera.findMany(),
    prisma.motionZone.findMany(),
    prisma.recordingSchedule.findMany(),
    prisma.cameraPermission.findMany(),
    prisma.bookmark.findMany(),
    prisma.webhookEndpoint.findMany(),
    prisma.notificationConfig.findMany(),
  ]);

  const config: BackupConfig = {
    users: users.map((u) => ({ ...u })),
    cameras: cameras.map((c) => ({ ...c })),
    motionZones: motionZones.map((z) => ({ ...z })),
    recordingSchedules: recordingSchedules.map((s) => ({ ...s })),
    cameraPermissions: cameraPermissions.map((p) => ({ ...p })),
    bookmarks: bookmarks.map((b) => ({ ...b })),
    webhookEndpoints: webhookEndpoints.map((w) => ({ ...w })),
    notificationConfigs: notificationConfigs.map((n) => ({ ...n })),
  };

  const configBuffer = Buffer.from(JSON.stringify(config, null, 2), 'utf-8');

  // SHA-256 over exact config bytes
  const configSha256 = crypto.createHash('sha256').update(configBuffer).digest('hex');

  const manifest: BackupManifest = {
    version: '1.0',
    schemaVersion: 'vms-bare-v1',
    createdAt: new Date().toISOString(),
    hostname: os.hostname(),
    modelCounts: {
      users: users.length,
      cameras: cameras.length,
      motionZones: motionZones.length,
      recordingSchedules: recordingSchedules.length,
      cameraPermissions: cameraPermissions.length,
      bookmarks: bookmarks.length,
      webhookEndpoints: webhookEndpoints.length,
      notificationConfigs: notificationConfigs.length,
    },
    configSha256,
  };

  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');

  return buildTarGz([
    { name: 'manifest.json', content: manifestBuffer },
    { name: 'config.json', content: configBuffer },
  ]);
}

export async function restoreBackup(
  prisma: PrismaClient,
  archiveBuffer: Buffer,
  mode: RestoreMode = 'skip-existing',
): Promise<RestoreSummary> {
  // 1. Extract archive
  const files = extractTarGz(archiveBuffer);

  // 2. Validate manifest exists
  const manifestBuf = files.get('manifest.json');
  if (!manifestBuf) {
    throw new Error('Invalid backup archive: manifest.json not found');
  }

  const manifest: BackupManifest = JSON.parse(manifestBuf.toString('utf-8'));

  // 3. Validate schema version
  if (manifest.schemaVersion !== 'vms-bare-v1') {
    throw new Error(
      `Incompatible backup schema version: expected "vms-bare-v1", got "${manifest.schemaVersion}"`,
    );
  }

  // 4. Validate config.json exists and verify SHA-256
  const configBuf = files.get('config.json');
  if (!configBuf) {
    throw new Error('Invalid backup archive: config.json not found');
  }

  const actualSha256 = crypto.createHash('sha256').update(configBuf).digest('hex');
  if (actualSha256 !== manifest.configSha256) {
    throw new Error(
      `Backup integrity check failed: SHA-256 mismatch (expected ${manifest.configSha256}, got ${actualSha256})`,
    );
  }

  // 5. Parse config
  const config: BackupConfig = JSON.parse(configBuf.toString('utf-8'));

  // 6. Restore in dependency order within a transaction
  const summary: RestoreSummary = {
    restored: {},
    skipped: {},
    errors: [],
  };

  await prisma.$transaction(async (tx) => {
    // Users first (no FK dependencies)
    summary.restored.users = 0;
    summary.skipped.users = 0;
    for (const user of config.users) {
      try {
        if (mode === 'overwrite') {
          await tx.user.upsert({
            where: { id: user.id },
            create: sanitizeRecord(user),
            update: sanitizeRecordForUpdate(user),
          });
          summary.restored.users++;
        } else {
          const existing = await tx.user.findFirst({
            where: { OR: [{ id: user.id }, { username: user.username }] },
          });
          if (!existing) {
            await tx.user.create({ data: sanitizeRecord(user) });
            summary.restored.users++;
          } else {
            summary.skipped.users++;
          }
        }
      } catch (err: any) {
        summary.errors.push(`User ${user.username}: ${err.message}`);
      }
    }

    // Cameras (no FK dependency on Users)
    summary.restored.cameras = 0;
    summary.skipped.cameras = 0;
    for (const camera of config.cameras) {
      try {
        if (mode === 'overwrite') {
          await tx.camera.upsert({
            where: { id: camera.id },
            create: sanitizeCameraRecord(camera),
            update: sanitizeCameraRecordForUpdate(camera),
          });
          summary.restored.cameras++;
        } else {
          const existing = await tx.camera.findFirst({
            where: { OR: [{ id: camera.id }, { mediaMtxPath: camera.mediaMtxPath }] },
          });
          if (!existing) {
            await tx.camera.create({ data: sanitizeCameraRecord(camera) });
            summary.restored.cameras++;
          } else {
            summary.skipped.cameras++;
          }
        }
      } catch (err: any) {
        summary.errors.push(`Camera ${camera.name}: ${err.message}`);
      }
    }

    // Dependent models (FK on Camera and/or User)
    await restoreModelArray(tx, 'motionZone', config.motionZones, mode, summary);
    await restoreModelArray(tx, 'recordingSchedule', config.recordingSchedules, mode, summary);
    await restoreModelArray(tx, 'cameraPermission', config.cameraPermissions, mode, summary);
    await restoreModelArray(tx, 'bookmark', config.bookmarks, mode, summary);
    await restoreModelArray(tx, 'webhookEndpoint', config.webhookEndpoints, mode, summary);
    await restoreModelArray(tx, 'notificationConfig', config.notificationConfigs, mode, summary);
  });

  if (summary.errors.length > 0) {
    throw new Error(`Restore completed with errors: ${summary.errors.join('; ')}`);
  }

  return summary;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeRecord(record: any): any {
  const clean = { ...record };
  // Ensure dates are Date objects
  for (const key of Object.keys(clean)) {
    if (typeof clean[key] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(clean[key])) {
      clean[key] = new Date(clean[key]);
    }
  }
  return clean;
}

function sanitizeRecordForUpdate(record: any): any {
  const clean = sanitizeRecord(record);
  delete clean.id;
  return clean;
}

function sanitizeCameraRecord(record: any): any {
  const clean = sanitizeRecord(record);
  // Remove relation fields that Prisma doesn't accept on create
  delete clean.recordings;
  delete clean.schedules;
  delete clean.cameraPermissions;
  delete clean.bookmarks;
  delete clean.exportJobs;
  delete clean.motionZones;
  return clean;
}

function sanitizeCameraRecordForUpdate(record: any): any {
  const clean = sanitizeCameraRecord(record);
  delete clean.id;
  return clean;
}

async function restoreModelArray(
  tx: any,
  modelName: string,
  records: any[],
  mode: RestoreMode,
  summary: RestoreSummary,
): Promise<void> {
  summary.restored[modelName] = 0;
  summary.skipped[modelName] = 0;

  const delegate = (tx as any)[modelName];
  if (!delegate) {
    summary.errors.push(`Unknown model: ${modelName}`);
    return;
  }

  for (const record of records) {
    try {
      const clean = sanitizeRecord(record);
      // Remove relation fields
      delete clean.camera;
      delete clean.user;
      delete clean.recordings;
      delete clean.schedules;
      delete clean.cameraPermissions;
      delete clean.bookmarks;
      delete clean.exportJobs;
      delete clean.motionZones;

      if (mode === 'overwrite') {
        await delegate.upsert({
          where: { id: record.id },
          create: clean,
          update: sanitizeRecordForUpdate(clean),
        });
        summary.restored[modelName]++;
      } else {
        const existing = await delegate.findUnique({ where: { id: record.id } });
        if (!existing) {
          await delegate.create({ data: clean });
          summary.restored[modelName]++;
        } else {
          summary.skipped[modelName]++;
        }
      }
    } catch (err: any) {
      summary.errors.push(`${modelName} ${record.id}: ${err.message}`);
    }
  }
}

// Re-export tar helpers for testing
export { buildTarGz, extractTarGz };
