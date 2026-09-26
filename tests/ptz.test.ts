import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';
import { ptzService, PtzService } from '../src/ptz/ptz.service.js';
import { onvifCameraProvider } from '../src/cameras/onvif.provider.js';

describe('ONVIF PTZ Controls & Camera Presets (Phase 9 - EXT-03)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorAllowedToken: string;
  let operatorDeniedToken: string;
  let viewerToken: string;

  const allowedOperatorId = 'operator-ptz-allowed-id';
  const deniedOperatorId = 'operator-ptz-denied-id';
  const testCameraId = 'camera-ptz-test-uuid';

  const mockCamera = {
    id: testCameraId,
    name: 'PTZ Dome Camera',
    ip: '192.168.1.100',
    port: 80,
    username: 'admin',
    password: 'password123',
    onvifUrl: 'http://192.168.1.100/onvif/device_service',
    profileToken: 'Profile_1',
    rtspUrl: 'rtsp://192.168.1.100/main',
    mediaMtxPath: 'ptz_dome',
    status: 'online',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: Role.ADMIN,
    });

    operatorAllowedToken = app.jwt.sign({
      id: allowedOperatorId,
      username: 'guard_ptz',
      role: Role.OPERATOR,
    });

    operatorDeniedToken = app.jwt.sign({
      id: deniedOperatorId,
      username: 'guard_nopz',
      role: Role.OPERATOR,
    });

    viewerToken = app.jwt.sign({
      id: 'viewer-uuid',
      username: 'viewer1',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
    ptzService.destroy();
  });

  beforeEach(() => {
    vi.spyOn(prisma.camera, 'findUnique').mockResolvedValue(mockCamera as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ptzService.destroy();
  });

  describe('Capability Gating (extended.ptz)', () => {
    it('returns 403 when extended.ptz capability is absent', async () => {
      // Ensure capability is absent
      const hasCap = app.capabilities.has('extended.ptz');
      expect(hasCap).toBe(false);

      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/move`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { x: 0.5, y: 0.0, z: 0.0 },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.capability).toBe('extended.ptz');
    });
  });

  describe('RBAC & Per-Camera ACL Permissions', () => {
    beforeEach(() => {
      // Mock license capability active for extended.ptz
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.ptz') return true;
        return false;
      });
    });

    it('rejects Viewer role with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/move`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { x: 0.5 },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.message).toContain("Viewers do not have permission to perform 'canControlPtz'");
    });

    it('rejects Operator without canControlPtz permission with 403', async () => {
      vi.spyOn(prisma.cameraPermission, 'findUnique').mockResolvedValue({
        id: 'perm-denied',
        userId: deniedOperatorId,
        cameraId: testCameraId,
        canViewLive: true,
        canViewPlayback: true,
        canControlPtz: false,
        canExportClips: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/move`,
        headers: { authorization: `Bearer ${operatorDeniedToken}` },
        payload: { x: -0.5 },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.message).toContain("Operator lacks 'canControlPtz' permission");
    });

    it('allows Operator with canControlPtz permission to command movement', async () => {
      vi.spyOn(prisma.cameraPermission, 'findUnique').mockResolvedValue({
        id: 'perm-allowed',
        userId: allowedOperatorId,
        cameraId: testCameraId,
        canViewLive: true,
        canViewPlayback: true,
        canControlPtz: true,
        canExportClips: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/move`,
        headers: { authorization: `Bearer ${operatorAllowedToken}` },
        payload: { x: 0.8, y: -0.2 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.moving).toBe(true);
    });

    it('allows Admin full bypass to command move and stop', async () => {
      const moveRes = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/move`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { x: 0.0, y: 1.0, z: 0.5 },
      });
      expect(moveRes.statusCode).toBe(200);

      const stopRes = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/stop`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(stopRes.statusCode).toBe(200);
      expect(stopRes.json().moving).toBe(false);
    });
  });

  describe('Server-Side Safety Watchdog (1500ms Auto-Stop - Threat T-09-01)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.ptz') return true;
        return false;
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('automatically fires ptzStop after 1500ms watchdog elapses', async () => {
      const stopSpy = vi.spyOn(onvifCameraProvider, 'ptzStop');

      // Initiate move via service directly
      await ptzService.move(testCameraId, { x: 0.5, y: 0.5 });
      expect(ptzService.hasActiveWatchdog(testCameraId)).toBe(true);
      expect(stopSpy).not.toHaveBeenCalled();

      // Advance by 1400ms - watchdog should still be active
      await vi.advanceTimersByTimeAsync(1400);
      expect(stopSpy).not.toHaveBeenCalled();
      expect(ptzService.hasActiveWatchdog(testCameraId)).toBe(true);

      // Advance past 1500ms - watchdog should fire stop
      await vi.advanceTimersByTimeAsync(150);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(ptzService.hasActiveWatchdog(testCameraId)).toBe(false);
    });

    it('resets watchdog timer when subsequent move is received', async () => {
      const stopSpy = vi.spyOn(onvifCameraProvider, 'ptzStop');

      await ptzService.move(testCameraId, { x: 0.5 });
      await vi.advanceTimersByTimeAsync(1000); // 1000ms elapsed

      // Send another move before 1500ms timeout
      await ptzService.move(testCameraId, { x: 0.8 });
      expect(stopSpy).not.toHaveBeenCalled();

      // Advance 1000ms more (2000ms total, but 1000ms since last move)
      await vi.advanceTimersByTimeAsync(1000);
      expect(stopSpy).not.toHaveBeenCalled();

      // Advance 600ms more (1600ms since last move) -> should trigger stop
      await vi.advanceTimersByTimeAsync(600);
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it('clears watchdog immediately when manual stop is received', async () => {
      const stopSpy = vi.spyOn(onvifCameraProvider, 'ptzStop');

      await ptzService.move(testCameraId, { x: -0.5 });
      expect(ptzService.hasActiveWatchdog(testCameraId)).toBe(true);

      await ptzService.stop(testCameraId);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(ptzService.hasActiveWatchdog(testCameraId)).toBe(false);

      // Advance past 1500ms - should NOT trigger stop a second time
      await vi.advanceTimersByTimeAsync(2000);
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Preset Management & Recalls', () => {
    beforeEach(() => {
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.ptz') return true;
        return false;
      });
    });

    it('lists available camera presets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/cameras/${testCameraId}/ptz/presets`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.presets)).toBe(true);
      expect(body.presets.length).toBeGreaterThan(0);
      expect(body.presets[0]).toHaveProperty('token');
      expect(body.presets[0]).toHaveProperty('name');
    });

    it('allows recalling a saved preset', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/presets/preset-1/goto`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().presetToken).toBe('preset-1');
    });

    it('allows Admin to save a new preset', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/presets`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Guard Gate 2' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.name).toBe('Guard Gate 2');
      expect(body.token).toBeDefined();
    });

    it('prohibits Operator from saving presets (Admin only)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/ptz/presets`,
        headers: { authorization: `Bearer ${operatorAllowedToken}` },
        payload: { name: 'Unauthorized Preset' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows Admin to delete a preset', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/cameras/${testCameraId}/ptz/presets/preset-1`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });
});
