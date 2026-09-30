import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { extractTarGz } from '../src/system/backup.service.js';
import crypto from 'node:crypto';

describe('Sub-Project B: Appliance Operations & Maintenance End-to-End Integration', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: 'ADMIN',
    });

    viewerToken = app.jwt.sign({
      id: 'viewer-uuid',
      username: 'viewer',
      role: 'VIEWER',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── 1. Backup & Restore End-to-End ──────────────────────────────────────────

  it('generates a verified config backup archive that passes restore validation', async () => {
    // 1. Download backup
    const backupRes = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(backupRes.statusCode).toBe(200);
    expect(backupRes.headers['content-type']).toContain('application/gzip');

    // 2. Extract and verify manifest and SHA-256
    const files = extractTarGz(backupRes.rawPayload);
    expect(files.has('manifest.json')).toBe(true);
    expect(files.has('config.json')).toBe(true);

    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    const configBytes = files.get('config.json')!;
    const computedSha = crypto.createHash('sha256').update(configBytes).digest('hex');

    expect(manifest.configSha256).toBe(computedSha);
    expect(manifest.schemaVersion).toBe('vms-bare-v1');

    // 3. Restore with skip-existing mode
    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/system/restore?mode=skip-existing',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/gzip',
      },
      payload: backupRes.rawPayload,
    });

    expect(restoreRes.statusCode).toBe(200);
    const restoreData = JSON.parse(restoreRes.payload);
    expect(restoreData.success).toBe(true);
    expect(restoreData.mode).toBe('skip-existing');
    expect(restoreData.summary).toBeDefined();

    // 4. Restore with overwrite mode
    const overwriteRes = await app.inject({
      method: 'POST',
      url: '/api/system/restore?mode=overwrite',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/gzip',
      },
      payload: backupRes.rawPayload,
    });

    expect(overwriteRes.statusCode).toBe(200);
    const overwriteData = JSON.parse(overwriteRes.payload);
    expect(overwriteData.success).toBe(true);
    expect(overwriteData.mode).toBe('overwrite');
  });

  // ── 2. RBAC Enforcement Across All Sub-Project B Endpoints ──────────────────

  it('enforces ADMIN role on POST /api/system/backup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('enforces ADMIN role on POST /api/system/restore', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore',
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        'Content-Type': 'application/gzip',
      },
      payload: Buffer.from('data'),
    });
    expect(res.statusCode).toBe(403);
  });

  it('enforces ADMIN role on POST /api/system/shutdown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/shutdown',
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── 3. NTP Status & Dashboard Integration ───────────────────────────────────

  it('GET /api/system/ntp-status returns structured NTP telemetry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/ntp-status',
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(typeof data.available).toBe('boolean');
    if (data.available) {
      expect(typeof data.synchronized).toBe('boolean');
    }
  });

  it('GET /api/system/dashboard includes ntpSync field', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/dashboard',
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.success).toBe(true);
    expect(data.ntpSync).toBeDefined();
    expect(typeof data.ntpSync.available).toBe('boolean');
    expect(typeof data.ntpSync.synchronized).toBe('boolean');
  });
});
