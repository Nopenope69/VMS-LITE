import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';
import { signAs } from './helpers/auth.js';
import { extendedLicense } from './helpers/license.js';
import { seedRecording } from './helpers/recordings.js';
import { applyCameraAccess } from '../src/users/camera-scope.js';

/**
 * Who may reach which camera's data, route by route. Operator "op" holds every right on
 * camera A and nothing on camera B; "op-playback" may only play back camera A.
 */
describe('Camera access matrix', () => {
  let app: FastifyInstance;
  let tmp: string;
  const token: Record<string, string> = {};
  const cam: Record<'A' | 'B', string> = { A: '', B: '' };
  const res: Record<string, Record<'A' | 'B', string>> = { recording: { A: '', B: '' }, exportJob: { A: '', B: '' }, bookmark: { A: '', B: '' }, snapshot: { A: '', B: '' } };

  const call = (who: string, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${token[who]}` } });
  const status = async (who: string, method: string, url: string, payload?: unknown) =>
    (await call(who, method, url, payload)).statusCode;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-access-matrix-'));
    app = await createServer({ logger: false, licensing: await extendedLicense() });
    await app.ready();
    token.admin = await signAs(app, { id: 'am-admin', role: 'ADMIN' });
    token.viewer = await signAs(app, { id: 'am-viewer', role: 'VIEWER' });
    token.op = await signAs(app, { id: 'am-op', role: 'OPERATOR' });
    token.opPlayback = await signAs(app, { id: 'am-op-playback', role: 'OPERATOR' });

    for (const key of ['A', 'B'] as const) {
      const created = await call('admin', 'POST', '/api/cameras', { name: `Matrix ${key}`, rtspUrl: `rtsp://10.9.0.${key === 'A' ? 1 : 2}/s` });
      expect(created.statusCode).toBe(201);
      cam[key] = created.json().id;
      const camera = created.json();

      res.recording[key] = (await seedRecording({ cameraId: cam[key], mediaMtxPath: camera.mediaMtxPath, startTime: '2026-10-06T10:00:00Z' })).id;
      const exportFile = path.join(tmp, `export-${key}.mp4`);
      await fs.writeFile(exportFile, 'mp4');
      res.exportJob[key] = (await prisma.exportJob.create({
        data: { cameraId: cam[key], startTime: new Date('2026-10-06T10:00:00Z'), endTime: new Date('2026-10-06T10:01:00Z'), status: 'COMPLETED', filePath: exportFile, expiresAt: new Date(Date.now() + 86_400_000) },
      })).id;
      res.bookmark[key] = (await prisma.bookmark.create({
        data: { cameraId: cam[key], timestamp: new Date('2026-10-06T10:00:30Z'), title: `Bookmark ${key}` },
      })).id;
      const snapshotFile = path.join(tmp, `snapshot-${key}.jpg`);
      await fs.writeFile(snapshotFile, 'jpg');
      res.snapshot[key] = (await prisma.auditLog.create({
        data: { action: 'SNAPSHOT_CAPTURED', cameraId: cam[key], filePath: snapshotFile },
      })).id;
    }

    await prisma.cameraPermission.create({
      data: { userId: 'am-op', cameraId: cam.A, canViewLive: true, canViewPlayback: true, canControlPtz: true, canExportClips: true },
    });
    await prisma.cameraPermission.create({
      data: { userId: 'am-op-playback', cameraId: cam.A, canViewLive: false, canViewPlayback: true, canControlPtz: false, canExportClips: false },
    });
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  describe('an operator reaches only granted cameras', () => {
    it('recordings: list, by id, schedule and motion buffer', async () => {
      const list = (await call('op', 'GET', '/api/recordings?limit=500')).json().recordings;
      expect(list.map((r: any) => r.cameraId)).not.toContain(cam.B);
      expect(list.map((r: any) => r.cameraId)).toContain(cam.A);
      expect(await status('op', 'GET', `/api/recordings?cameraId=${cam.B}`)).toBe(403);
      expect(await status('op', 'GET', `/api/recordings/${res.recording.B}`)).toBe(403);
      expect(await status('op', 'GET', `/api/recordings/${res.recording.A}`)).toBe(200);
      expect(await status('op', 'GET', `/api/recordings/schedules/${cam.B}`)).toBe(403);
      expect(await status('op', 'GET', `/api/recordings/schedules/${cam.A}`)).toBe(200);
      expect(await status('op', 'GET', `/api/recordings/motion-buffer/status?cameraId=${cam.B}`)).toBe(403);
    });

    it('exports: status, download and bundle', async () => {
      for (const suffix of ['', '/download', '/bundle']) {
        expect(await status('op', 'GET', `/api/recordings/export/${res.exportJob.B}${suffix}`)).toBe(403);
        expect(await status('op', 'GET', `/api/recordings/export/${res.exportJob.A}${suffix}`)).not.toBe(403);
      }
    });

    it('bookmarks: deletes only bookmarks of the camera in the URL, on a granted camera', async () => {
      expect(await status('op', 'DELETE', `/api/cameras/${cam.B}/bookmarks/${res.bookmark.B}`)).toBe(403);
      expect(await status('op', 'DELETE', `/api/cameras/${cam.A}/bookmarks/${res.bookmark.B}`)).toBe(404);
      expect(await prisma.bookmark.findUnique({ where: { id: res.bookmark.B } })).not.toBeNull();
    });

    it('zones and health', async () => {
      expect(await status('op', 'GET', `/api/cameras/${cam.B}/zones`)).toBe(403);
      expect(await status('op', 'POST', `/api/cameras/${cam.B}/zones/test`, { x: 0.5, y: 0.5 })).toBe(403);
      expect(await status('op', 'GET', `/api/cameras/${cam.A}/zones`)).toBe(200);
      expect(await status('op', 'GET', `/api/cameras/${cam.B}/health`)).toBe(403);
      const health = (await call('op', 'GET', '/api/cameras/health')).json();
      expect(Object.keys(health.cameras ?? {})).not.toContain(cam.B);
    });

    it('snapshots: capture and download', async () => {
      const image = `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}`;
      expect(await status('op', 'POST', '/api/audit/snapshot', { cameraId: cam.B, image })).toBe(403);
      expect(await status('op', 'GET', `/api/audit/snapshot/${res.snapshot.B}/download`)).toBe(403);
      expect(await status('op', 'GET', `/api/audit/snapshot/${res.snapshot.A}/download`)).toBe(200);
    });

    it('camera details need live or playback rights', async () => {
      expect(await status('opPlayback', 'GET', `/api/cameras/${cam.A}`)).toBe(200);
      expect(await status('opPlayback', 'GET', `/api/cameras/${cam.B}`)).toBe(403);
    });
  });

  describe('viewers', () => {
    it('see every camera but cannot download exports', async () => {
      const list = (await call('viewer', 'GET', '/api/recordings?limit=500')).json().recordings;
      expect(list.map((r: any) => r.cameraId)).toEqual(expect.arrayContaining([cam.A, cam.B]));
      expect(await status('viewer', 'GET', `/api/recordings/export/${res.exportJob.B}`)).toBe(200);
      expect(await status('viewer', 'GET', `/api/recordings/export/${res.exportJob.B}/download`)).toBe(403);
      expect(await status('viewer', 'GET', `/api/recordings/export/${res.exportJob.B}/bundle`)).toBe(403);
    });
  });

  describe('admins', () => {
    it('reach every camera', async () => {
      expect(await status('admin', 'GET', `/api/recordings/${res.recording.B}`)).toBe(200);
      expect(await status('admin', 'GET', `/api/recordings/export/${res.exportJob.B}/download`)).toBe(200);
      expect(await status('admin', 'GET', `/api/audit/snapshot/${res.snapshot.B}/download`)).toBe(200);
    });
  });

  describe('/api/auth/me', () => {
    it('reports effective per-camera rights for every role, so clients need no role rules', async () => {
      const rights = async (who: string) =>
        Object.fromEntries((await call(who, 'GET', '/api/auth/me')).json().user.cameraPermissions.map((p: any) => [p.cameraId, p]));

      expect((await rights('viewer'))[cam.B]).toMatchObject({ canViewLive: true, canViewPlayback: true, canControlPtz: false, canExportClips: false });
      expect((await rights('admin'))[cam.B]).toMatchObject({ canViewLive: true, canExportClips: true, canControlPtz: true });
      expect((await rights('op'))[cam.B]).toBeUndefined();
    });
  });

  describe('route declarations', () => {
    it('refuses to register a camera-related route that does not declare its camera access', () => {
      const route = { method: 'GET', url: '/api/recordings/new-thing', handler: async () => ({}) } as any;
      expect(() => applyCameraAccess(route)).toThrow(/must declare config.cameraAccess/);
      expect(() => applyCameraAccess({ ...route, url: '/api/settings/x' })).not.toThrow();
    });
  });
});
