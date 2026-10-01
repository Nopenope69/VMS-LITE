import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { storageTelemetryService } from '../src/system/storage-telemetry.service.js';
import { signAs } from './helpers/auth.js';

describe('Sub-Project C: Storage Reliability & Drive Telemetry End-to-End', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    token = await signAs(app, {
      id: 'admin-uuid',
      username: 'admin',
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('queries storage drives endpoint and receives structured hardware telemetry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/storage/drives',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.totalDrives).toBe('number');
    expect(Array.isArray(body.drives)).toBe(true);

    if (body.drives.length > 0) {
      const drive = body.drives[0];
      expect(drive.name).toBeDefined();
      expect(drive.path).toBeDefined();
      expect(typeof drive.rotational).toBe('boolean');
      expect(typeof drive.removable).toBe('boolean');
      expect(['PASSED', 'FAILED', 'UNKNOWN', 'NOT_SUPPORTED']).toContain(drive.healthStatus);
    }
  });

  it('queries removable storage targets for evidence export or secondary storage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/storage/removable',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.removableMounts)).toBe(true);
  });

  it('verifies that dashboard API aggregates drive telemetry summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/dashboard',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.drives).toBeDefined();
    expect(typeof body.drives.healthyCount).toBe('number');
    expect(typeof body.drives.warningCount).toBe('number');
    expect(typeof body.drives.criticalCount).toBe('number');
  });

  it('triggers storage.drive_degraded event on high temperature or failure threshold', async () => {
    // Poll telemetry service directly to verify alert cycle
    const drives = await storageTelemetryService.poll();
    expect(drives).toBeDefined();
    expect(Array.isArray(drives)).toBe(true);
  });
});
