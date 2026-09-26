import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from '../src/server.js';
import { exportService } from '../src/export/export.service.js';
import { cameraService } from '../src/cameras/camera.service.js';

describe('Legal Evidence Certification API (BSA 2023 / Section 65B)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;
  let testJobId: string;
  let testSha256: string;
  const dummyFile = path.join(process.cwd(), 'tests', 'fixtures', 'cert_dummy.mp4');

  beforeAll(async () => {
    await fs.mkdir(path.dirname(dummyFile), { recursive: true });
    await fs.writeFile(dummyFile, 'DUMMY_VIDEO_STREAM_DATA_FOR_BSA_CERT');

    app = await createServer({ logger: false });
    await app.ready();

    // Enable extended.clip_export capability
    vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
      if (cap === 'extended.clip_export') return true;
      return false;
    });

    adminToken = app.jwt.sign({
      id: 'admin-legal-id',
      username: 'chief_security_officer',
      role: Role.ADMIN,
    });

    operatorToken = app.jwt.sign({
      id: 'operator-legal-id',
      username: 'guard_operator',
      role: Role.OPERATOR,
    });

    const cam = await cameraService.onboardManualCamera(
      {
        name: 'Main Vault North',
        rtspUrl: 'rtsp://192.168.1.150:554/live',
      },
      10
    );

    // Create an export job in mockMode
    const today = new Date().toISOString().split('T')[0];
    const job = await exportService.createExportJob({
      cameraId: cam.id,
      startTime: `${today}T08:00:00.000Z`,
      endTime: `${today}T08:15:00.000Z`,
      mockMode: true,
      customSegments: [
        {
          filePath: dummyFile,
          format: 'fmp4',
        },
      ],
    });

    testJobId = job.id;
    testSha256 = job.sha256!;
  });

  afterAll(async () => {
    await app.close();
    await fs.unlink(dummyFile).catch(() => {});
  });

  describe('GET /api/recordings/export/:id/certificate', () => {
    it('returns 401 Unauthorized when not logged in', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/recordings/export/${testJobId}/certificate`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns legally formatted certificate JSON under BSA 2023', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/recordings/export/${testJobId}/certificate`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.certificate.certificateId).toContain('CERT-BSA-');
      expect(json.certificate.statutoryJurisdiction).toContain('Bharatiya Sakshya Adhiniyam 2023');
      expect(json.certificate.technicalSpecifications.sha256Hash).toBe(testSha256);
      expect(json.certificate.statutoryDeclaration).toContain('operating properly without any interception');
    });

    it('returns printable HTML certificate document when format=html requested', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/recordings/export/${testJobId}/certificate?format=html`,
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.payload).toContain('Certificate of Authenticity of Electronic Record');
      expect(res.payload).toContain(testSha256);
    });
  });

  describe('POST /api/recordings/export/verify', () => {
    it('verifies authenticity of a valid SHA-256 digital fingerprint', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/export/verify',
        payload: { sha256: testSha256 },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.verified).toBe(true);
      expect(json.record.jobId).toBe(testJobId);
      expect(json.record.sha256).toBe(testSha256);
    });

    it('returns 404 for a forged or unknown SHA-256 hash', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/export/verify',
        payload: { sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      });

      expect(res.statusCode).toBe(404);
      const json = JSON.parse(res.payload);
      expect(json.verified).toBe(false);
    });
  });
});
