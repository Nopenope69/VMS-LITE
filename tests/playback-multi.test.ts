import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { cameraService } from '../src/cameras/camera.service.js';
import { recordingEngine } from '../src/recordings/recording-engine.js';

describe('Multi-Camera Synchronized Playback API (/api/playback)', () => {
  let app: FastifyInstance;
  let viewerToken: string;
  let cam1Id: string;
  let cam2Id: string;
  const todayStr = new Date().toISOString().split('T')[0];

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    viewerToken = app.jwt.sign({
      id: 'viewer-user-id',
      username: 'viewer',
      role: Role.VIEWER,
    });

    const cam1 = await cameraService.onboardManualCamera(
      {
        name: 'Sync Gate 1',
        rtspUrl: 'rtsp://192.168.1.130:554/live',
      },
      10
    );
    cam1Id = cam1.id;

    const cam2 = await cameraService.onboardManualCamera(
      {
        name: 'Sync Gate 2',
        rtspUrl: 'rtsp://192.168.1.131:554/live',
      },
      10
    );
    cam2Id = cam2.id;

    // Ingest segment for cam1
    await recordingEngine.ingestSegment({
      mediaMtxPath: cam1.mediaMtxPath,
      segmentPath: `/var/recordings/${cam1.mediaMtxPath}/${todayStr}_12-00-00.mp4`,
      duration: 300,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/playback/timeline-multi', () => {
    it('returns 401 Unauthorized without auth header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/timeline-multi?cameraIds=${cam1Id},${cam2Id}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 Bad Request when cameraIds query param is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/playback/timeline-multi',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error).toBe('ValidationError');
    });

    it('returns parallel timelines for all requested cameras', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/timeline-multi?cameraIds=${cam1Id},${cam2Id}&date=${todayStr}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.timelines).toBeDefined();
      expect(json.timelines[cam1Id]).toBeDefined();
      expect(json.timelines[cam2Id]).toBeDefined();
      expect(json.timelines[cam1Id].spans.length).toBeGreaterThanOrEqual(1);
      expect(json.timelines[cam2Id].spans).toEqual([]);
    });
  });

  describe('GET /api/playback/sync-streams', () => {
    it('returns batch playback stream URLs for synchronized playback', async () => {
      const startTime = `${todayStr}T12:00:00.000Z`;
      const res = await app.inject({
        method: 'GET',
        url: `/api/playback/sync-streams?cameraIds=${cam1Id},non-existent-cam&startTime=${encodeURIComponent(startTime)}&duration=300`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.streams).toBeDefined();
      expect(json.streams[cam1Id]).toBeDefined();
      expect(json.streams[cam1Id].available).toBe(true);
      expect(json.streams[cam1Id].fmp4StreamUrl).toBeDefined();
      expect(json.streams['non-existent-cam'].available).toBe(false);
      expect(json.streams['non-existent-cam'].error).toContain('not found');
    });
  });
});
