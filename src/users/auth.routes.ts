import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { authenticate, requireRole } from './rbac.guard.js';

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const authService = new AuthService();

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

    const user = await authService.verifyCredentials(username, password);
    if (!user) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid username or password',
      });
    }

    const token = fastify.jwt.sign({
      id: user.id,
      username: user.username,
      role: user.role,
    });

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
  fastify.get('/me', { preHandler: [authenticate] }, async (request) => {
    return {
      user: request.user,
    };
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
};
