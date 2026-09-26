import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { Role } from '@prisma/client';
import { createEvaluationRegistry } from '../src/licensing/capabilities.js';
import {
  gridToWindows,
  windowsToGrid,
  SCHEDULE_PRESETS,
} from '../src/settings/settings.types.js';
import { settingsService } from '../src/settings/settings.service.js';
import { recordingEngine } from '../src/recordings/recording-engine.js';

describe('Operational Settings & Core Health Licensing Realignment (Phase 16 - MVP-07, MVP-08)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer();
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'usr-admin-1',
      username: 'admin',
      role: Role.ADMIN,
    });

    operatorToken = app.jwt.sign({
      id: 'usr-op-1',
      username: 'operator',
      role: Role.OPERATOR,
    });

    viewerToken = app.jwt.sign({
      id: 'usr-viewer-1',
      username: 'viewer',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Core Health Licensing Realignment (MVP-07)', () => {
    it('evaluation registry provides camera health capabilities and configurable camera headroom', () => {
      const evalRegistry = createEvaluationRegistry();
      expect(evalRegistry.getEdition()).toBe('core');
      expect(evalRegistry.getCameraLimit()).toBe(2);
      expect(evalRegistry.has('core.camera_health')).toBe(true);
      expect(evalRegistry.has('extended.camera_health')).toBe(true);
      expect(evalRegistry.has('camera.health')).toBe(true);

      const coreTierRegistry = createEvaluationRegistry(16);
      expect(coreTierRegistry.getCameraLimit()).toBe(16);
      expect(coreTierRegistry.has('core.camera_health')).toBe(true);
    });

    it('GET /api/cameras/health succeeds for OPERATOR and ADMIN under Core license evaluation', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras/health',
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('totalCameras');
      expect(body).toHaveProperty('cameras');
    });
  });

  describe('2. Schedule Grid Helper Converters & Presets', () => {
    it('accurately converts 7x24 grid to ScheduleWindow spans and back', () => {
      const originalGrid = SCHEDULE_PRESETS.BUSINESS_HOURS();
      const windows = gridToWindows(originalGrid);

      // Mon-Fri: 5 days with 1 window each (9:00 to 18:00)
      expect(windows.length).toBe(5);
      for (const win of windows) {
        expect(win.dayOfWeek).toBeGreaterThanOrEqual(1);
        expect(win.dayOfWeek).toBeLessThanOrEqual(5);
        expect(win.startHour).toBe(9);
        expect(win.endHour).toBe(18);
      }

      const reconstructedGrid = windowsToGrid(windows);
      expect(reconstructedGrid).toEqual(originalGrid);
    });

    it('handles ALL_HOURS preset conversion', () => {
      const allHours = SCHEDULE_PRESETS.ALL_HOURS();
      const windows = gridToWindows(allHours);
      expect(windows.length).toBe(7);
      for (const win of windows) {
        expect(win.startHour).toBe(0);
        expect(win.endHour).toBe(23);
      }
    });

    it('handles CLEAR_ALL preset conversion', () => {
      const clear = SCHEDULE_PRESETS.CLEAR_ALL();
      const windows = gridToWindows(clear);
      expect(windows.length).toBe(0);
    });
  });

  describe('3. Operational Settings REST Endpoints (MVP-08)', () => {
    it('GET /api/settings/operational requires authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/settings/operational',
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/settings/operational returns settings, 7-day grid, storage, and licensing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/settings/operational',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.settings).toBeDefined();
      expect(body.settings.recordingMode).toBeDefined();
      expect(body.grid).toHaveLength(7);
      expect(body.storage).toHaveProperty('totalBytes');
      expect(body.storage).toHaveProperty('freeBytes');
      expect(body.storage).toHaveProperty('retentionDays');
      expect(body.licensing).toHaveProperty('edition');
      expect(body.licensing).toHaveProperty('cameraLimit');
    });

    it('PUT /api/settings/operational rejects non-ADMIN role with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/settings/operational',
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: {
          recordingMode: 'MOTION_ONLY',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('PUT /api/settings/operational updates settings for ADMIN', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/settings/operational',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          recordingMode: 'MOTION_ONLY',
          retentionDays: 30,
          warningThresholdPercent: 75,
          criticalThresholdPercent: 88,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.settings.recordingMode).toBe('MOTION_ONLY');
      expect(body.settings.retentionDays).toBe(30);
      expect(body.settings.warningThresholdPercent).toBe(75);
      expect(body.settings.criticalThresholdPercent).toBe(88);
    });

    it('PUT /api/settings/operational rejects invalid payloads with 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/settings/operational',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          recordingMode: 'INVALID_MODE',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('ValidationError');
    });
  });

  describe('4. Camera Schedule Endpoints & Grid Resolution', () => {
    it('GET /api/settings/schedule/:cameraId returns camera schedule with grid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/settings/schedule/test-cam-1',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.schedule.cameraId).toBe('test-cam-1');
      expect(body.schedule.grid).toHaveLength(7);
      expect(body.schedule.mode).toBeDefined();
    });

    it('PUT /api/settings/schedule/:cameraId updates schedule for camera', async () => {
      const newWindows = [
        { dayOfWeek: 1, startHour: 8, startMin: 0, endHour: 20, endMin: 0 },
        { dayOfWeek: 2, startHour: 8, startMin: 0, endHour: 20, endMin: 0 },
      ];

      const res = await app.inject({
        method: 'PUT',
        url: '/api/settings/schedule/test-cam-1',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          mode: 'SCHEDULED',
          windows: newWindows,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.schedule.mode).toBe('SCHEDULED');
      expect(body.schedule.windows).toHaveLength(2);
      expect(body.schedule.grid[1][8]).toBe(true);
      expect(body.schedule.grid[1][7]).toBe(false);
    });
  });

  describe('5. Storage Purge & Bookmark Evidence Protection', () => {
    it('POST /api/settings/storage/purge requires ADMIN role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/settings/storage/purge',
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST /api/settings/storage/purge runs purge and returns cleanup metrics', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/settings/storage/purge',
        headers: { authorization: `Bearer ${adminToken}` },
        query: { retentionDays: '15' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.retentionPurge).toHaveProperty('deletedSegmentsCount');
      expect(body.retentionPurge).toHaveProperty('freedBytes');
      expect(body.quotaCleanup).toHaveProperty('triggered');
      expect(body.metricsAfter).toHaveProperty('usedPercent');
    });

    it('StorageController protects bookmarked segments from deletion during retention purge', async () => {
      const storageController = recordingEngine.getStorageController();

      // Create a test segment
      const bookmarkedSegment = {
        id: 'seg-bookmarked-01',
        cameraId: 'cam-test',
        filePath: '/var/recordings/cam-test/seg1.mp4',
        startTime: new Date(Date.now() - 40 * 86400000).toISOString(), // 40 days old (exceeds 15d retention)
        endTime: new Date(Date.now() - 40 * 86400000 + 60000).toISOString(),
        sizeBytes: 1048576,
      };

      const regularSegment = {
        id: 'seg-regular-02',
        cameraId: 'cam-test',
        filePath: '/var/recordings/cam-test/seg2.mp4',
        startTime: new Date(Date.now() - 40 * 86400000).toISOString(), // 40 days old
        endTime: new Date(Date.now() - 40 * 86400000 + 60000).toISOString(),
        sizeBytes: 1048576,
      };

      // Mock catalog oldest recordings
      const catalog = (storageController as any).catalog;
      vi.spyOn(catalog, 'getOldestRecordings')
        .mockResolvedValueOnce([bookmarkedSegment, regularSegment])
        .mockResolvedValue([]);
      const deleteSpy = vi.spyOn(catalog, 'deleteSegmentInternal').mockResolvedValue({
        success: true,
        recordingId: 'test',
        freedBytes: 1048576,
      });

      // Mock bookmark checker so seg-bookmarked-01 returns true
      storageController.setBookmarkChecker(async (seg) => {
        return seg.id === 'seg-bookmarked-01';
      });

      const result = await storageController.purgeRetention(15);

      // regularSegment was deleted, bookmarkedSegment was spared!
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith(
        'seg-regular-02',
        regularSegment.filePath,
        regularSegment.sizeBytes
      );
      expect(result.deletedSegmentsCount).toBe(1);
    });
  });
});
