import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { initiateGracefulShutdown } from './shutdown.service.js';
import { ADMIN_ONLY } from '../users/camera-scope.js';

export const shutdownRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/system/shutdown
   * Admin-only. Flushes recording engine, tears down services, then sends SIGTERM.
   *
   * Recording Invariant: engine.stop() completes all in-progress segment writes
   * via the onClose hook before the process exits.
   */
  app.post(
    '/shutdown',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      config: { cameraAccess: ADMIN_ONLY },
    },
    async (_request, reply) => {
      // Send the response before shutting down
      reply.send({
        success: true,
        message: 'Shutdown initiated. Service will restart via process manager.',
      });

      // Fire-and-forget: close app and schedule SIGTERM after response flush
      // We intentionally do NOT await here — the response must leave first.
      initiateGracefulShutdown(app).catch((err) => {
        app.log.error({ err }, 'Error during shutdown sequence');
      });
    }
  );
};

export default shutdownRoutes;
