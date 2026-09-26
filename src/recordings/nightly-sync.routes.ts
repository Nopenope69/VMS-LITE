import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../users/rbac.guard.js';
import { nightlySyncService } from './nightly-sync.service.js';

export const UpdateNightlyConfigSchema = z.object({
  enabled: z.boolean().optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
  maxBandwidthMbps: z.number().positive().max(1000).optional(),
  syncTarget: z.enum(['incident_clips', 'daily_summaries', 'all_flagged']).optional(),
  hqServerUrl: z.string().url().optional(),
});

export const nightlySyncRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/v1/nightly-sync/config
   * Returns current off-peak sync schedule and target settings.
   */
  app.get(
    '/config',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      const config = nightlySyncService.getConfig();
      return reply.send({
        success: true,
        config,
      });
    }
  );

  /**
   * POST /api/v1/nightly-sync/config
   * Updates off-peak schedule window and bandwidth ceiling.
   */
  app.post(
    '/config',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const parsed = UpdateNightlyConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          details: parsed.error.issues,
        });
      }

      try {
        const updated = nightlySyncService.updateConfig(parsed.data);
        return reply.send({
          success: true,
          message: 'Nightly sync configuration updated',
          config: updated,
        });
      } catch (err: any) {
        return reply.status(400).send({
          error: 'ConfigError',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/nightly-sync/status
   * Returns current sync status, window countdown, and transfer metrics.
   */
  app.get(
    '/status',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      const status = nightlySyncService.getStatus();
      return reply.send({
        success: true,
        status,
      });
    }
  );

  /**
   * POST /api/v1/nightly-sync/trigger
   * Triggers an immediate off-peak batch transfer (operator override).
   */
  app.post(
    '/trigger',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      const result = nightlySyncService.triggerManualSync();
      return reply.send(result);
    }
  );
};

export default nightlySyncRoutes;
