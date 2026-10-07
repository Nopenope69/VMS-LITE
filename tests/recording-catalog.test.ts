import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { signAs } from './helpers/auth.js';
import { seedRecording } from './helpers/recordings.js';

describe('Recording Catalog Routes (/api/recordings)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
    const { prisma: seedPrisma } = await import('../src/db/prisma.js');
    if (!(await seedPrisma.camera.findUnique({ where: { id: 'cam_front_gate' } }))) {
      await seedPrisma.camera.create({
        data: { id: 'cam_front_gate', name: 'Front Gate', rtspUrl: 'rtsp://10.0.0.2/stream', mediaMtxPath: 'cam_front_gate', recordingMode: 'CONTINUOUS' },
      });
    }
    if (!(await seedPrisma.camera.findUnique({ where: { id: 'cam_test_1' } }))) {
      await seedPrisma.camera.create({
        data: { id: 'cam_test_1', name: 'cam_test_1', rtspUrl: 'rtsp://10.0.0.1/stream', mediaMtxPath: 'cam_test_1', recordingMode: 'CONTINUOUS' },
      });
    }

    await seedRecording({ cameraId: 'cam_front_gate', mediaMtxPath: 'cam_front_gate', startTime: '2026-09-24T11:00:00Z', durationSeconds: 60.5 });

    adminToken = await signAs(app, {
      id: 'admin-id',
      username: 'admin',
      role: Role.ADMIN,
    });

    viewerToken = await signAs(app, {
      id: 'viewer-id',
      username: 'viewer',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/recordings Catalog Querying', () => {
    it('returns 401 Unauthorized for unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recordings',
      });
      expect(res.statusCode).toBe(401);
    });

    it('allows Viewer to query recordings catalog', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recordings',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.recordings)).toBe(true);
      expect(body.count).toBeGreaterThanOrEqual(1);
    });

    it('retrieves single recording segment details by ID', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/recordings',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      const segment = listRes.json().recordings[0];

      const res = await app.inject({
        method: 'GET',
        url: `/api/recordings/${segment.id}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(segment.id);
      expect(typeof res.json().sizeBytes).toBe('number'); // Safe BigInt handling (T-03-03)
    });

    it('returns 404 for non-existent segment ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recordings/non-existent-uuid',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Recording Schedules (/api/recordings/schedules/:cameraId)', () => {
    it('returns default schedule for camera', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recordings/schedules/cam_test_1',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.schedule.mode).toBe('CONTINUOUS');
    });

    it('rejects schedule updates from VIEWER role (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/schedules/cam_test_1',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          mode: 'SCHEDULED',
          windows: [{ dayOfWeek: 1, startHour: 8, startMin: 0, endHour: 17, endMin: 0 }],
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows ADMIN to update recording schedule', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/schedules/cam_test_1',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          mode: 'SCHEDULED',
          windows: [{ dayOfWeek: 1, startHour: 8, startMin: 0, endHour: 17, endMin: 0 }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.schedule.mode).toBe('SCHEDULED');
      expect(body.schedule.windows).toHaveLength(1);
    });
  });

  describe('Storage Management (/api/recordings/storage)', () => {
    it('allows Viewer to inspect storage metrics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recordings/storage',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.metrics.totalBytes).toBeGreaterThan(0);
      expect(body.metrics.warningThresholdPercent).toBe(80);
      expect(body.metrics.criticalThresholdPercent).toBe(90);
    });

    it('rejects storage cleanup trigger from VIEWER role (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/storage/cleanup',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows ADMIN to trigger storage check and cleanup', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/storage/cleanup',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(['ok', 'warning', 'critical']).toContain(body.status);
    });
  });
});
