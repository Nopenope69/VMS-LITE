import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { AuthService } from '../src/users/auth.service.js';

describe('RBAC & User Authentication', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    // Create test JWT tokens directly for RBAC testing
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

  describe('Authentication Guard', () => {
    it('returns 401 Unauthorized when no token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 200 and user profile when valid token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.username).toBe('admin');
      expect(body.user.role).toBe(Role.ADMIN);
    });

    it('returns 401 when invalid token format or signature is passed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: 'Bearer invalid-token-string',
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('Role-Based Access Control', () => {
    it('allows Admin to access admin-only endpoints (/api/auth/users)', async () => {
      // Missing body returns 400 Bad Request, proving auth & role guard passed
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('required');
    });

    it('blocks Viewer with 403 Forbidden on admin-only endpoints (/api/auth/users)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/users',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
        payload: {
          username: 'newuser',
          password: 'password123',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.currentRole).toBe(Role.VIEWER);
      expect(body.requiredRoles).toContain(Role.ADMIN);
    });
  });

  describe('AuthService unit checks', () => {
    const authService = new AuthService();

    it('hashes passwords securely using bcrypt', async () => {
      const password = 'mySecretPassword123';
      const hash = await authService.hashPassword(password);

      expect(hash).not.toBe(password);
      expect(hash.startsWith('$2b$')).toBe(true);

      const isValid = await authService.verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await authService.verifyPassword('wrongPassword', hash);
      expect(isInvalid).toBe(false);
    });
  });
});
