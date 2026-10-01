import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { settingsService } from './settings.service.js';
import {
  UpdateOperationalSettingsSchema,
  UpdateCameraScheduleInputSchema,
} from './settings.types.js';
import { z } from 'zod';

const PurgeStorageQuerySchema = z.object({
  retentionDays: z.coerce.number().int().min(0).max(365).optional(),
});

export const settingsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/settings/operational
   * Retrieves operational settings, 7-day schedule grid, storage status, and license summary.
   */
  app.get(
    '/operational',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const data = await settingsService.getOperationalSettings(request.server.capabilities);
        return reply.status(200).send({
          success: true,
          ...data,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'SettingsRetrievalFailed',
          message: err.message || 'Failed to retrieve operational settings',
        });
      }
    }
  );

  /**
   * PUT /api/settings/operational
   * Updates system-wide operational settings (Admin only).
   */
  app.put(
    '/operational',
    {
      preHandler: [authenticate, requireRole(Role.ADMIN)],
    },
    async (request, reply) => {
      try {
        const body = UpdateOperationalSettingsSchema.parse(request.body);
        const updated = await settingsService.updateOperationalSettings(body);
        return reply.status(200).send({
          success: true,
          settings: updated,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid operational settings payload',
            details: err.errors,
          });
        }
        return reply.status(500).send({
          error: 'SettingsUpdateFailed',
          message: err.message || 'Failed to update operational settings',
        });
      }
    }
  );

  /**
   * GET /api/settings/schedule/:cameraId
   * Retrieves camera-specific recording schedule and 7-day grid.
   */
  app.get<{ Params: { cameraId: string } }>(
    '/schedule/:cameraId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { cameraId } = request.params;
      try {
        const schedule = await settingsService.getCameraSchedule(cameraId);
        return reply.status(200).send({
          success: true,
          schedule,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'ScheduleRetrievalFailed',
          message: err.message || 'Failed to retrieve camera schedule',
        });
      }
    }
  );

  /**
   * PUT /api/settings/schedule/:cameraId
   * Sets camera-specific recording schedule and mode (Admin only).
   */
  app.put<{ Params: { cameraId: string } }>(
    '/schedule/:cameraId',
    {
      preHandler: [authenticate, requireRole(Role.ADMIN)],
    },
    async (request, reply) => {
      const { cameraId } = request.params;
      try {
        const body = UpdateCameraScheduleInputSchema.parse(request.body);
        const updated = await settingsService.updateCameraSchedule(cameraId, body);
        return reply.status(200).send({
          success: true,
          schedule: updated,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid camera schedule payload',
            details: err.errors,
          });
        }
        if (err.name === 'CameraNotFoundError') {
          return reply.status(404).send({ error: 'NotFound', message: err.message });
        }
        return reply.status(500).send({
          error: 'ScheduleUpdateFailed',
          message: err.message || 'Failed to update camera schedule',
        });
      }
    }
  );

  /**
   * POST /api/settings/storage/purge
   * Triggers storage cleanup by retention days and FIFO quota (Admin only).
   */
  app.post(
    '/storage/purge',
    {
      preHandler: [authenticate, requireRole(Role.ADMIN)],
    },
    async (request, reply) => {
      try {
        const query = PurgeStorageQuerySchema.parse(request.query || {});
        const result = await settingsService.purgeStorage(query.retentionDays);
        return reply.status(200).send({
          success: true,
          ...result,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid query parameters for storage purge',
            details: err.errors,
          });
        }
        return reply.status(500).send({
          error: 'PurgeFailed',
          message: err.message || 'Failed to execute storage purge',
        });
      }
    }
  );
};

export default settingsRoutes;
