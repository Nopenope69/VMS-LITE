import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../users/rbac.guard.js';
import { wanArchivalService, WanSyncStatus } from './wan-archival.service.js';

export const EnqueueClipSchema = z.object({
  cameraId: z.string().min(1, 'cameraId is required'),
  cameraName: z.string().optional(),
  eventType: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  clipDurationSeconds: z.number().int().positive().max(300).default(45),
  hqEndpointUrl: z.string().url().optional(),
});

export const wanArchivalRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/v1/wan-archival/queue
   * Lists incident clips queued or synced for WAN archival.
   */
  app.get<{ Querystring: { status?: WanSyncStatus } }>(
    '/queue',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const statusFilter = request.query?.status;
      const items = wanArchivalService.getQueue(statusFilter);
      return reply.send({
        success: true,
        count: items.length,
        items,
      });
    }
  );

  /**
   * POST /api/v1/wan-archival/sync
   * Enqueues an incident clip for immediate WAN upload to HQ.
   */
  app.post(
    '/sync',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const parsed = EnqueueClipSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          details: parsed.error.issues,
        });
      }

      const item = wanArchivalService.enqueueIncidentClip(parsed.data);
      return reply.status(201).send({
        success: true,
        message: `Incident clip queued for Central HQ WAN Archival`,
        item,
      });
    }
  );

  /**
   * POST /api/v1/wan-archival/retry/:id
   * Retries an upload for a failed clip.
   */
  app.post<{ Params: { id: string } }>(
    '/retry/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const ok = wanArchivalService.retryClip(id);
      if (!ok) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Incident clip with ID '${id}' not found`,
        });
      }
      return reply.send({
        success: true,
        message: `Clip retry triggered`,
      });
    }
  );

  /**
   * GET /api/v1/wan-archival/metrics
   * Returns WAN data metrics, queue counters, and savings percentage.
   */
  app.get(
    '/metrics',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      const metrics = wanArchivalService.getMetrics();
      return reply.send({
        success: true,
        metrics,
      });
    }
  );

  /**
   * DELETE /api/v1/wan-archival/completed
   * Cleans up synced records.
   */
  app.delete(
    '/completed',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      const count = wanArchivalService.clearCompleted(0);
      return reply.send({
        success: true,
        clearedCount: count,
      });
    }
  );
};

export default wanArchivalRoutes;
