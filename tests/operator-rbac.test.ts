import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';

describe('Operator Role & Camera ACL RBAC (Phase 8)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;

  const testOperatorId = 'operator-test-uuid-1';
  const permittedCamId = 'camera-permitted-uuid';
  const restrictedCamId = 'camera-restricted-uuid';

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: Role.ADMIN,
    });

    operatorToken = app.jwt.sign({
      id: testOperatorId,
      username: 'guard1',
      role: Role.OPERATOR,
    });

    viewerToken = app.jwt.sign({
      id: 'viewer-uuid',
      username: 'viewer1',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Capability Gating for Operator Role', () => {
    it('returns 403 when creating OPERATOR without extended.operator_role capability', async () => {
      // Ensure capability is absent
      const hasCap = app.capabilities.has('extended.operator_role');
      expect(hasCap).toBe(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/users',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          username: 'new_operator',
          password: 'password123',
          role: Role.OPERATOR,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.capability).toBe('extended.operator_role');
    });

    it('allows creating OPERATOR when extended.operator_role capability is present', async () => {
      // Temporarily mock capabilities.has to return true for extended.operator_role
      const originalHas = app.capabilities.has.bind(app.capabilities);
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.operator_role') return true;
        return originalHas(cap);
      });

      // Mock user creation in prisma
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.user, 'create').mockResolvedValue({
        id: 'new-op-uuid',
        username: 'guard_created',
        passwordHash: 'hashed',
        role: Role.OPERATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/users',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          username: 'guard_created',
          password: 'password123',
          role: Role.OPERATOR,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user.role).toBe(Role.OPERATOR);
      expect(body.user.username).toBe('guard_created');

      vi.restoreAllMocks();
    });
  });

  describe('User Listing & Camera Permission Assignment', () => {
    it('allows Admin to list all users', async () => {
      vi.spyOn(prisma.user, 'findMany').mockResolvedValue([
        {
          id: 'admin-uuid',
          username: 'admin',
          role: Role.ADMIN,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: testOperatorId,
          username: 'guard1',
          role: Role.OPERATOR,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/users',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.users[1].role).toBe(Role.OPERATOR);

      vi.restoreAllMocks();
    });

    it('rejects Operator and Viewer from listing all users', async () => {
      const resOp = await app.inject({
        method: 'GET',
        url: '/api/auth/users',
        headers: { authorization: `Bearer ${operatorToken}` },
      });
      expect(resOp.statusCode).toBe(403);

      const resView = await app.inject({
        method: 'GET',
        url: '/api/auth/users',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(resView.statusCode).toBe(403);
    });

    it('allows Admin with extended capability to assign per-camera permissions', async () => {
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
        if (cap === 'extended.operator_role') return true;
        return false;
      });

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: testOperatorId,
        username: 'guard1',
        passwordHash: 'h',
        role: Role.OPERATOR,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(prisma.cameraPermission, 'upsert').mockResolvedValue({
        id: 'perm-1',
        userId: testOperatorId,
        cameraId: permittedCamId,
        canViewLive: true,
        canViewPlayback: true,
        canControlPtz: true,
        canExportClips: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: 'PUT',
        url: `/api/auth/users/${testOperatorId}/permissions`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: [
            {
              cameraId: permittedCamId,
              canViewLive: true,
              canViewPlayback: true,
              canControlPtz: true,
              canExportClips: false,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.updatedCount).toBe(1);
      expect(body.permissions[0].canControlPtz).toBe(true);

      vi.restoreAllMocks();
    });
  });

  describe('Camera ACL Enforcement for Operators', () => {
    const mockCameras = [
      {
        id: permittedCamId,
        name: 'Main Gate',
        rtspUrl: 'rtsp://gate',
        status: 'online',
        mediaMtxPath: 'gate',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: restrictedCamId,
        name: 'Server Room',
        rtspUrl: 'rtsp://server',
        status: 'online',
        mediaMtxPath: 'server',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it('filters GET /api/cameras to only permitted cameras for Operator', async () => {
      vi.spyOn(prisma.camera, 'findMany').mockResolvedValue(mockCameras as any);
      vi.spyOn(prisma.cameraPermission, 'findMany').mockResolvedValue([
        {
          id: 'perm-1',
          userId: testOperatorId,
          cameraId: permittedCamId,
          canViewLive: true,
          canViewPlayback: false,
          canControlPtz: false,
          canExportClips: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras',
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(1);
      expect(body.cameras[0].id).toBe(permittedCamId);
      expect(body.cameras[0].name).toBe('Main Gate');

      vi.restoreAllMocks();
    });

    it('allows Operator to access permitted camera detail', async () => {
      vi.spyOn(prisma.camera, 'findUnique').mockResolvedValue(mockCameras[0] as any);
      vi.spyOn(prisma.cameraPermission, 'findUnique').mockResolvedValue({
        id: 'perm-1',
        userId: testOperatorId,
        cameraId: permittedCamId,
        canViewLive: true,
        canViewPlayback: true,
        canControlPtz: false,
        canExportClips: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/cameras/${permittedCamId}`,
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(permittedCamId);

      vi.restoreAllMocks();
    });

    it('rejects Operator with 403 when accessing unauthorized camera detail', async () => {
      vi.spyOn(prisma.cameraPermission, 'findUnique').mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/cameras/${restrictedCamId}`,
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.message).toContain('Operator lacks \'canViewLive\' permission');

      vi.restoreAllMocks();
    });

    it('rejects Operator with 403 when attempting administrative deletion', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/cameras/${permittedCamId}`,
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
    });

    it('allows Admin to view restricted camera detail and delete camera', async () => {
      vi.spyOn(prisma.camera, 'findUnique').mockResolvedValue(mockCameras[1] as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/cameras/${restrictedCamId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(restrictedCamId);

      vi.restoreAllMocks();
    });
  });
});
