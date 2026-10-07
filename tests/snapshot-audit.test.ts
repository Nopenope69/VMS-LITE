import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { grantCamera, signAs } from './helpers/auth.js';

describe('Server-Authoritative Snapshot Audit Pipeline (BSA-Aware)', () => {
  let app: FastifyInstance;
  let operatorToken: string;
  const testSnapshotsDir = path.resolve(process.cwd(), 'recordings/test-snapshots');

  beforeAll(async () => {
    process.env.SNAPSHOTS_PATH = testSnapshotsDir;
    app = await createServer({ logger: false });
    await app.ready();
    operatorToken = await signAs(app, { id: 'usr-op-1', username: 'operator1', role: 'OPERATOR' });
    for (const cameraId of ['cam-01', 'cam-02', 'cam-rate-limit', 'cam-download-test', 'cam-deleted-file-test', 'cam-db-audit', 'cam-fail-loud', 'cam-fail-loud-api']) {
      await grantCamera('usr-op-1', cameraId, { canViewLive: true });
    }
  });

  afterAll(async () => {
    await app.close();
    try {
      await fs.rm(testSnapshotsDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('receives image bytes, calculates SHA-256 over exact persisted bytes, and logs audit record', async () => {
    const rawImage = Buffer.from('FAKE-JPEG-PAYLOAD-BINARY-CONTENT-FOR-TESTING');
    const expectedServerHash = crypto.createHash('sha256').update(rawImage).digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: {
        authorization: `Bearer ${operatorToken}`,
      },
      payload: {
        image: rawImage.toString('base64'),
        cameraId: 'cam-01',
        timestampUtc: new Date().toISOString(),
        streamProfile: 'MAIN',
        resolution: '1920x1080',
        playbackSegmentId: 'seg-123',
        mediaOffsetSeconds: 42.5,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.sha256).toBe(expectedServerHash);
    expect(body.downloadUrl).toBe(`/api/audit/snapshot/${body.id}/download`);
    expect(body.filename).toContain('SNAP_cam-01_');

    // Verify file actually exists and contains exact bytes
    const persistedBytes = await fs.readFile(body.filePath);
    expect(persistedBytes.equals(rawImage)).toBe(true);
  });

  it('accepts data URL prefix and decodes to raw bytes before computing SHA-256', async () => {
    const rawImage = Buffer.from('ANOTHER-TEST-IMAGE-WITH-DATA-URL-PREFIX');
    const expectedHash = crypto.createHash('sha256').update(rawImage).digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: {
        authorization: `Bearer ${operatorToken}`,
      },
      payload: {
        image: `data:image/jpeg;base64,${rawImage.toString('base64')}`,
        cameraId: 'cam-02',
        timestampUtc: new Date().toISOString(),
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sha256).toBe(expectedHash);
  });

  it('requires JWT authentication for snapshot recording', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      payload: {
        image: Buffer.from('test').toString('base64'),
        cameraId: 'cam-01',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('validates required payload fields', async () => {
    // Missing image
    const resNoImg = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { cameraId: 'cam-01' },
    });
    expect(resNoImg.statusCode).toBe(400);

    // Missing cameraId
    const resNoCam = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { image: Buffer.from('test').toString('base64') },
    });
    expect(resNoCam.statusCode).toBe(400);
  });

  it('enforces token-bucket rate limiting on rapid successive snapshots for same camera', async () => {
    const rawImage = Buffer.from('RATE-LIMIT-TEST-IMAGE');

    // First request should succeed
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        image: rawImage.toString('base64'),
        cameraId: 'cam-rate-limit',
        timestampUtc: new Date().toISOString(),
      },
    });
    expect(res1.statusCode).toBe(201);

    // Immediate second request for same camera should trigger rate limiting / cooldown
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        image: rawImage.toString('base64'),
        cameraId: 'cam-rate-limit',
        timestampUtc: new Date().toISOString(),
      },
    });
    expect(res2.statusCode).toBe(429);
    const body2 = res2.json();
    expect(body2.error).toBe('RateLimitExceeded');
    expect(body2.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('downloads snapshot file with image/jpeg and attachment header', async () => {
    const rawImage = Buffer.from('DOWNLOADABLE-IMAGE-CONTENT-12345');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        image: rawImage.toString('base64'),
        cameraId: 'cam-download-test',
        timestampUtc: new Date().toISOString(),
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { id, filename } = createRes.json();

    const downloadRes = await app.inject({
      method: 'GET',
      url: `/api/audit/snapshot/${id}/download`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers['content-type']).toBe('image/jpeg');
    expect(downloadRes.headers['content-disposition']).toBe(`attachment; filename="${filename}"`);
    expect(downloadRes.rawPayload.equals(rawImage)).toBe(true);
  });

  it('returns 404 when downloading non-existent snapshot ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/snapshot/non-existent-uuid/download',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when downloading a snapshot whose file was removed from disk', async () => {
    const rawImage = Buffer.from('DISAPPEARING-FILE-TEST');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        image: rawImage.toString('base64'),
        cameraId: 'cam-deleted-file-test',
        timestampUtc: new Date().toISOString(),
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { id, filePath } = createRes.json();

    // Delete the file from disk
    await fs.unlink(filePath);

    const downloadRes = await app.inject({
      method: 'GET',
      url: `/api/audit/snapshot/${id}/download`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(downloadRes.statusCode).toBe(404);
    expect(downloadRes.json().message).toContain('not found on disk');
  });

  it('verifies audit record persisted in prisma database with server-computed hash', async () => {
    const { prisma } = await import('../src/db/prisma.js');
    const rawImage = Buffer.from('DATABASE-PERSISTENCE-AUDIT-RECORD');
    const expectedHash = crypto.createHash('sha256').update(rawImage).digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        image: rawImage.toString('base64'),
        cameraId: 'cam-db-audit',
        timestampUtc: new Date().toISOString(),
        streamProfile: 'SUB',
        resolution: '640x360',
        playbackSegmentId: 'seg-xyz-789',
        mediaOffsetSeconds: 15.2,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    const record = await (prisma as any).auditLog.findUnique({
      where: { id: body.id },
    });

    expect(record).toBeDefined();
    expect(record.action).toBe('SNAPSHOT_CAPTURED');
    expect(record.userId).toBe('usr-op-1');
    expect(record.username).toBe('operator1');
    expect(record.cameraId).toBe('cam-db-audit');
    expect(record.sha256).toBe(expectedHash);
    expect(record.streamProfile).toBe('SUB');
    expect(record.resolution).toBe('640x360');
    expect(record.playbackSegmentId).toBe('seg-xyz-789');
    expect(record.mediaOffsetSeconds).toBe(15.2);
  });

  it('enforces fail-loud runtime and compensating file cleanup on database failure', async () => {
    const { auditService } = await import('../src/audit/audit.service.js');
    const { prisma } = await import('../src/db/prisma.js');

    const originalCreate = prisma.auditLog.create;
    prisma.auditLog.create = (async () => {
      throw new Error('Database transaction failed on audit log insertion');
    }) as any;

    try {
      const rawImage = Buffer.from('FAIL-LOUD-AND-COMPENSATING-CLEANUP-IMAGE');
      const storageDir = auditService.getStorageDir();

      // 1. Calling recordSnapshot directly should throw (fail-loud)
      await expect(
        auditService.recordSnapshot({
          imageBuffer: rawImage,
          userId: 'usr-fail-loud',
          username: 'failUser',
          cameraId: 'cam-fail-loud',
          timestampUtc: new Date(),
          clientIp: '127.0.0.1',
        })
      ).rejects.toThrow('Database transaction failed on audit log insertion');

      // 2. Compensating cleanup check: No orphaned file should remain in storageDir
      const files = await fs.readdir(storageDir);
      const matching = files.filter((f) => f.includes('cam-fail-loud'));
      expect(matching.length).toBe(0);

      // 3. API endpoint should return 500 when database fails
      const res = await app.inject({
        method: 'POST',
        url: '/api/audit/snapshot',
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: {
          image: rawImage.toString('base64'),
          cameraId: 'cam-fail-loud-api',
          timestampUtc: new Date().toISOString(),
        },
      });
      expect(res.statusCode).toBe(500);

      const apiFiles = await fs.readdir(storageDir);
      const matchingApi = apiFiles.filter((f) => f.includes('cam-fail-loud-api'));
      expect(matchingApi.length).toBe(0);
    } finally {
      prisma.auditLog.create = originalCreate;
    }
  });
});


