import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { buildTarGz, extractTarGz, BackupManifest } from '../src/system/backup.service.js';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

describe('System Configuration Backup & Restore', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Unit tests: tar.gz builder/extractor ──────────────────────────────────

  it('buildTarGz produces valid gzip that extractTarGz can round-trip', () => {
    const files = [
      { name: 'test.json', content: Buffer.from('{"hello":"world"}') },
      { name: 'data.txt', content: Buffer.from('some data here') },
    ];
    const archive = buildTarGz(files);

    // Verify it's valid gzip
    const decompressed = zlib.gunzipSync(archive);
    expect(decompressed.length).toBeGreaterThan(0);

    // Verify round-trip extraction
    const extracted = extractTarGz(archive);
    expect(extracted.size).toBe(2);
    expect(extracted.get('test.json')?.toString()).toBe('{"hello":"world"}');
    expect(extracted.get('data.txt')?.toString()).toBe('some data here');
  });

  it('extractTarGz rejects invalid gzip data', () => {
    expect(() => extractTarGz(Buffer.from('not-gzip'))).toThrow('decompression failed');
  });

  // ── Integration tests: backup endpoint ────────────────────────────────────

  it('POST /api/system/backup returns valid tar.gz with manifest and config', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/gzip');
    expect(res.headers['content-disposition']).toContain('vms-backup-');

    // Verify archive structure
    const files = extractTarGz(res.rawPayload);
    expect(files.has('manifest.json')).toBe(true);
    expect(files.has('config.json')).toBe(true);

    // Verify manifest structure
    const manifest: BackupManifest = JSON.parse(files.get('manifest.json')!.toString());
    expect(manifest.version).toBe('1.0');
    expect(manifest.schemaVersion).toBe('vms-bare-v1');
    expect(manifest.createdAt).toBeDefined();
    expect(manifest.hostname).toBeDefined();
    expect(manifest.configSha256).toBeDefined();
    expect(manifest.modelCounts).toBeDefined();

    // Verify SHA-256 integrity
    const configBuf = files.get('config.json')!;
    const actualSha = crypto.createHash('sha256').update(configBuf).digest('hex');
    expect(actualSha).toBe(manifest.configSha256);
  });

  it('rejects backup request without authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  // ── Integration tests: restore endpoint ───────────────────────────────────

  it('rejects restore with invalid (non-gzip) payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('not-a-valid-archive'),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBeDefined();
  });

  it('rejects restore with tampered config.json (SHA-256 mismatch)', async () => {
    // Build a valid-looking archive with mismatched SHA-256
    const config = JSON.stringify({ users: [], cameras: [] });
    const manifest = JSON.stringify({
      version: '1.0',
      schemaVersion: 'vms-bare-v1',
      createdAt: new Date().toISOString(),
      hostname: 'test',
      modelCounts: {},
      configSha256: 'aaaa_wrong_hash_bbbb',
    });

    const archive = buildTarGz([
      { name: 'manifest.json', content: Buffer.from(manifest) },
      { name: 'config.json', content: Buffer.from(config) },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/octet-stream',
      },
      payload: archive,
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain('SHA-256 mismatch');
  });

  it('round-trips backup and restore with skip-existing mode', async () => {
    // 1. Create backup
    const backupRes = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(backupRes.statusCode).toBe(200);

    // 2. Restore with skip-existing (all records should be skipped since they already exist)
    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/system/restore?mode=skip-existing',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/octet-stream',
      },
      payload: backupRes.rawPayload,
    });
    expect(restoreRes.statusCode).toBe(200);
    const result = JSON.parse(restoreRes.payload);
    expect(result.success).toBe(true);
    expect(result.mode).toBe('skip-existing');
    expect(result.summary).toBeDefined();
  });

  it('rejects invalid restore mode', async () => {
    // First create a valid backup
    const backupRes = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore?mode=invalid-mode',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/octet-stream',
      },
      payload: backupRes.rawPayload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain('InvalidRestoreMode');
  });

  it('rejects restore with incompatible schema version', async () => {
    const config = JSON.stringify({ users: [], cameras: [] });
    const configBuf = Buffer.from(config);
    const sha = crypto.createHash('sha256').update(configBuf).digest('hex');

    const manifest = JSON.stringify({
      version: '1.0',
      schemaVersion: 'vms-bare-v99',
      createdAt: new Date().toISOString(),
      hostname: 'test',
      modelCounts: {},
      configSha256: sha,
    });

    const archive = buildTarGz([
      { name: 'manifest.json', content: Buffer.from(manifest) },
      { name: 'config.json', content: configBuf },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'content-type': 'application/octet-stream',
      },
      payload: archive,
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain('Incompatible backup schema version');
  });
});
