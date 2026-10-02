import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { BackupScheduler, backupScheduler } from '../src/system/backup-scheduler.js';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { restoreBackup } from '../src/system/backup.service.js';
import { createServer } from '../src/server.js';
import { signAs } from './helpers/auth.js';

describe('Automatic backups', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-backups-'));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('backs up once a day, keeps the newest N and writes private files', async () => {
    const prisma = createMockPrisma();
    await prisma.site.create({ data: { id: 's1', name: 'Branch A' } });
    const scheduler = new BackupScheduler(prisma as any, dir, 3);

    const first = await scheduler.runIfDue(new Date('2026-10-01T00:00:00Z'));
    expect(first).toBe('vms-backup-2026-10-01T00-00-00Z.tar.gz');
    expect(await scheduler.runIfDue(new Date('2026-10-01T12:00:00Z'))).toBeNull(); // not due yet
    for (const day of ['02', '03', '04', '05']) {
      await scheduler.runIfDue(new Date(`2026-10-${day}T00:00:00Z`));
    }

    const files = await scheduler.list();
    expect(files.map((f) => f.createdAt)).toEqual([
      '2026-10-05T00:00:00.000Z',
      '2026-10-04T00:00:00.000Z',
      '2026-10-03T00:00:00.000Z',
    ]);
    const mode = (await fs.stat(path.join(dir, files[0].name))).mode & 0o777;
    expect(mode).toBe(0o600);

    // The archive restores
    const target = createMockPrisma();
    await restoreBackup(target as any, (await scheduler.read(files[0].name))!);
    expect((await target.site.findUnique({ where: { id: 's1' } }))?.name).toBe('Branch A');
  });

  it('only serves well-formed backup names', async () => {
    const scheduler = new BackupScheduler(createMockPrisma() as any, dir);
    expect(await scheduler.read('../../etc/passwd')).toBeNull();
    expect(await scheduler.read('vms-backup-2026-10-05T00-00-00Z.tar.gz.partial')).toBeNull();
  });
});

describe('Backup API', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists and downloads automatic backups for admins only', async () => {
    const admin = await signAs(app, { id: 'bk-admin', username: 'bk-admin', role: 'ADMIN' });
    const operator = await signAs(app, { id: 'bk-op', username: 'bk-op', role: 'OPERATOR' });
    const name = await backupScheduler.runNow();

    const list = await app.inject({ url: '/api/system/backups', headers: { authorization: `Bearer ${admin}` } });
    expect(list.json().backups.map((b: any) => b.name)).toContain(name);
    const download = await app.inject({ url: `/api/system/backups/${name}`, headers: { authorization: `Bearer ${admin}` } });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/gzip');

    const denied = await app.inject({ url: '/api/system/backups', headers: { authorization: `Bearer ${operator}` } });
    expect(denied.statusCode).toBe(403);
    const missing = await app.inject({ url: '/api/system/backups/nope.tar.gz', headers: { authorization: `Bearer ${admin}` } });
    expect(missing.statusCode).toBe(404);
    await fs.rm(path.join(backupScheduler.dir, name), { force: true });
  });
});
