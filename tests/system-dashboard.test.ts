import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { Role } from '@prisma/client';

describe('System Overview Landing Dashboard API (Phase 18 - Plan 02 - MVP-11)', () => {
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

  it('rejects unauthorized requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/dashboard',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns comprehensive system dashboard metrics for authenticated operators', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/dashboard',
      headers: {
        authorization: `Bearer ${viewerToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.success).toBe(true);
    expect(['HEALTHY', 'DEGRADED', 'CRITICAL']).toContain(body.status);
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);

    // Fleet breakdown
    expect(body.fleet).toBeDefined();
    expect(typeof body.fleet.total).toBe('number');
    expect(typeof body.fleet.online).toBe('number');
    expect(typeof body.fleet.degraded).toBe('number');
    expect(typeof body.fleet.offline).toBe('number');
    expect(typeof body.fleet.unknown).toBe('number');

    // Recording engine status
    expect(body.recording).toBeDefined();
    expect(typeof body.recording.total).toBe('number');
    expect(typeof body.recording.mode).toBe('string');
    expect(typeof body.recording.motionBufferedSegments).toBe('number');
    expect(typeof body.recording.activeIncidentsCount).toBe('number');

    // Storage metrics & retention
    expect(body.storage).toBeDefined();
    expect(typeof body.storage.totalBytes).toBe('number');
    expect(typeof body.storage.usedBytes).toBe('number');
    expect(typeof body.storage.freeBytes).toBe('number');
    expect(typeof body.storage.usedPercent).toBe('number');
    expect(typeof body.storage.retentionDays).toBe('number');
    expect(typeof body.storage.estimatedDaysRemaining).toBe('number');

    // Licensing
    expect(body.licensing).toBeDefined();
    expect(typeof body.licensing.edition).toBe('string');
    expect(typeof body.licensing.cameraLimit).toBe('number');

    // Recent events list
    expect(Array.isArray(body.recentEvents)).toBe(true);
  });

  it('allows Admin to fetch system dashboard metrics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/dashboard',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.storage.totalBytes).toBeGreaterThan(0);
  });
});
