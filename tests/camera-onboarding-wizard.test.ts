import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import net from 'node:net';
import { createServer } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';
import { AuthService } from '../src/users/auth.service.js';
import { onvifCameraProvider } from '../src/cameras/onvif.provider.js';
import { mediaMtxClient } from '../src/mediamtx/mediamtx.client.js';

describe('Camera Onboarding Wizard Backend Pipeline (Phase 15 - MVP-05)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let tcpServer: net.Server;
  let tcpPort: number;

  beforeAll(async () => {
    // Clear mock DB collections
    (globalThis as any).prismaGlobal?.camera?.clear();
    (globalThis as any).prismaGlobal?.user?.clear();

    // Start a dummy TCP server to simulate camera RTSP port
    await new Promise<void>((resolve) => {
      tcpServer = net.createServer((socket) => {
        socket.destroy();
      });
      tcpServer.listen(0, '127.0.0.1', () => {
        tcpPort = (tcpServer.address() as net.AddressInfo).port;
        resolve();
      });
    });

    app = await createServer({ logger: false });
    await app.ready();

    // Mock capability limit of 4 cameras
    vi.spyOn(app.capabilities, 'getCameraLimit').mockReturnValue(4);
    vi.spyOn(app.capabilities, 'has').mockReturnValue(true);

    // Seed admin
    const authService = new AuthService(prisma);
    await authService.seedInitialAdmin('wizardAdmin', 'adminPass123');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'wizardAdmin', password: 'adminPass123' },
    });
    adminToken = JSON.parse(loginRes.payload).token;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
    await app.close();
  });

  describe('Step 3: Network Reachability Probe (/api/cameras/probe-network)', () => {
    it('returns reachable: true and measured latency for active port', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/probe-network',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ip: '127.0.0.1',
          port: tcpPort,
          timeoutMs: 1500,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.reachable).toBe(true);
      expect(typeof data.latencyMs).toBe('number');
      expect(data.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns reachable: false for closed / unreachable port without crashing', async () => {
      // Pick an unused high port
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/probe-network',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ip: '127.0.0.1',
          port: 59999,
          timeoutMs: 500,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.reachable).toBe(false);
      expect(data.latencyMs).toBeNull();
      expect(data.error).toBeDefined();
    });

    it('validates request payload schema', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/probe-network',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          // missing ip
          port: 554,
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('ValidationError');
    });
  });

  describe('Step 2: Credential & Profile Probe (/api/cameras/probe-auth)', () => {
    it('probes device info and resolves stream profiles successfully', async () => {
      vi.spyOn(onvifCameraProvider, 'getDeviceInformation').mockResolvedValue({
        manufacturer: 'CP PLUS',
        model: 'CP-UNC-TA41L3-MD',
        firmwareVersion: 'v2.800',
        serialNumber: 'CPP12345678',
      });

      vi.spyOn(onvifCameraProvider, 'getProfiles').mockResolvedValue([
        {
          token: 'Profile_1',
          name: 'MainStream_HD',
          encoding: 'H264',
          rtspUri: 'rtsp://192.168.1.105:554/cam/realmonitor?channel=1&subtype=0',
          resolution: { width: 1920, height: 1080 },
          fps: 25,
          isMainStream: true,
        },
        {
          token: 'Profile_2',
          name: 'SubStream_SD',
          encoding: 'H264',
          rtspUri: 'rtsp://192.168.1.105:554/cam/realmonitor?channel=1&subtype=1',
          resolution: { width: 640, height: 480 },
          fps: 15,
          isMainStream: false,
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/probe-auth',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ip: '192.168.1.105',
          port: 80,
          username: 'admin',
          password: 'password123',
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.authenticated).toBe(true);
      expect(data.device.manufacturer).toBe('CP PLUS');
      expect(data.profiles.length).toBe(2);
      expect(data.profiles[0].isMainStream).toBe(true);
    });

    it('returns error when camera returns no stream profiles', async () => {
      vi.spyOn(onvifCameraProvider, 'getProfiles').mockResolvedValue([]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/probe-auth',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          ip: '192.168.1.105',
          port: 80,
          username: 'admin',
          password: 'wrongpassword',
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('ProbeAuthFailed');
    });
  });

  describe('Step 4 & 5: Stream Provisioning & Teardown Preview', () => {
    it('provisions a temporary preview path and polls for readiness', async () => {
      vi.spyOn(mediaMtxClient, 'addPath').mockResolvedValue(true);
      vi.spyOn(mediaMtxClient, 'getPath').mockResolvedValue({
        name: 'preview_mock',
        ready: true,
        tracks: ['h264'],
        bytesReceived: 1024,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/provision-preview',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          rtspUrl: 'rtsp://192.168.1.105:554/live',
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.pathName).toMatch(/^preview_/);
      expect(data.ready).toBe(true);
      expect(data.whepUrl).toContain(`/whep/${data.pathName}/whep`);
    });

    it('tears down preview path on cancel or modal close', async () => {
      const removeSpy = vi.spyOn(mediaMtxClient, 'removePath').mockResolvedValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/teardown-preview',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          pathName: 'preview_abc123',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(removeSpy).toHaveBeenCalledWith('preview_abc123');
    });
  });

  describe('Step 6: Atomic Database Commit (/api/cameras/commit)', () => {
    it('atomically commits camera and cleans up preview path', async () => {
      vi.spyOn(mediaMtxClient, 'addPath').mockResolvedValue(true);
      const teardownSpy = vi.spyOn(mediaMtxClient, 'removePath').mockResolvedValue(true);

      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/commit',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Main Lobby Entrance',
          ip: '192.168.1.105',
          port: 554,
          username: 'admin',
          password: 'pass',
          rtspUrl: 'rtsp://192.168.1.105:554/cam/main',
          subStreamUrl: 'rtsp://192.168.1.105:554/cam/sub',
          manufacturer: 'CP PLUS',
          previewPath: 'preview_temp_to_clean',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.payload);
      expect(data.id).toBeDefined();
      expect(data.name).toBe('Main Lobby Entrance');
      expect(data.mediaMtxPath).toMatch(/^main_lobby_entrance/);
      expect(teardownSpy).toHaveBeenCalledWith('preview_temp_to_clean');
    });

    it('enforces camera license limit on commit', async () => {
      vi.spyOn(app.capabilities, 'getCameraLimit').mockReturnValue(1);

      const res = await app.inject({
        method: 'POST',
        url: '/api/cameras/commit',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Second Camera Exceeding Limit',
          rtspUrl: 'rtsp://192.168.1.106:554/stream',
        },
      });

      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('LicenseLimitExceeded');
    });
  });
});
