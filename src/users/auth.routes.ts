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
};
