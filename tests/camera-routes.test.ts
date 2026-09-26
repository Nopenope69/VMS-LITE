import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { onvifCameraProvider } from '../src/cameras/onvif.provider.js';
import {
  MOCK_DEVICE_INFO,
  MOCK_DISCOVERED_CAMERAS,
  MOCK_PROFILES_DUAL,
} from './fixtures/onvif-mock.js';

describe('Camera Routes & Endpoints (/api/cameras)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    // Configure default mock ONVIF provider data
    (onvifCameraProvider as any).mockMode = true;
    (onvifCameraProvider as any).mockCameras = MOCK_DISCOVERED_CAMERAS;
    (onvifCameraProvider as any).mockProfiles = MOCK_PROFILES_DUAL;
    (onvifCameraProvider as any).mockDetails = MOCK_DEVICE_INFO;

    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-id',
      username: 'admin',
      role: Role.ADMIN,
    });

    viewerToken = app.jwt.sign({
      id: 'viewer-id',
      username: 'viewer',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/cameras/discover (CAM-01)', () => {
    it('returns 401 Unauthorized for unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/discover',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 Forbidden for Viewer role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/discover',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns discovered devices for Admin role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/discover',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { timeoutMs: 1000 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.devices[0].ip).toBe('192.168.1.108');
    });
  });

  describe('POST /api/cameras Onboarding & License Gating (CAM-02, CAM-03, CAM-05)', () => {
    it('returns 403 Forbidden when Viewer attempts to add a camera', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          name: 'Unauthorized Cam',
          rtspUrl: 'rtsp://10.0.0.1/live',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('successfully onboards a manual RTSP camera', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Warehouse Gate',
          rtspUrl: 'rtsp://admin:pass@192.168.1.50/live',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Warehouse Gate');
      expect(body.mediaMtxPath).toBeDefined();
      expect(body.status).toBe('online');
    });

    it('successfully onboards an ONVIF camera', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Front Lobby ONVIF',
          ip: '192.168.1.108',
          port: 80,
          username: 'admin',
          password: 'Secret123!',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Front Lobby ONVIF');
      expect(body.rtspUrl).toContain('subtype=0');
      expect(body.subStreamUrl).toContain('subtype=1');
      expect(body.manufacturer).toBe('CP PLUS');
    });

    it('enforces license camera limit (evaluation license = 2 cameras max) with 403 LicenseLimitExceeded', async () => {
      // 2 cameras already added in the previous 2 tests. Attempting a 3rd camera:
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Excess Camera #3',
          rtspUrl: 'rtsp://192.168.1.99/live',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('LicenseLimitExceeded');
      expect(body.cameraLimit).toBe(2);
    });
  });

  describe('GET & DELETE /api/cameras', () => {
    it('allows Viewer to list configured cameras', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.cameras[0].password).toBeUndefined();
    });

    it('allows Viewer to get single camera details', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      const camera = listRes.json().cameras[0];

      const res = await app.inject({
        method: 'GET',
        url: `/api/cameras/${camera.id}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(camera.id);
      expect(body.name).toBe(camera.name);
    });

    it('rejects camera deletion by Viewer', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/cameras/some-id',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows Admin to delete camera and frees up license slot', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const camera = listRes.json().cameras[0];

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/cameras/${camera.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      // Now adding a new camera succeeds because slot was freed
      const addRes = await app.inject({
        method: 'POST',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Replacement Camera',
          rtspUrl: 'rtsp://192.168.1.101/live',
        },
      });

      expect(addRes.statusCode).toBe(201);
    });
  });
});
