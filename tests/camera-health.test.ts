import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import net from 'node:net';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { CameraHealthService, cameraHealthService } from '../src/health/camera-health.service.js';
import { eventBus } from '../src/events/event-bus.js';
import { CameraService } from '../src/cameras/camera.service.js';
import { IMediaMtxRuntimeAdapter, CameraHealthEventMetadata } from '../src/health/health.types.js';

describe('Camera Health Telemetry & Diagnostics (Phase 12 - Plan 01 - EXT-06)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-1',
      username: 'admin',
      role: Role.ADMIN,
    });

    operatorToken = app.jwt.sign({
      id: 'op-1',
      username: 'operator',
      role: Role.OPERATOR,
    });

    viewerToken = app.jwt.sign({
      id: 'view-1',
      username: 'viewer',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    cameraHealthService.reset();
  });

  describe('1. TCP Socket Ping Probe & Socket Resource Bounds', () => {
    it('successfully measures TCP round-trip latency against a listening port', async () => {
      const service = new CameraHealthService();
      let destroyed = false;
      const mockSocket = {
        setTimeout: vi.fn(),
        once: vi.fn((event, cb) => {
          if (event === 'connect') {
            setTimeout(() => cb(), 12);
          }
        }),
        removeAllListeners: vi.fn(),
        destroy: vi.fn(() => {
          destroyed = true;
        }),
        connect: vi.fn(),
      };
      vi.spyOn(net, 'Socket').mockImplementation(() => mockSocket as any);

      const res = await service.pingTcp('192.168.1.100', 554, 2000);
      expect(res.error).toBeUndefined();
      expect(res.reachable).toBe(true);
      expect(res.latencyMs).toBeGreaterThanOrEqual(10);
      expect(destroyed).toBe(true);
    });

    it('returns reachable: false and destroys socket on connection timeout/refusal', async () => {
      const service = new CameraHealthService();
      // Port 59999 should not have any listening service
      const res = await service.pingTcp('127.0.0.1', 59999, 500);
      expect(res.reachable).toBe(false);
      expect(res.latencyMs).toBeNull();
      expect(res.error).toBeDefined();
    });
  });

  describe('2. Bitrate Math, First-Poll Warm-Up & Counter Reset', () => {
    it('establishes baseline on first observation without reporting 0 kbps or falsely triggering DEGRADED', async () => {
      const mockMediaMtx: IMediaMtxRuntimeAdapter = {
        getPathRuntime: vi.fn().mockResolvedValue({
          ready: true,
          bytesReceived: 500_000,
        }),
      };

      const service = new CameraHealthService({ mediaMtxClient: mockMediaMtx });
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 25 });

      const camera = {
        id: 'cam-warmup-1',
        name: 'Front Gate',
        ip: '192.168.1.100',
        port: 554,
        mediaMtxPath: 'cam-warmup-1',
      };

      // Poll 1: Warm-up cycle
      const sample1 = await service.checkCamera(camera);
      expect(sample1.status).toBe('ONLINE');
      expect(sample1.bitrateKbps).toBeNull();
      expect(sample1.consecutiveFailures).toBe(0);

      // Poll 2: 2 seconds later with 500 KB added (4,000,000 bits / 2s = 2000 kbps)
      const mockNow = Date.now() + 2000;
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);
      (mockMediaMtx.getPathRuntime as any).mockResolvedValue({
        ready: true,
        bytesReceived: 1_000_000,
      });

      const sample2 = await service.checkCamera(camera);
      expect(sample2.status).toBe('ONLINE');
      expect(sample2.bitrateKbps).toBeGreaterThanOrEqual(1900);
      expect(sample2.bitrateKbps).toBeLessThanOrEqual(2100);
      expect(sample2.consecutiveFailures).toBe(0);
    });

    it('handles MediaMTX restart/counter reset (currentBytes < previousBytes) gracefully', async () => {
      const mockMediaMtx: IMediaMtxRuntimeAdapter = {
        getPathRuntime: vi.fn(),
      };

      const service = new CameraHealthService({ mediaMtxClient: mockMediaMtx });
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 20 });

      const camera = {
        id: 'cam-reset-1',
        name: 'Lobby',
        ip: '192.168.1.101',
        port: 554,
        mediaMtxPath: 'cam-reset-1',
      };

      // Sample 1: Baseline at 10,000,000 bytes
      (mockMediaMtx.getPathRuntime as any).mockResolvedValue({ ready: true, bytesReceived: 10_000_000 });
      await service.checkCamera(camera);

      // Sample 2: MediaMTX restarted, counter resets to 20,000 bytes
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15000);
      (mockMediaMtx.getPathRuntime as any).mockResolvedValue({ ready: true, bytesReceived: 20_000 });

      const sample2 = await service.checkCamera(camera);
      // Bitrate should be treated as reset/re-baseline rather than negative or crashing
      expect(sample2.bitrateKbps).toBeNull();
      expect(sample2.status).toBe('ONLINE');
    });
  });

  describe('3. Latency Boundaries & Tri-State Evaluation', () => {
    it('evaluates healthy sample (<500ms latency, ready, bitrate >50kbps) as ONLINE', async () => {
      const mockMediaMtx: IMediaMtxRuntimeAdapter = {
        getPathRuntime: vi.fn().mockResolvedValue({ ready: true, bytesReceived: 1_000_000 }),
      };

      const service = new CameraHealthService({ mediaMtxClient: mockMediaMtx });
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 45 });

      const camera = { id: 'cam-eval-1', name: 'Driveway', ip: '10.0.0.1', port: 554, mediaMtxPath: 'cam-eval-1' };
      const sample = await service.checkCamera(camera);
      expect(sample.status).toBe('ONLINE');
      expect(sample.latencyMs).toBe(45);
    });

    it('identifies degraded sample when latency >= 500ms', async () => {
      const mockMediaMtx: IMediaMtxRuntimeAdapter = {
        getPathRuntime: vi.fn().mockResolvedValue({ ready: true, bytesReceived: 1_000_000 }),
      };

      const service = new CameraHealthService({ mediaMtxClient: mockMediaMtx });
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 650 });

      const camera = { id: 'cam-deg-1', name: 'Warehouse', ip: '10.0.0.2', port: 554, mediaMtxPath: 'cam-deg-1' };

      // Poll 1: Candidate state
      const sample1 = await service.checkCamera(camera);
      expect(sample1.status).toBe('ONLINE'); // Not yet flipped
      expect(sample1.consecutiveFailures).toBe(1);

      // Poll 2: Second consecutive failure -> flips to DEGRADED
      const sample2 = await service.checkCamera(camera);
      expect(sample2.status).toBe('DEGRADED');
      expect(sample2.consecutiveFailures).toBe(2);
      expect(sample2.reason).toContain('High network latency');
    });

    it('identifies degraded sample when stream is not ready in MediaMTX', async () => {
      const mockMediaMtx: IMediaMtxRuntimeAdapter = {
        getPathRuntime: vi.fn().mockResolvedValue({ ready: false, bytesReceived: 0 }),
      };

      const service = new CameraHealthService({ mediaMtxClient: mockMediaMtx });
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 25 });

      const camera = { id: 'cam-deg-2', name: 'Parking', ip: '10.0.0.3', port: 554, mediaMtxPath: 'cam-deg-2' };

      await service.checkCamera(camera); // sample 1: candidate
      const sample2 = await service.checkCamera(camera); // sample 2: flips
      expect(sample2.status).toBe('DEGRADED');
      expect(sample2.reason).toContain('MediaMTX stream path not ready');
    });
  });

  describe('4. Anti-Flapping Hysteresis & Offline Boundary', () => {
    it('requires 2 consecutive failures before transitioning to OFFLINE, and 1 healthy sample to recover', async () => {
      const mockMediaMtx: IMediaMtxRuntimeAdapter = {
        getPathRuntime: vi.fn().mockResolvedValue({ ready: false, bytesReceived: 0 }),
      };

      const service = new CameraHealthService({ mediaMtxClient: mockMediaMtx });
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: false, latencyMs: null, error: 'Connection refused' });

      const camera = { id: 'cam-flap-1', name: 'Server Room', ip: '10.0.0.4', port: 554, mediaMtxPath: 'cam-flap-1' };

      // Sample 1: TCP unreachable -> candidate (status stays ONLINE)
      const s1 = await service.checkCamera(camera);
      expect(s1.status).toBe('ONLINE');
      expect(s1.consecutiveFailures).toBe(1);

      // Sample 2: TCP unreachable -> 2nd consecutive failure -> flips to OFFLINE
      const s2 = await service.checkCamera(camera);
      expect(s2.status).toBe('OFFLINE');
      expect(s2.consecutiveFailures).toBe(2);

      // Sample 3: Camera recovers
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 15 });
      (mockMediaMtx.getPathRuntime as any).mockResolvedValue({ ready: true, bytesReceived: 50_000 });

      const s3 = await service.checkCamera(camera);
      expect(s3.status).toBe('ONLINE');
      expect(s3.consecutiveFailures).toBe(0);
      expect(s3.unhealthySince).toBeNull();
    });

    it('enforces 30-second continuous downtime rule for OFFLINE status', async () => {
      let now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);

      const mockMediaMtx: IMediaMtxRuntimeAdapter = {
        getPathRuntime: vi.fn().mockResolvedValue({ ready: false, bytesReceived: 0 }),
      };

      const service = new CameraHealthService({ mediaMtxClient: mockMediaMtx });
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: false, latencyMs: null, error: 'Timeout' });

      const camera = { id: 'cam-30s-1', name: 'Rooftop', ip: '10.0.0.5', port: 554, mediaMtxPath: 'cam-30s-1' };

      // Poll 1 at t=0s
      await service.checkCamera(camera);

      // Poll at t=29s (less than 30s) -> 2 consecutive failures
      now += 29_000;
      const s29 = await service.checkCamera(camera);
      expect(s29.status).toBe('OFFLINE');

      // Recover at t=35s with healthy bitrate (>50kbps)
      now += 6_000;
      vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 20 });
      (mockMediaMtx.getPathRuntime as any).mockResolvedValue({ ready: true, bytesReceived: 500_000 });

      const recovered = await service.checkCamera(camera);
      expect(recovered.status).toBe('ONLINE');
    });
  });

  describe('5. Standardized EventBus Emission Contract', () => {
    it('emits events ONLY on status transition with complete CameraHealthEventMetadata', async () => {
      const emittedEvents: any[] = [];
      const unsubscribe = eventBus.subscribe('*', (ev) => {
        if (ev.type.startsWith('camera.')) {
          emittedEvents.push(ev);
        }
      });

      try {
        const mockMediaMtx: IMediaMtxRuntimeAdapter = {
          getPathRuntime: vi.fn().mockResolvedValue({ ready: true, bytesReceived: 100_000 }),
        };

        const service = new CameraHealthService({ mediaMtxClient: mockMediaMtx, eventBus });
        vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 15 });

        const camera = { id: 'cam-event-1', name: 'Main Gate', ip: '192.168.1.10', port: 554, mediaMtxPath: 'cam-event-1' };

        // Poll 1: ONLINE (initial state is already ONLINE, no transition)
        await service.checkCamera(camera);
        expect(emittedEvents.length).toBe(0);

        // Poll 2: Degrade latency to 600ms (1st failure, candidate)
        vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 600 });
        await service.checkCamera(camera);
        expect(emittedEvents.length).toBe(0); // Candidate state, no event yet

        // Poll 3: Degrade latency again (2nd failure -> transition ONLINE -> DEGRADED)
        await service.checkCamera(camera);
        expect(emittedEvents.length).toBe(1);
        const degradedEvent = emittedEvents[0];
        expect(degradedEvent.type).toBe('camera.degraded');
        expect(degradedEvent.severity).toBe('warning');
        expect(degradedEvent.metadata.cameraId).toBe(camera.id);
        expect(degradedEvent.metadata.cameraName).toBe(camera.name);
        expect(degradedEvent.metadata.status).toBe('DEGRADED');
        expect(degradedEvent.metadata.previousStatus).toBe('ONLINE');
        expect(degradedEvent.metadata.latencyMs).toBe(600);

        // Poll 4: Latency remains 600ms (still DEGRADED, no transition -> NO new event)
        await service.checkCamera(camera);
        expect(emittedEvents.length).toBe(1);

        // Poll 5: Camera goes OFFLINE (transition DEGRADED -> OFFLINE)
        vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: false, latencyMs: null, error: 'Connection refused' });
        await service.checkCamera(camera);
        expect(emittedEvents.length).toBe(2);
        const offlineEvent = emittedEvents[1];
        expect(offlineEvent.type).toBe('camera.offline');
        expect(offlineEvent.severity).toBe('critical');
        expect(offlineEvent.metadata.previousStatus).toBe('DEGRADED');

        // Poll 6: Recovers to ONLINE (transition OFFLINE -> ONLINE)
        vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 20 });
        (mockMediaMtx.getPathRuntime as any).mockResolvedValue({ ready: true, bytesReceived: 200_000 });
        await service.checkCamera(camera);
        expect(emittedEvents.length).toBe(3);
        const onlineEvent = emittedEvents[2];
        expect(onlineEvent.type).toBe('camera.online');
        expect(onlineEvent.severity).toBe('info');
        expect(onlineEvent.metadata.previousStatus).toBe('OFFLINE');
      } finally {
        unsubscribe();
      }
    });
  });

  describe('6. Concurrency Limiter & Non-Overlapping Polling Guard', () => {
    it('skips concurrent polling cycles if a cycle is already active', async () => {
      const mockCameraService = {
        listCameras: vi.fn().mockImplementation(async () => {
          // Simulate slow query
          await new Promise((r) => setTimeout(r, 50));
          return [{ id: 'cam-1', name: 'C1', mediaMtxPath: 'cam-1' }];
        }),
      } as unknown as CameraService;

      const service = new CameraHealthService({ cameraService: mockCameraService });
      vi.spyOn(service, 'checkCamera').mockResolvedValue({} as any);

      // Run two polls concurrently
      const p1 = service.pollAllCameras();
      const p2 = service.pollAllCameras();

      await Promise.all([p1, p2]);

      // CameraService.listCameras should only be called once because second poll skipped
      expect(mockCameraService.listCameras).toHaveBeenCalledTimes(1);
    });

    it('enforces maximum 5 concurrent camera checks during mass polling', async () => {
      let concurrentCount = 0;
      let maxSeenConcurrent = 0;

      const cameras = Array.from({ length: 15 }, (_, i) => ({
        id: `cam-${i}`,
        name: `Camera ${i}`,
        mediaMtxPath: `cam-${i}`,
      }));

      const mockCameraService = {
        listCameras: vi.fn().mockResolvedValue(cameras),
      } as unknown as CameraService;

      const service = new CameraHealthService({ cameraService: mockCameraService });
      vi.spyOn(service, 'checkCamera').mockImplementation(async () => {
        concurrentCount++;
        maxSeenConcurrent = Math.max(maxSeenConcurrent, concurrentCount);
        await new Promise((r) => setTimeout(r, 20));
        concurrentCount--;
        return {} as any;
      });

      await service.pollAllCameras();

      expect(maxSeenConcurrent).toBeLessThanOrEqual(service.MAX_CONCURRENT_CAMERA_CHECKS);
      expect(maxSeenConcurrent).toBe(5);
    });
  });

  describe('7. REST API Endpoints & RBAC / Capability Protection', () => {
    it('GET /api/cameras/health returns 401 without JWT authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras/health',
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/cameras/health returns 403 Forbidden for VIEWER role (Physical Security Reconnaissance Defense)', async () => {
      // Provide capability
      const origHas = app.capabilities.has.bind(app.capabilities);
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.camera_health') return true;
        return origHas(cap);
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras/health',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
    });

    it('GET /api/cameras/health returns 403 Forbidden when extended.camera_health capability is missing', async () => {
      // Capability absent
      vi.spyOn(app.capabilities, 'has').mockReturnValue(false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras/health',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.capability).toBe('extended.camera_health');
    });

    it('GET /api/cameras/health returns 200 OK for OPERATOR with extended.camera_health capability', async () => {
      const origHas = app.capabilities.has.bind(app.capabilities);
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.camera_health') return true;
        return origHas(cap);
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras/health',
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('totalCameras');
      expect(body).toHaveProperty('onlineCount');
      expect(body).toHaveProperty('cameras');
    });

    it('GET /api/cameras/:id/health returns 404 for non-existent camera ID', async () => {
      const origHas = app.capabilities.has.bind(app.capabilities);
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.camera_health') return true;
        return origHas(cap);
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras/non-existent-id/health',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it('GET /api/cameras/:id/health returns telemetry for cached camera and excludes IP/credentials', async () => {
      const origHas = app.capabilities.has.bind(app.capabilities);
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.camera_health') return true;
        return origHas(cap);
      });

      // Populate telemetry in singleton
      vi.spyOn(cameraHealthService, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 24 });
      await cameraHealthService.checkCamera({
        id: 'test-cam-live-1',
        name: 'Front Lobby',
        ip: '192.168.1.50',
        port: 554,
        mediaMtxPath: 'test-cam-live-1',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras/test-cam-live-1/health',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cameraId).toBe('test-cam-live-1');
      expect(body.status).toBe('ONLINE');
      expect(body.latencyMs).toBe(24);
      // Strictly verify IP addresses and credentials never enter the public telemetry DTO (T-12-02)
      expect(body).not.toHaveProperty('ip');
      expect(body).not.toHaveProperty('password');
      expect(body).not.toHaveProperty('username');
    });
  });
});
