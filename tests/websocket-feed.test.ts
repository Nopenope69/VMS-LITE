import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { eventBus } from '../src/events/event-bus.js';
import { CoreEventType } from '../src/events/event.types.js';

describe('WebSocket Event Feed & REST API (EVT-05)', () => {
  let app: FastifyInstance;
  let serverPort: number;
  let validToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });

    const addr = app.server.address();
    if (typeof addr === 'object' && addr !== null) {
      serverPort = addr.port;
    } else {
      throw new Error('Failed to resolve server port');
    }

    // Generate valid admin test JWT
    validToken = app.jwt.sign({
      id: 'test-admin-id',
      username: 'admin',
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('WebSocket Authentication (T-06-03)', () => {
    it('rejects WebSocket connection without JWT token', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/events/feed`);

      const receivedError = await new Promise<boolean>((resolve) => {
        ws.on('unexpected-response', (req, res) => {
          expect(res.statusCode).toBe(401);
          resolve(true);
        });
        ws.on('open', () => {
          ws.close();
          resolve(false);
        });
        ws.on('error', () => {
          resolve(true);
        });
      });

      expect(receivedError).toBe(true);
    });

    it('rejects WebSocket connection with invalid JWT token', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/events/feed?token=invalid.tampered.token`);

      const receivedError = await new Promise<boolean>((resolve) => {
        ws.on('unexpected-response', (req, res) => {
          expect(res.statusCode).toBe(401);
          resolve(true);
        });
        ws.on('open', () => {
          ws.close();
          resolve(false);
        });
        ws.on('error', () => {
          resolve(true);
        });
      });

      expect(receivedError).toBe(true);
    });

    it('connects successfully with valid JWT and receives welcome message', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/events/feed?token=${validToken}`);

      const welcomeMsg = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 3000);
        ws.on('message', (data) => {
          clearTimeout(timeout);
          resolve(JSON.parse(data.toString()));
        });
        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(welcomeMsg.type).toBe('connected');
      expect(welcomeMsg.user.username).toBe('admin');
      ws.close();
    });
  });

  describe('Real-Time Event Streaming (EVT-05)', () => {
    it('broadcasts motion.detected event over WebSocket in real-time', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/events/feed?token=${validToken}`);

      // Wait for open
      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      const eventPromise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Event broadcast timeout')), 3000);
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'event') {
            clearTimeout(timeout);
            resolve(parsed.event);
          }
        });
      });

      // Emit motion event on eventBus
      await eventBus.emitEvent({
        cameraId: 'cam-ws-test',
        type: CoreEventType.MOTION_DETECTED,
        source: 'onvif.motion',
        severity: 'warning',
        metadata: {
          cameraName: 'Backyard Camera',
          test: true,
        },
      });

      const receivedEvent = await eventPromise;
      expect(receivedEvent.type).toBe(CoreEventType.MOTION_DETECTED);
      expect(receivedEvent.cameraId).toBe('cam-ws-test');
      expect(receivedEvent.source).toBe('onvif.motion');
      expect(receivedEvent.metadata.cameraName).toBe('Backyard Camera');

      ws.close();
    });

    it('responds to client ping frame with pong', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/events/feed?token=${validToken}`);

      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
      });

      const pongPromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'pong') {
            resolve(parsed);
          }
        });
      });

      ws.send(JSON.stringify({ type: 'ping' }));
      const pong = await pongPromise;
      expect(pong.type).toBe('pong');

      ws.close();
    });
  });

  describe('REST Event History (GET /api/events)', () => {
    it('returns 401 Unauthorized for unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns event history for authenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data).toHaveProperty('events');
      expect(Array.isArray(data.events)).toBe(true);
    });
  });
});
