import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { cameraService } from '../src/cameras/camera.service.js';

describe('Streaming Routes (/api/streaming)', () => {
  let app: FastifyInstance;
  let viewerToken: string;
  let adminToken: string;
  let testCameraId: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    viewerToken = app.jwt.sign({
      id: 'viewer-user-id',
      username: 'viewer',
      role: Role.VIEWER,
    });

    adminToken = app.jwt.sign({
      id: 'admin-user-id',
      username: 'admin',
      role: Role.ADMIN,
    });

    // Create a manual test camera in memory/db
    const camera = await cameraService.onboardManualCamera(
      {
        name: 'Main Gate Test',
        rtspUrl: 'rtsp://192.168.1.100:554/stream1',
        subStreamUrl: 'rtsp://192.168.1.100:554/stream2',
      },
      10
    );
    testCameraId = camera.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/streaming/config (LIVE-01, LIVE-02, LIVE-03)', () => {
    it('returns 401 Unauthorized for unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/streaming/config',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns streaming base URLs, ICE servers, and camera stream endpoints for Viewer', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/streaming/config',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.whepBaseUrl).toBeDefined();
      expect(body.hlsBaseUrl).toBeDefined();
      expect(Array.isArray(body.iceServers)).toBe(true);
      expect(body.iceServers.length).toBeGreaterThan(0);
      const firstUrl = Array.isArray(body.iceServers[0].urls)
        ? body.iceServers[0].urls[0]
        : body.iceServers[0].urls;
      expect(firstUrl).toContain('stun:');

      expect(Array.isArray(body.cameras)).toBe(true);
      const cam = body.cameras.find((c: any) => c.cameraId === testCameraId);
      expect(cam).toBeDefined();
      expect(cam.name).toBe('Main Gate Test');
      expect(cam.whepUrl).toContain('/whep');
      expect(cam.hlsUrl).toContain('/index.m3u8');
      expect(cam.subStreamWhepUrl).toContain('_sub/whep');
      expect(cam.subStreamHlsUrl).toContain('_sub/index.m3u8');
    });
  });

  describe('GET /api/streaming/cameras/:id', () => {
    it('returns 404 Not Found for non-existent camera ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/streaming/cameras/non-existent-id',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('NotFound');
    });

    it('returns stream endpoints for specific camera', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/streaming/cameras/${testCameraId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const stream = res.json();
      expect(stream.cameraId).toBe(testCameraId);
      expect(stream.name).toBe('Main Gate Test');
      expect(stream.whepUrl).toContain('/whep');
      expect(stream.hlsUrl).toContain('/index.m3u8');
    });
  });

  describe('GET /api/streaming/ice-servers (LIVE-04)', () => {
    it('returns 401 Unauthorized without auth token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/streaming/ice-servers',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns ICE servers list for authenticated user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/streaming/ice-servers',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.iceServers)).toBe(true);
      expect(body.iceServers.length).toBeGreaterThan(0);
    });
  });
});
