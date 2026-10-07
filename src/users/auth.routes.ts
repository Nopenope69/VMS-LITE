import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { AuthService, MIN_PASSWORD_LENGTH, UserAdminError } from './auth.service.js';
import { authenticate, requireRole } from './rbac.guard.js';
import { auditService } from '../audit/audit.service.js';
import { LoginThrottle } from './login-throttle.js';
import { cameraScopeOf } from './camera-scope.js';
import { prisma } from '../db/prisma.js';
import { clearMediaCookie, setMediaCookie } from '../media/media-proxy.routes.js';

const VALID_ROLES = new Set<string>(Object.values(Role));

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const authService = new AuthService();
  const loginThrottle = new LoginThrottle();

  // POST /api/auth/login
  fastify.post<{
    Body: { username?: string; password?: string };
  }>('/login', async (request, reply) => {
    const { username, password } = request.body || {};

    if (!username || !password) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Username and password are required',
      });
    }

    const retryAfter = loginThrottle.retryAfterSeconds(request.ip, username);
    if (retryAfter > 0) {
      return reply
        .status(429)
        .header('Retry-After', String(retryAfter))
        .send({
          error: 'TooManyRequests',
          message: `Too many failed login attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        });
    }

    const user = await authService.verifyCredentials(username, password);
    if (!user) {
      loginThrottle.recordFailure(request.ip, username);
      await auditService.log({
        action: 'AUTH_FAILURE',
        username,
        ipAddress: request.ip,
        metadata: { reason: 'Invalid credentials' },
      });
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid username or password',
      });
    }

    loginThrottle.recordSuccess(request.ip, username);
    await auditService.log({
      action: 'AUTH_LOGIN',
      userId: user.id,
      username: user.username,
      ipAddress: request.ip,
      metadata: { role: user.role },
    });

    const token = fastify.jwt.sign(authService.tokenClaims(user));
    setMediaCookie(request, reply, token);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    // Refresh the media cookie for sessions restored from a stored token
    const token = request.headers.authorization?.slice(7).trim();
    if (token) setMediaCookie(request, reply, token);
    // Effective per-camera rights for every role, so the UI needs no role rules
    const scope = await cameraScopeOf(request);
    const allCameraIds = (await prisma.camera.findMany({ select: { id: true } })).map((c: { id: string }) => c.id);
    const cameraPermissions = scope.permissions(allCameraIds);
    return {
      user: {
        ...request.user,
        cameraPermissions: cameraPermissions.map((p) => ({
          cameraId: p.cameraId,
          canViewLive: p.canViewLive,
          canViewPlayback: p.canViewPlayback,
          canControlPtz: p.canControlPtz,
          canExportClips: p.canExportClips,
        })),
      },
      capabilities: fastify.capabilities?.getAllCapabilities() ?? [],
    };
  });

  // POST /api/auth/logout
  fastify.post('/logout', async (_request, reply) => {
    clearMediaCookie(reply);
    return { success: true };
  });

  // GET /api/auth/users (Admin only)
  fastify.get('/users', { preHandler: [requireRole([Role.ADMIN])] }, async () => {
    const users = await authService.listUsers();
    return {
      count: users.length,
      users,
    };
  });

  // POST /api/auth/users (Admin only)
  fastify.post<{
    Body: { username: string; password: string; role?: Role };
  }>('/users', { preHandler: [requireRole([Role.ADMIN])] }, async (request, reply) => {
    const { username, password, role } = request.body || {};

    if (!username || !password) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Username and password are required',
      });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }
    if (role !== undefined && !VALID_ROLES.has(role)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: `Role must be one of ${[...VALID_ROLES].join(', ')}`,
      });
    }

    if (role === Role.OPERATOR && !fastify.capabilities?.has('extended.operator_role')) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: "Missing required capability: 'extended.operator_role'",
        capability: 'extended.operator_role',
      });
    }

    try {
      const newUser = await authService.createUser(username, password, role ?? Role.VIEWER);
      return reply.status(201).send({
        user: {
          id: newUser.id,
          username: newUser.username,
          role: newUser.role,
        },
      });
    } catch (err) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: (err as Error).message,
      });
    }
  });

  // GET /api/auth/users/:id/permissions (Admin or Self)
  fastify.get<{ Params: { id: string } }>(
    '/users/:id/permissions',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      if (request.user.role !== Role.ADMIN && request.user.id !== id) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Insufficient permissions to view other users permissions',
        });
      }

      const permissions = await authService.getUserPermissions(id);
      return {
        userId: id,
        count: permissions.length,
        permissions,
      };
    }
  );

  // PUT /api/auth/users/:id/permissions (Admin only, requires extended.operator_role capability)
  fastify.put<{
    Params: { id: string };
    Body: {
      permissions: Array<{
        cameraId: string;
        canViewLive?: boolean;
        canViewPlayback?: boolean;
        canControlPtz?: boolean;
        canExportClips?: boolean;
      }>;
    };
  }>(
    '/users/:id/permissions',
    {
      preHandler: [
        requireRole([Role.ADMIN]),
        async (request, reply) => {
          if (!fastify.capabilities?.has('extended.operator_role')) {
            reply.status(403).send({
              error: 'Forbidden',
              message: "Missing required capability: 'extended.operator_role'",
              capability: 'extended.operator_role',
            });
          }
        },
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { permissions } = request.body || {};

      if (!Array.isArray(permissions)) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'permissions must be an array',
        });
      }

      try {
        const updated = await authService.setUserPermissions(id, permissions);
        return reply.send({
          userId: id,
          updatedCount: updated.length,
          permissions: updated,
        });
      } catch (err) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: (err as Error).message,
        });
      }
    }
  );

  const sendAdminError = (reply: any, err: unknown) => {
    if (err instanceof UserAdminError) {
      return reply.status(err.statusCode).send({ error: err.name, message: err.message });
    }
    throw err;
  };

  // PATCH /api/auth/users/:id  { role }  (Admin only) - re-login required for that user
  fastify.patch<{ Params: { id: string }; Body: { role?: Role } }>(
    '/users/:id',
    { preHandler: [requireRole([Role.ADMIN])] },
    async (request, reply) => {
      const { role } = request.body || {};
      if (!role || !VALID_ROLES.has(role)) {
        return reply.status(400).send({ error: 'Bad Request', message: `role must be one of ${[...VALID_ROLES].join(', ')}` });
      }
      if (role === Role.OPERATOR && !fastify.capabilities?.has('extended.operator_role')) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: "Missing required capability: 'extended.operator_role'",
          capability: 'extended.operator_role',
        });
      }
      try {
        const updated = await authService.updateRole(request.params.id, role, request.user.id);
        await auditService.log({
          action: 'USER_ROLE_CHANGED',
          userId: request.user.id,
          username: request.user.username,
          ipAddress: request.ip,
          resource: `user:${updated.id}`,
          metadata: { targetUsername: updated.username, role },
        });
        return { user: { id: updated.id, username: updated.username, role: updated.role } };
      } catch (err) {
        return sendAdminError(reply, err);
      }
    }
  );

  // DELETE /api/auth/users/:id  (Admin only)
  fastify.delete<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: [requireRole([Role.ADMIN])] },
    async (request, reply) => {
      try {
        const deleted = await authService.deleteUser(request.params.id, request.user.id);
        await auditService.log({
          action: 'USER_DELETED',
          userId: request.user.id,
          username: request.user.username,
          ipAddress: request.ip,
          resource: `user:${deleted.id}`,
          metadata: { targetUsername: deleted.username, role: deleted.role },
        });
        return { success: true };
      } catch (err) {
        return sendAdminError(reply, err);
      }
    }
  );

  // POST /api/auth/users/:id/reset-password  { password }  (Admin only)
  fastify.post<{ Params: { id: string }; Body: { password?: string } }>(
    '/users/:id/reset-password',
    { preHandler: [requireRole([Role.ADMIN])] },
    async (request, reply) => {
      try {
        const user = await authService.resetPassword(request.params.id, request.body?.password ?? '');
        await auditService.log({
          action: 'USER_PASSWORD_RESET',
          userId: request.user.id,
          username: request.user.username,
          ipAddress: request.ip,
          resource: `user:${user.id}`,
          metadata: { targetUsername: user.username },
        });
        return { success: true };
      } catch (err) {
        return sendAdminError(reply, err);
      }
    }
  );

  // POST /api/auth/users/:id/revoke-sessions  (Admin, or the user themselves)
  fastify.post<{ Params: { id: string } }>(
    '/users/:id/revoke-sessions',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const isSelf = request.user.id === request.params.id;
      if (!isSelf && request.user.role !== Role.ADMIN) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only administrators can sign out other users' });
      }
      try {
        const user = await authService.revokeSessions(request.params.id);
        await auditService.log({
          action: 'USER_SESSIONS_REVOKED',
          userId: request.user.id,
          username: request.user.username,
          ipAddress: request.ip,
          resource: `user:${user.id}`,
          metadata: { targetUsername: user.username },
        });
        if (isSelf) clearMediaCookie(reply);
        return { success: true };
      } catch (err) {
        return sendAdminError(reply, err);
      }
    }
  );

  // POST /api/auth/me/password  { currentPassword, newPassword }
  // Signs out every other session and returns a fresh token for this one.
  fastify.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    '/me/password',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const user = await authService.changeOwnPassword(
          request.user.id,
          request.body?.currentPassword ?? '',
          request.body?.newPassword ?? ''
        );
        await auditService.log({
          action: 'USER_PASSWORD_CHANGED',
          userId: user.id,
          username: user.username,
          ipAddress: request.ip,
        });
        const token = fastify.jwt.sign(authService.tokenClaims(user));
        setMediaCookie(request, reply, token);
        return { token, user: { id: user.id, username: user.username, role: user.role } };
      } catch (err) {
        return sendAdminError(reply, err);
      }
    }
  );

  // GET /api/auth/users/:id/site-permissions (Admin or self)
  fastify.get<{ Params: { id: string } }>(
    '/users/:id/site-permissions',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      if (request.user.role !== Role.ADMIN && request.user.id !== id) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permissions' });
      }
      const permissions = await authService.getSitePermissions(id);
      return { userId: id, count: permissions.length, permissions };
    }
  );

  // PUT /api/auth/users/:id/site-permissions  { permissions: [{ siteId, canViewLive, ... }] }
  // Admin only; operator role is an Extended capability, like per-camera grants.
  fastify.put<{
    Params: { id: string };
    Body: { permissions?: Array<{ siteId: string; canViewLive?: boolean; canViewPlayback?: boolean; canControlPtz?: boolean; canExportClips?: boolean }> };
  }>(
    '/users/:id/site-permissions',
    { preHandler: [requireRole([Role.ADMIN])] },
    async (request, reply) => {
      if (!fastify.capabilities?.has('extended.operator_role')) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: "Missing required capability: 'extended.operator_role'",
          capability: 'extended.operator_role',
        });
      }
      const { permissions } = request.body || {};
      if (!Array.isArray(permissions) || permissions.some((p) => !p || typeof p.siteId !== 'string')) {
        return reply.status(400).send({ error: 'Bad Request', message: 'permissions must be an array of { siteId, ...flags }' });
      }
      try {
        const updated = await authService.setSitePermissions(request.params.id, permissions);
        await auditService.log({
          action: 'USER_SITE_PERMISSIONS_CHANGED',
          userId: request.user.id,
          username: request.user.username,
          ipAddress: request.ip,
          resource: `user:${request.params.id}`,
          metadata: { sites: updated.map((p: any) => p.siteId) },
        });
        return { userId: request.params.id, updatedCount: updated.length, permissions: updated };
      } catch (err) {
        return sendAdminError(reply, err);
      }
    }
  );
};
