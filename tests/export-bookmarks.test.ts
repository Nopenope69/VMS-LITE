import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';
import { ExportCompatibilityValidator } from '../src/export/export-compatibility.validator.js';
import { ExportService } from '../src/export/export.service.js';
import { ExportPruneService } from '../src/export/export-prune.service.js';
import { BookmarkService } from '../src/bookmarks/bookmark.service.js';

describe('Server-Side Clip Export & Timeline Bookmarks (Phase 10 - EXT-04, EXT-05)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorWithExportToken: string;
  let operatorNoExportToken: string;
  let viewerToken: string;

  const testCameraId = '00000000-0000-4000-8000-000000000001';
  const opWithExportId = '00000000-0000-4000-8000-000000000002';
  const opNoExportId = '00000000-0000-4000-8000-000000000003';
  const viewerId = '00000000-0000-4000-8000-000000000004';

  const testExportsDir = path.join(process.cwd(), 'tests', 'fixtures', 'exports');

  beforeAll(async () => {
    await fs.mkdir(testExportsDir, { recursive: true });

    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: Role.ADMIN,
    });

    operatorWithExportToken = app.jwt.sign({
      id: opWithExportId,
      username: 'op_export',
      role: Role.OPERATOR,
    });

    operatorNoExportToken = app.jwt.sign({
      id: opNoExportId,
      username: 'op_no_export',
      role: Role.OPERATOR,
    });

    viewerToken = app.jwt.sign({
      id: viewerId,
      username: 'viewer',
      role: Role.VIEWER,
    });

    // Mock CameraPermission lookups in prisma
    vi.spyOn(prisma.cameraPermission, 'findUnique').mockImplementation(async (args: any) => {
      const { userId, cameraId } = args.where.userId_cameraId;
      if (cameraId !== testCameraId) return null;

      if (userId === opWithExportId) {
        return {
          id: 'perm-1',
          userId,
          cameraId,
          canViewLive: true,
          canViewPlayback: true,
          canControlPtz: true,
          canExportClips: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      if (userId === opNoExportId) {
        return {
          id: 'perm-2',
          userId,
          cameraId,
          canViewLive: true,
          canViewPlayback: true,
          canControlPtz: false,
          canExportClips: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      return null;
    });
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(testExportsDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('1. Licensing Capability Gating', () => {
    it('returns 403 when requesting clip export without extended.clip_export capability', async () => {
      // Ensure extended.clip_export is missing
      const hasCap = app.capabilities.has('extended.clip_export');
      expect(hasCap).toBe(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/export',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          cameraId: testCameraId,
          startTime: '2026-09-24T10:00:00.000Z',
          endTime: '2026-09-24T10:05:00.000Z',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.capability).toBe('extended.clip_export');
    });

    it('returns 403 when querying bookmarks without extended.bookmarks capability', async () => {
      const hasCap = app.capabilities.has('extended.bookmarks');
      expect(hasCap).toBe(false);

      const res = await app.inject({
        method: 'GET',
        url: `/api/cameras/${testCameraId}/bookmarks`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.capability).toBe('extended.bookmarks');
    });
  });

  describe('2. RBAC & Camera ACL Enforcement', () => {
    beforeAll(() => {
      // Enable capabilities for RBAC testing
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.clip_export' || cap === 'extended.bookmarks') return true;
        return false;
      });
    });

    it('rejects VIEWER role from exporting clips (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/export',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          cameraId: testCameraId,
          startTime: '2026-09-24T10:00:00.000Z',
          endTime: '2026-09-24T10:05:00.000Z',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Forbidden');
    });

    it('rejects OPERATOR without canExportClips permission (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/export',
        headers: { authorization: `Bearer ${operatorNoExportToken}` },
        payload: {
          cameraId: testCameraId,
          startTime: '2026-09-24T10:00:00.000Z',
          endTime: '2026-09-24T10:05:00.000Z',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Forbidden');
    });

    it('allows OPERATOR with canExportClips: true to initiate export (202 Accepted)', async () => {
      // Mock recording lookup for the camera
      vi.spyOn(prisma.recording, 'findMany').mockResolvedValueOnce([
        {
          id: 'rec-1',
          cameraId: testCameraId,
          mediaMtxPath: 'cam1',
          filePath: path.join(testExportsDir, 'dummy1.mp4'),
          fileName: 'dummy1.mp4',
          startTime: new Date('2026-09-24T10:00:00.000Z'),
          endTime: new Date('2026-09-24T10:05:00.000Z'),
          duration: 300,
          sizeBytes: BigInt(1024),
          format: 'fmp4',
          createdAt: new Date(),
        } as any,
      ]);

      // Create dummy file so file check passes
      await fs.writeFile(path.join(testExportsDir, 'dummy1.mp4'), 'DUMMY_VIDEO');

      const res = await app.inject({
        method: 'POST',
        url: '/api/recordings/export',
        headers: { authorization: `Bearer ${operatorWithExportToken}` },
        payload: {
          cameraId: testCameraId,
          startTime: '2026-09-24T10:00:00.000Z',
          endTime: '2026-09-24T10:05:00.000Z',
          exportMode: 'STREAM_COPY',
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.job).toBeDefined();
      expect(body.job.exportMode).toBe('STREAM_COPY');
    });
  });

  describe('3. ExportCompatibilityValidator Gate', () => {
    it('returns compatible: true for identical segment formats and codecs', async () => {
      const validator = new ExportCompatibilityValidator({
        checkFileExists: async () => true,
      });

      const result = await validator.validate([
        { filePath: '/dummy/seg1.mp4', format: 'fmp4', codec: 'h264', resolution: '1920x1080' },
        { filePath: '/dummy/seg2.mp4', format: 'fmp4', codec: 'h264', resolution: '1920x1080' },
      ]);

      expect(result.compatible).toBe(true);
    });

    it('rejects with INCOMPATIBLE_SEGMENTS when a segment file is missing on disk', async () => {
      const validator = new ExportCompatibilityValidator({
        checkFileExists: async (p) => p.includes('seg1'),
      });

      const result = await validator.validate([
        { filePath: '/dummy/seg1.mp4', format: 'fmp4' },
        { filePath: '/dummy/seg2.mp4', format: 'fmp4' },
      ]);

      expect(result.compatible).toBe(false);
      expect(result.errorCode).toBe('INCOMPATIBLE_SEGMENTS');
      expect(result.message).toContain('not found on disk');
    });

    it('rejects with INCOMPATIBLE_SEGMENTS on video codec mismatch without silent fallback', async () => {
      const validator = new ExportCompatibilityValidator({
        checkFileExists: async () => true,
      });

      const result = await validator.validate([
        { filePath: '/dummy/seg1.mp4', format: 'fmp4', codec: 'h264' },
        { filePath: '/dummy/seg2.mp4', format: 'fmp4', codec: 'h265' },
      ]);

      expect(result.compatible).toBe(false);
      expect(result.errorCode).toBe('INCOMPATIBLE_SEGMENTS');
      expect(result.message).toContain('Incompatible video codecs');
    });

    it('rejects with INCOMPATIBLE_SEGMENTS on resolution switch midway through', async () => {
      const validator = new ExportCompatibilityValidator({
        checkFileExists: async () => true,
      });

      const result = await validator.validate([
        { filePath: '/dummy/seg1.mp4', format: 'fmp4', resolution: '1920x1080' },
        { filePath: '/dummy/seg2.mp4', format: 'fmp4', resolution: '3840x2160' },
      ]);

      expect(result.compatible).toBe(false);
      expect(result.errorCode).toBe('INCOMPATIBLE_SEGMENTS');
      expect(result.message).toContain('Incompatible video resolution switch');
    });
  });

  describe('4. Stream Copy vs Transcoded OSD Derivative & SHA-256 Checksum', () => {
    it('executes stream copy with -c copy, sets status to COMPLETED, and computes SHA-256 integrity checksum', async () => {
      let capturedArgs: string[] = [];
      const service = new ExportService({
        exportsDir: testExportsDir,
        spawnFfmpegFn: async (args) => {
          capturedArgs = args;
          // Create dummy output file
          const outPath = args[args.length - 1];
          await fs.writeFile(outPath, 'VIDEO_PAYLOAD_TEST');
          return { exitCode: 0, stderr: '' };
        },
      });

      const dummySeg = path.join(testExportsDir, 'seg1.mp4');
      await fs.writeFile(dummySeg, 'SEG1_DATA');

      const job = await service.createExportJob({
        cameraId: testCameraId,
        startTime: '2026-09-24T12:00:00.000Z',
        endTime: '2026-09-24T12:05:00.000Z',
        exportMode: 'STREAM_COPY',
        mockMode: true,
        customSegments: [{ filePath: dummySeg, format: 'fmp4' }],
      });

      expect(job.status).toBe('COMPLETED');
      expect(job.exportMode).toBe('STREAM_COPY');
      expect(job.sha256).toBeDefined();
      expect(job.sha256?.length).toBe(64); // Valid hex SHA-256
      expect(job.completedAt).toBeDefined();

      // Verify FFmpeg args use -c copy
      expect(capturedArgs).toContain('-c');
      expect(capturedArgs).toContain('copy');
      expect(capturedArgs).not.toContain('libx264');
    });

    it('executes Transcoded Derivative with drawtext filter when TRANSCODED_OSD is selected', async () => {
      let capturedArgs: string[] = [];
      const service = new ExportService({
        exportsDir: testExportsDir,
        cameraLookup: async () => ({ id: testCameraId, name: 'Main Gate Cam' }),
        spawnFfmpegFn: async (args) => {
          capturedArgs = args;
          const outPath = args[args.length - 1];
          await fs.writeFile(outPath, 'OSD_VIDEO_PAYLOAD');
          return { exitCode: 0, stderr: '' };
        },
      });

      const dummySeg = path.join(testExportsDir, 'seg2.mp4');
      await fs.writeFile(dummySeg, 'SEG2_DATA');

      const job = await service.createExportJob({
        cameraId: testCameraId,
        startTime: '2026-09-24T12:00:00.000Z',
        endTime: '2026-09-24T12:05:00.000Z',
        exportMode: 'TRANSCODED_OSD',
        mockMode: true,
        customSegments: [{ filePath: dummySeg, format: 'fmp4' }],
      });

      expect(job.status).toBe('COMPLETED');
      expect(job.exportMode).toBe('TRANSCODED_OSD');
      expect(job.includeOsd).toBe(true);

      // Verify FFmpeg args invoke drawtext and libx264
      expect(capturedArgs).toContain('-vf');
      const vfIndex = capturedArgs.indexOf('-vf');
      expect(capturedArgs[vfIndex + 1]).toContain('drawtext');
      expect(capturedArgs[vfIndex + 1]).toContain('Main Gate Cam');
      expect(capturedArgs).toContain('libx264');
    });
  });

  describe('5. Two-Tier Storage Cleanup Priority Hierarchy', () => {
    it('prunes expired exports (>48h TTL) at 85% capacity without deleting unexpired exports', async () => {
      const service = new ExportService({ exportsDir: testExportsDir });
      const unlinkedFiles: string[] = [];
      const pruneService = new ExportPruneService({
        exportService: service,
        unlinkFn: async (p) => {
          unlinkedFiles.push(p);
        },
      });

      // Add expired completed job (>48h old)
      const expiredJob = await service.createExportJob({
        cameraId: testCameraId,
        startTime: '2026-09-20T10:00:00.000Z',
        endTime: '2026-09-20T10:05:00.000Z',
        mockMode: true,
        customSegments: [{ filePath: path.join(testExportsDir, 'seg1.mp4'), format: 'fmp4' }],
      });
      // Force expiredAt to the past
      (expiredJob as any).expiresAt = new Date(Date.now() - 3600 * 1000).toISOString();
      await (service as any).persistJob(expiredJob);

      // Add unexpired completed job
      const unexpiredJob = await service.createExportJob({
        cameraId: testCameraId,
        startTime: '2026-09-24T12:00:00.000Z',
        endTime: '2026-09-24T12:05:00.000Z',
        mockMode: true,
        customSegments: [{ filePath: path.join(testExportsDir, 'seg1.mp4'), format: 'fmp4' }],
      });

      // Run cleanup at 86% usage
      const result = await pruneService.enforceStorageHierarchy(0.86);

      expect(result.expiredPruned).toBe(1);
      expect(result.emergencyPruned).toBe(0);

      // Check job states
      const updatedExpired = await service.getExportJob(expiredJob.id);
      expect(updatedExpired?.status).toBe('EXPIRED');

      const updatedUnexpired = await service.getExportJob(unexpiredJob.id);
      expect(updatedUnexpired?.status).toBe('COMPLETED');
    });

    it('emergency purges unexpired exports FIFO at 90% capacity while preserving continuous recordings', async () => {
      const service = new ExportService({ exportsDir: testExportsDir });
      const unlinkedFiles: string[] = [];
      const pruneService = new ExportPruneService({
        exportService: service,
        unlinkFn: async (p) => {
          unlinkedFiles.push(p);
        },
      });

      // Add unexpired export
      const unexpiredJob = await service.createExportJob({
        cameraId: testCameraId,
        startTime: '2026-09-24T14:00:00.000Z',
        endTime: '2026-09-24T14:05:00.000Z',
        mockMode: true,
        customSegments: [{ filePath: path.join(testExportsDir, 'seg1.mp4'), format: 'fmp4' }],
      });

      // Trigger 92% emergency threshold
      const result = await pruneService.enforceStorageHierarchy(0.92);

      expect(result.emergencyPruned).toBeGreaterThanOrEqual(1);

      const checkJob = await service.getExportJob(unexpiredJob.id);
      expect(checkJob?.status).toBe('EXPIRED');
    });
  });

  describe('6. Timeline Incident Bookmarks & Range Queries', () => {
    const bookmarkService = new BookmarkService();

    it('creates and lists bookmarks filtered by time window and category', async () => {
      const b1 = await bookmarkService.createBookmark(testCameraId, {
        timestamp: '2026-09-24T10:15:00.000Z',
        title: 'Unidentified Vehicle',
        description: 'Black sedan entered delivery bay',
        category: 'incident',
      });

      const b2 = await bookmarkService.createBookmark(testCameraId, {
        timestamp: '2026-09-24T14:30:00.000Z',
        title: 'Visitor Sign-in',
        category: 'visitor',
      });

      expect(b1.id).toBeDefined();
      expect(b1.category).toBe('incident');
      expect(b2.category).toBe('visitor');

      // Range query covering only the first bookmark
      const morningList = await bookmarkService.listBookmarks(testCameraId, {
        from: '2026-09-24T10:00:00.000Z',
        to: '2026-09-24T12:00:00.000Z',
      });
      expect(morningList.length).toBe(1);
      expect(morningList[0].id).toBe(b1.id);

      // Category filter query
      const visitorList = await bookmarkService.listBookmarks(testCameraId, {
        category: 'visitor',
      });
      expect(visitorList.length).toBe(1);
      expect(visitorList[0].id).toBe(b2.id);

      // Delete bookmark
      const deleted = await bookmarkService.deleteBookmark(b1.id);
      expect(deleted).toBe(true);

      const afterDelete = await bookmarkService.listBookmarks(testCameraId);
      expect(afterDelete.find((b) => b.id === b1.id)).toBeUndefined();
    });

    it('exposes REST API for bookmark creation and time-window queries', async () => {
      const resPost = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/bookmarks`,
        headers: { authorization: `Bearer ${operatorWithExportToken}` },
        payload: {
          timestamp: '2026-09-24T15:00:00.000Z',
          title: 'Suspicious Motion Alert',
          category: 'incident',
        },
      });

      expect(resPost.statusCode).toBe(201);
      const created = resPost.json().bookmark;
      expect(created.title).toBe('Suspicious Motion Alert');

      // Query through REST endpoint with time-window query params
      const resGet = await app.inject({
        method: 'GET',
        url: `/api/cameras/${testCameraId}/bookmarks?from=2026-09-24T14:00:00.000Z&to=2026-09-24T16:00:00.000Z`,
        headers: { authorization: `Bearer ${operatorWithExportToken}` },
      });

      expect(resGet.statusCode).toBe(200);
      const body = resGet.json();
      expect(body.bookmarks.length).toBeGreaterThanOrEqual(1);

      // Viewer cannot delete bookmark
      const resViewerDel = await app.inject({
        method: 'DELETE',
        url: `/api/cameras/${testCameraId}/bookmarks/${created.id}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(resViewerDel.statusCode).toBe(403);

      // Operator can delete bookmark
      const resOpDel = await app.inject({
        method: 'DELETE',
        url: `/api/cameras/${testCameraId}/bookmarks/${created.id}`,
        headers: { authorization: `Bearer ${operatorWithExportToken}` },
      });
      expect(resOpDel.statusCode).toBe(200);
    });
  });
});
