import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { eventBus } from '../src/events/event-bus.js';

describe('Recording Catalog & Webhook Routes (/api/recordings)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
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

  describe('POST /api/recordings/segments Webhook (REC-01, REC-03)', () => {
    it('ingests a segment completion notification and emits recording.segment_created event', async () => {
      let eventPayload: any = null;
      eventBus.subscribe('recording.segment_created', (evt) => {
        eventPayload = evt;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/segments',
        payload: {
          mediaMtxPath: 'cam_front_gate',
          segmentPath: '/var/recordings/cam_front_gate/2026-09-24_11-00-00.mp4',
          duration: 60.5,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.recording.mediaMtxPath).toBe('cam_front_gate');
      expect(body.recording.duration).toBe(60.5);
      expect(typeof body.recording.sizeBytes).toBe('number'); // Safe BigInt handling (T-03-03)
      expect(body.recording.fileName).toBe('2026-09-24_11-00-00.mp4');

      expect(eventPayload).not.toBeNull();
      expect(eventPayload.type).toBe('recording.segment_created');
      expect(eventPayload.metadata.mediaMtxPath).toBe('cam_front_gate');
    });

    it('rejects path traversal attempts with 400 ValidationError (T-03-01)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/segments',
        payload: {
          mediaMtxPath: 'cam1',
          segmentPath: '/var/recordings/../../../etc/shadow',
          duration: 60,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('ValidationError');
    });

    it('rejects missing or invalid duration', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/segments',
        payload: {
          mediaMtxPath: 'cam1',
          segmentPath: '/var/recordings/cam1/chunk.mp4',
          duration: -5,
        },
      });

      expect(res.statusCode).toBe(400);
    });
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
});
