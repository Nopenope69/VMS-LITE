import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { wanArchivalService } from '../src/recordings/wan-archival.service.js';

describe('Event-Only WAN Archival Engine (/api/v1/wan-archival)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-wan-test',
      username: 'admin',
      role: Role.ADMIN,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Service unit logic (wanArchivalService)', () => {
    it('enqueues a 45-second incident clip and computes WAN bandwidth savings', () => {
      const clip = wanArchivalService.enqueueIncidentClip({
        cameraId: 'cam-branch-delhi-1',
        cameraName: 'Delhi Dispatch Gate',
        eventType: 'motion.detected',
        clipDurationSeconds: 45,
      });

      expect(clip.id).toBeDefined();
      expect(clip.cameraId).toBe('cam-branch-delhi-1');
      expect(clip.clipDurationSeconds).toBe(45);
      expect(clip.status).toBe('UPLOADING'); // transitioned to uploading in service

      const queue = wanArchivalService.getQueue();
      expect(queue.some((item) => item.id === clip.id)).toBe(true);

      const metrics = wanArchivalService.getMetrics();
      expect(metrics.totalIncidentClips).toBeGreaterThanOrEqual(1);
      expect(metrics.savingsPercentage).toBeGreaterThanOrEqual(95);
      expect(metrics.wanBandwidthSavedBytes).toBeGreaterThan(0);
    });

    it('allows retrying a failed clip', () => {
      const clip = wanArchivalService.enqueueIncidentClip({
        cameraId: 'cam-mumbai-2',
        eventType: 'perimeter.alarm',
      });
      // simulate failed
      clip.status = 'FAILED';
      clip.error = 'Network timeout';

      const retried = wanArchivalService.retryClip(clip.id);
      expect(retried).toBe(true);
      expect(clip.status).toBe('UPLOADING');
      expect(clip.retryCount).toBe(1);
    });
  });

  describe('REST API Endpoints', () => {
    it('returns 401 Unauthorized without auth token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/wan-archival/queue',
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/v1/wan-archival/sync enqueues incident clip', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/wan-archival/sync',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          cameraId: 'cam-pune-assembly',
          cameraName: 'Pune Line 3',
          eventType: 'emergency.lock',
          clipDurationSeconds: 45,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.item.cameraId).toBe('cam-pune-assembly');
      expect(body.item.clipDurationSeconds).toBe(45);
    });

    it('GET /api/v1/wan-archival/queue returns list of incident clips', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/wan-archival/queue',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.count).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/wan-archival/metrics returns bandwidth metrics & savings %', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/wan-archival/metrics',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.metrics.savingsPercentage).toBeGreaterThanOrEqual(90);
    });

    it('DELETE /api/v1/wan-archival/completed clears old synced records', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/wan-archival/completed',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });
});
