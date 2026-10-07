import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { setupService } from './setup.service.js';
import { AuthService } from '../users/auth.service.js';
import { setMediaCookie } from '../media/media-proxy.routes.js';
import { ADMIN_ONLY } from '../users/camera-scope.js';

export const setupRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/system/setup-status
   * Checks whether the appliance is currently in an unprovisioned first-boot state.
   */
  app.get(
    '/setup-status',
    { config: { cameraAccess: { none: 'first-boot status, no camera data' } } },
    async (_request, reply) => {
      try {
        const status = await setupService.getSetupStatus();
        return reply.send({
          success: true,
          ...status,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'SetupStatusError',
          message: err.message || 'Failed to query setup status',
        });
      }
    }
  );

  /**
   * POST /api/system/setup-complete
   * Admin-only. Commits installer first-boot settings and updates default credentials.
   */
  app.post(
    '/setup-complete',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      config: { cameraAccess: ADMIN_ONLY },
    },
    async (request, reply) => {
      try {
        const body = (request.body || {}) as any;
        const { user, ...result } = await setupService.completeSetup(body, (request as any).user?.id);
        if (user) {
          // The password change revoked existing sessions; hand the installer a new token
          const token = app.jwt.sign(new AuthService().tokenClaims(user));
          setMediaCookie(request, reply, token);
          return reply.send({ ...result, token, user: { id: user.id, username: user.username, role: user.role } });
        }
        return reply.send(result);
      } catch (err: any) {
        return reply.status(400).send({
          error: 'SetupCompletionError',
          message: err.message || 'Failed to complete appliance setup',
        });
      }
    }
  );
};

export default setupRoutes;
