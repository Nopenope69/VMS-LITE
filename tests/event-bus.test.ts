import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { eventBus, EventBus } from '../src/events/event-bus.js';
import { CoreEventType } from '../src/events/event.types.js';

describe('Unified Core Event Bus & Persistence', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: Role.ADMIN,
    });

    viewerToken = app.jwt.sign({
      id: 'viewer-uuid',
      username: 'viewer',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('EventBus Pub/Sub', () => {
    it('dispatches events to specific type and wildcard subscribers', async () => {
      const bus = new EventBus();
      const receivedWildcard: any[] = [];
      const receivedSpecific: any[] = [];

      bus.subscribe('*', (e) => receivedWildcard.push(e));
      bus.subscribe(CoreEventType.CAMERA_ONLINE, (e) => receivedSpecific.push(e));

      const event = await bus.emitEvent({
        type: CoreEventType.CAMERA_ONLINE,
        source: 'onvif-discovery',
        cameraId: 'cam-01',
        severity: 'info',
        metadata: { ip: '192.168.1.100', model: 'CP-PLUS-CP-UNC' },
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe(CoreEventType.CAMERA_ONLINE);
      expect(receivedWildcard.length).toBe(1);
      expect(receivedSpecific.length).toBe(1);
      expect(receivedSpecific[0].cameraId).toBe('cam-01');
    });

    it('unsubscribe removes listener cleanly', async () => {
      const bus = new EventBus();
      let callCount = 0;

      const unsubscribe = bus.subscribe(CoreEventType.RECORDING_STARTED, () => {
        callCount++;
      });

      await bus.emitEvent({
        type: CoreEventType.RECORDING_STARTED,
        source: 'recorder',
        cameraId: 'cam-01',
      });
      expect(callCount).toBe(1);

      unsubscribe();

      await bus.emitEvent({
        type: CoreEventType.RECORDING_STARTED,
        source: 'recorder',
        cameraId: 'cam-01',
      });
      expect(callCount).toBe(1);
    });
  });

  describe('Event API Endpoints', () => {
    it('GET /api/events requires authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
      });

      expect(res.statusCode).toBe(401);
    });

    it('GET /api/events succeeds with viewer or admin token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.events)).toBe(true);
      expect(typeof body.count).toBe('number');
    });

    it('POST /api/events/emit allows Admin to emit system events', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/events/emit',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          type: CoreEventType.STORAGE_WARNING,
          source: 'storage-monitor',
          severity: 'warning',
          metadata: { usedPercent: 88, freeGb: 24 },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.event.type).toBe(CoreEventType.STORAGE_WARNING);
      expect(body.event.severity).toBe('warning');
    });

    it('POST /api/events/emit blocks Viewer with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/events/emit',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
        payload: {
          type: CoreEventType.CAMERA_OFFLINE,
          source: 'test',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
