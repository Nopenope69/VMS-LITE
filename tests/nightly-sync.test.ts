import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { nightlySyncService } from '../src/recordings/nightly-sync.service.js';

describe('Off-Peak Nightly Batch Sync Engine (/api/v1/nightly-sync)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-nightly-test',
      username: 'admin',
      role: Role.ADMIN,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Service unit logic (nightlySyncService)', () => {
    it('evaluates off-peak time window accurately for normal and crossing midnight windows', () => {
      nightlySyncService.updateConfig({ startHour: 2, endHour: 5 });

      const date2AM = new Date();
      date2AM.setHours(3, 30, 0, 0);
      expect(nightlySyncService.isCurrentTimeInWindow(date2AM)).toBe(true);

      const date12PM = new Date();
      date12PM.setHours(12, 0, 0, 0);
      expect(nightlySyncService.isCurrentTimeInWindow(date12PM)).toBe(false);

      // Midnight crossover (23:00 to 04:00)
      nightlySyncService.updateConfig({ startHour: 23, endHour: 4 });
      const dateMidnight = new Date();
      dateMidnight.setHours(1, 15, 0, 0);
      expect(nightlySyncService.isCurrentTimeInWindow(dateMidnight)).toBe(true);

      // Restore to default (2 to 5)
      nightlySyncService.updateConfig({ startHour: 2, endHour: 5 });
    });

    it('rejects invalid configuration ranges', () => {
      expect(() => {
        nightlySyncService.updateConfig({ startHour: 28 });
      }).toThrow('startHour must be between 0 and 23');

      expect(() => {
        nightlySyncService.updateConfig({ maxBandwidthMbps: -5 });
      }).toThrow('maxBandwidthMbps must be positive');
    });

    it('executes manual batch sync trigger', () => {
      const result = nightlySyncService.triggerManualSync();
      expect(result.success).toBe(true);
      expect(result.syncedCount).toBeGreaterThanOrEqual(1);

      const status = nightlySyncService.getStatus();
      expect(status.currentStatus).toBe('COMPLETED');
      expect(status.lastSyncTime).toBeDefined();
    });
  });

  describe('REST API Endpoints', () => {
    it('returns 401 Unauthorized for unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/nightly-sync/config',
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/nightly-sync/config returns current configuration', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/nightly-sync/config',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.config.startHour).toBeDefined();
      expect(body.config.endHour).toBeDefined();
    });

    it('POST /api/v1/nightly-sync/config updates schedule parameters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/nightly-sync/config',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          startHour: 1,
          endHour: 4,
          maxBandwidthMbps: 15,
          syncTarget: 'incident_clips',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.config.startHour).toBe(1);
      expect(body.config.endHour).toBe(4);
      expect(body.config.maxBandwidthMbps).toBe(15);
    });

    it('GET /api/v1/nightly-sync/status returns window schedule and status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/nightly-sync/status',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.status.windowSchedule).toBe('01:00 - 04:00');
      expect(body.status.maxBandwidthMbps).toBe(15);
    });

    it('POST /api/v1/nightly-sync/trigger executes immediate batch sync', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/nightly-sync/trigger',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.syncedCount).toBeGreaterThanOrEqual(1);
    });
  });
});
