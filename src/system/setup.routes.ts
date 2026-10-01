import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { setupService } from './setup.service.js';

export const setupRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/system/setup-status
   * Checks whether the appliance is currently in an unprovisioned first-boot state.
   */
  app.get(
    '/setup-status',
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
    },
    async (request, reply) => {
      try {
        const body = (request.body || {}) as any;
        const result = await setupService.completeSetup(body, (request as any).user?.id);
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
