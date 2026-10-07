import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { cameraService } from '../src/cameras/camera.service.js';
import { seedRecording } from './helpers/recordings.js';
import { signAs } from './helpers/auth.js';

describe('Playback API (/api/playback) (PLAY-01, PLAY-03)', () => {
  let app: FastifyInstance;
  let viewerToken: string;
  let adminToken: string;
  let testCameraId: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    viewerToken = await signAs(app, {
      id: 'viewer-user-id',
      username: 'viewer',
      role: Role.VIEWER,
    });

    adminToken = await signAs(app, {
      id: 'admin-user-id',
      username: 'admin',
      role: Role.ADMIN,
    });

    const camera = await cameraService.onboardManualCamera(
      {
        name: 'Warehouse North',
        rtspUrl: 'rtsp://192.168.1.120:554/live',
      },
      10
    );
    testCameraId = camera.id;

    // Ingest dummy recorded segment for this camera using today's date
    const todayStr = new Date().toISOString().split('T')[0];
    await seedRecording({
      cameraId: camera.id,
      mediaMtxPath: camera.mediaMtxPath,
      startTime: `${todayStr}T10:00:00Z`,
      durationSeconds: 120,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/playback/timeline (PLAY-01)', () => {
    it('returns 401 Unauthorized for unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/timeline?cameraId=${testCameraId}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 ValidationError if cameraId is omitted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/playback/timeline',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('ValidationError');
    });

    it('rejects query ranges exceeding 24 hours (T-05-03)', async () => {
      const start = new Date('2026-09-20T00:00:00Z').toISOString();
      const end = new Date('2026-09-22T00:00:00Z').toISOString(); // 48h range

      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/timeline?cameraId=${testCameraId}&startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(end)}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('ValidationError');
    });

    it('returns recorded spans for 24-hour date query', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/timeline?cameraId=${testCameraId}&date=${todayStr}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.cameraId).toBe(testCameraId);
      expect(body.date).toBe(todayStr);
      expect(Array.isArray(body.spans)).toBe(true);
      expect(body.spans.length).toBeGreaterThanOrEqual(1);
      expect(body.spans[0].durationSeconds).toBe(120);
      expect(body.playbackBaseUrl).toBe('/api/media/playback');
    });
  });

  describe('GET /api/playback/stream (PLAY-03)', () => {
    it('returns 401 Unauthorized for unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/stream?cameraId=${testCameraId}&startTime=${encodeURIComponent(new Date().toISOString())}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for non-existent camera', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/stream?cameraId=non-existent-cam&startTime=${encodeURIComponent(new Date().toISOString())}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('resolves MediaMTX fMP4 playback URL with start time and duration', async () => {
      const nowIso = new Date().toISOString();
      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/stream?cameraId=${testCameraId}&startTime=${encodeURIComponent(nowIso)}&duration=600`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.cameraId).toBe(testCameraId);
      expect(body.fmp4StreamUrl).toContain('/api/media/playback/get?path=');
      expect(body.fmp4StreamUrl).toContain('start=');
      expect(body.fmp4StreamUrl).toContain('duration=600');
      expect(body.duration).toBe(600);
    });
  });
});
