import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { buildZipArchive } from '../src/export/zip-builder.js';
import { EvidenceBundleService } from '../src/export/evidence-bundle.service.js';
import { Role } from '@prisma/client';
import { signAs } from './helpers/auth.js';

const execFileAsync = promisify(execFile);

describe('Self-Verifying Evidence Export Package (Phase 20 - Plan 01 - MVP-13)', () => {
  const testDir = path.resolve(process.cwd(), 'tests', 'fixtures', 'evidence-test');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('generates a valid ZIP archive matching PKWARE specification with built-in CRC-32', () => {
    const entries = [
      { name: 'video.mp4', data: Buffer.from('FAKE-H264-VIDEO-BITSTREAM-12345') },
      { name: 'manifest.json', data: JSON.stringify({ version: '1.0' }) },
      { name: 'audit.json', data: JSON.stringify({ nodeVersion: 'Basic VMS v0.1.0' }) },
      { name: 'verify.js', data: 'console.log("ok");' },
    ];

    const zipBuffer = buildZipArchive(entries);
    expect(zipBuffer.length).toBeGreaterThan(100);

    // Verify local header signature: 0x04034b50
    expect(zipBuffer.readUInt32LE(0)).toBe(0x04034b50);

    // Verify End of Central Directory signature: 0x06054b50 near the end
    const eocdSig = zipBuffer.readUInt32LE(zipBuffer.length - 22);
    expect(eocdSig).toBe(0x06054b50);
  });

  it('constructs manifest.json, audit.json, and packages standalone verify.js', async () => {
    const fakeVideoContent = Buffer.from('EVIDENCE-VIDEO-PAYLOAD-INCIDENT-ALARM-RECORDING');
    const fakeVideoPath = path.join(testDir, 'raw-export.mp4');
    await fs.writeFile(fakeVideoPath, fakeVideoContent);

    const videoSha256 = crypto.createHash('sha256').update(fakeVideoContent).digest('hex');

    const mockExportService: any = {
      getExportJob: async (id: string) => ({
        id,
        cameraId: 'cam-gate-01',
        userId: 'usr-admin-1',
        startTime: '2026-09-27T01:00:00.000Z',
        endTime: '2026-09-27T01:05:00.000Z',
        exportMode: 'STREAM_COPY',
        status: 'COMPLETED',
        filePath: fakeVideoPath,
        fileSize: fakeVideoContent.length,
        sha256: videoSha256,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    };

    const mockPrisma: any = {
      camera: {
        findUnique: async () => ({
          id: 'cam-gate-01',
          name: 'Main Gate Camera',
          ip: '192.168.1.100',
          manufacturer: 'CP Plus',
          model: 'CP-UNC-TA21ZL3-VMD',
        }),
      },
      user: {
        findUnique: async () => ({
          id: 'usr-admin-1',
          username: 'security_lead',
          role: 'ADMIN',
        }),
      },
      bookmark: {
        findMany: async () => [
          {
            id: 'bm-01',
            title: 'Unauthorized Entry Alarm',
            category: 'incident',
            timestamp: new Date('2026-09-27T01:02:15.000Z'),
            description: 'Triggered by ONVIF motion zone exclusion',
          },
        ],
      },
    };

    const bundleService = new EvidenceBundleService({
      prisma: mockPrisma,
      exportService: mockExportService,
    });

    const bundle = await bundleService.buildEvidenceBundle('job-12345', '192.168.1.42');
    expect(bundle.filename).toContain('EVIDENCE_EXPORT_job-12345_');
    expect(bundle.filename.endsWith('.zip')).toBe(true);
    expect(bundle.sha256).toBeDefined();
    expect(bundle.buffer.length).toBeGreaterThan(fakeVideoContent.length);
  });

  it('executes standalone verify.js to prove authenticity and catches tampered bytes', async () => {
    const videoData = Buffer.from('GENUINE-CCTV-STREAM-PRESERVED-RECORDING-FRAME-DATA');
    const expectedSha256 = crypto.createHash('sha256').update(videoData).digest('hex');

    const manifest = {
      version: '1.0',
      exportId: 'exp-test-verify',
      cameraId: 'cam-01',
      cameraName: 'Cash Counter',
      startTime: '2026-09-27T02:00:00.000Z',
      endTime: '2026-09-27T02:05:00.000Z',
      durationSeconds: 300,
      generatedAt: new Date().toISOString(),
      requestedBy: {
        userId: 'u-1',
        username: 'inspector',
        role: 'ADMIN',
      },
      files: [
        {
          filename: 'video.mp4',
          sha256: expectedSha256,
          sizeBytes: videoData.length,
        },
      ],
    };

    const audit = {
      exportId: 'exp-test-verify',
      generatedAt: new Date().toISOString(),
      generatedAtLocal: '27 Sep 2026, 07:30:00 IST',
      nodeVersion: 'Basic VMS v0.1.0',
      systemPlatform: 'darwin arm64',
      requestIp: '192.168.1.55',
      requestedBy: manifest.requestedBy,
      camera: { id: 'cam-01', name: 'Cash Counter' },
      timelineBookmarks: [],
      evidenceIntegrity: {
        algorithm: 'SHA-256',
        manifestChecksum: 'fake-checksum',
      },
    };

    // 1. Write authentic bundle files to isolated directory
    const verifyScriptContent = (await import('../src/export/evidence-bundle.service.js')).STANDALONE_VERIFY_SCRIPT;

    const bundleDir = path.join(testDir, 'extracted_bundle');
    await fs.mkdir(bundleDir, { recursive: true });

    await fs.writeFile(path.join(bundleDir, 'video.mp4'), videoData);
    await fs.writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(bundleDir, 'audit.json'), JSON.stringify(audit, null, 2));
    await fs.writeFile(path.join(bundleDir, 'verify.js'), verifyScriptContent);

    // 2. Run verify.js on authentic files -> exit code 0
    const { stdout: passOutput } = await execFileAsync('node', ['verify.js'], { cwd: bundleDir });
    expect(passOutput).toContain('[VERIFY] Reading manifest.json... OK');
    expect(passOutput).toContain('Export ID: exp-test-verify');
    expect(passOutput).toContain('MATCH: video.mp4 is authentic.');
    expect(passOutput).toContain('[RESULT] INTEGRITY VERIFIED: Video has not been modified or tampered with.');

    // 3. TAMPER SIMULATION: Modify 1 byte in video.mp4
    const tamperedData = Buffer.from(videoData);
    tamperedData[0] = tamperedData[0] ^ 0xff; // Flip bits
    await fs.writeFile(path.join(bundleDir, 'video.mp4'), tamperedData);

    // 4. Run verify.js on tampered video -> must fail with code 1
    try {
      await execFileAsync('node', ['verify.js'], { cwd: bundleDir });
      expect.fail('Expected verify.js to reject tampered video');
    } catch (err: any) {
      expect(err.code).toBe(1);
      const output = err.stdout + err.stderr;
      expect(output).toContain('[FAIL] INTEGRITY COMPROMISED: Checksum mismatch for video.mp4!');
      expect(output).toContain('[RESULT] VERIFICATION FAILED: One or more files have been modified or corrupted!');
    }
  });

  describe('Fastify REST API: GET /api/recordings/export/:id/bundle', () => {
    let app: FastifyInstance;
    let operatorToken: string;

    beforeEach(async () => {
      app = await createServer({ logger: false });
      await app.ready();
      vi.spyOn(app.capabilities, 'has').mockImplementation(() => true);
      operatorToken = await signAs(app, { id: 'usr-op', username: 'operator', role: Role.OPERATOR });
    });

    afterEach(async () => {
      await app.close();
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recordings/export/any-job-id/bundle',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for non-existent or incomplete export jobs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recordings/export/nonexistent-job-uuid/bundle',
        headers: { Authorization: `Bearer ${operatorToken}` },
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('NotFound');
    });

    it('streams self-verifying ZIP bundle with 200 and attachment header for completed export', async () => {
      // Create a mock completed job in evidenceBundleService
      const fakeVideoPath = path.join(testDir, 'route-test-video.mp4');
      await fs.writeFile(fakeVideoPath, 'MOCK-STREAM-DATA-12345');

      const mockJob = {
        id: 'test-export-job-uuid',
        cameraId: 'cam-test',
        userId: 'usr-op',
        startTime: '2026-09-27T01:00:00.000Z',
        endTime: '2026-09-27T01:05:00.000Z',
        exportMode: 'STREAM_COPY' as const,
        status: 'COMPLETED' as const,
        filePath: fakeVideoPath,
        fileSize: 22,
        sha256: crypto.createHash('sha256').update('MOCK-STREAM-DATA-12345').digest('hex'),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };

      const { exportService } = await import('../src/export/export.service.js');
      vi.spyOn(exportService, 'getExportJob').mockResolvedValue(mockJob as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/recordings/export/test-export-job-uuid/bundle',
        headers: { Authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toContain('attachment; filename="EVIDENCE_EXPORT_test-export-job-uuid_');
      expect(res.headers['x-checksum-sha256']).toBeDefined();
      expect(res.rawPayload.length).toBeGreaterThan(100);
      expect(res.rawPayload.readUInt32LE(0)).toBe(0x04034b50); // ZIP magic signature
    });
  });
});
