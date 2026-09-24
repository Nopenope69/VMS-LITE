import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireCameraPermission, requireRole } from '../users/rbac.guard.js';
import { requireCapability } from '../licensing/plugin.js';
import {
  CameraNotFoundError,
  PtzNotSupportedError,
  ptzService,
} from './ptz.service.js';

const PtzMoveBodySchema = z.object({
  x: z.number().min(-1).max(1).optional().default(0),
  y: z.number().min(-1).max(1).optional().default(0),
  z: z.number().min(-1).max(1).optional().default(0),
});

const SetPresetBodySchema = z.object({
  name: z.string().min(1).max(64),
});

export const ptzRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * Global error wrapper for PTZ routes
   */
  const handlePtzError = (err: any, reply: any) => {
    if (err instanceof CameraNotFoundError) {
      return reply.status(404).send({
        error: 'NotFound',
        message: err.message,
      });
    }
    if (err instanceof PtzNotSupportedError) {
      return reply.status(400).send({
        error: 'PtzNotSupported',
        message: err.message,
      });
    }
    if (err.name === 'ZodError') {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid PTZ parameters',
        details: err.errors,
      });
    }
    return reply.status(500).send({
      error: 'PtzExecutionFailed',
      message: err.message || 'PTZ operation failed',
    });
  };

  /**
   * POST /api/cameras/:id/ptz/move
   * Initiates continuous Pan/Tilt/Zoom with 1.5s server-side watchdog
   */
  app.post<{ Params: { id: string } }>(
    '/:id/ptz/move',
    {
      preHandler: [
        authenticate,
        requireCameraPermission('canControlPtz'),
        requireCapability('extended.ptz'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const body = PtzMoveBodySchema.parse(request.body || {});
        const result = await ptzService.move(id, body);
        return reply.send(result);
      } catch (err: any) {
        return handlePtzError(err, reply);
      }
    }
  );

  /**
   * POST /api/cameras/:id/ptz/stop
   * Halts active camera movement immediately
   */
  app.post<{ Params: { id: string } }>(
    '/:id/ptz/stop',
    {
      preHandler: [
        authenticate,
        requireCameraPermission('canControlPtz'),
        requireCapability('extended.ptz'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const result = await ptzService.stop(id);
        return reply.send(result);
      } catch (err: any) {
        return handlePtzError(err, reply);
      }
    }
  );

  /**
   * GET /api/cameras/:id/ptz/presets
   * Retrieves list of saved camera presets
   */
  app.get<{ Params: { id: string } }>(
    '/:id/ptz/presets',
    {
      preHandler: [
        authenticate,
        requireCameraPermission('canControlPtz'),
        requireCapability('extended.ptz'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const presets = await ptzService.getPresets(id);
        return reply.send({ presets });
      } catch (err: any) {
        return handlePtzError(err, reply);
      }
    }
  );

  /**
   * POST /api/cameras/:id/ptz/presets/:token/goto
   * Commands camera to navigate to a saved preset position
   */
  app.post<{ Params: { id: string; token: string } }>(
    '/:id/ptz/presets/:token/goto',
    {
      preHandler: [
        authenticate,
        requireCameraPermission('canControlPtz'),
        requireCapability('extended.ptz'),
      ],
    },
    async (request, reply) => {
      const { id, token } = request.params;
      try {
        const result = await ptzService.gotoPreset(id, token);
        return reply.send(result);
      } catch (err: any) {
        return handlePtzError(err, reply);
      }
    }
  );

  /**
   * POST /api/cameras/:id/ptz/presets
   * Saves current camera position as a new preset (Admin only)
   */
  app.post<{ Params: { id: string } }>(
    '/:id/ptz/presets',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.ptz'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const { name } = SetPresetBodySchema.parse(request.body || {});
        const result = await ptzService.setPreset(id, name);
        return reply.status(201).send(result);
      } catch (err: any) {
        return handlePtzError(err, reply);
      }
    }
  );

  /**
   * DELETE /api/cameras/:id/ptz/presets/:token
   * Removes a camera preset (Admin only)
   */
  app.delete<{ Params: { id: string; token: string } }>(
    '/:id/ptz/presets/:token',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.ptz'),
      ],
    },
    async (request, reply) => {
      const { id, token } = request.params;
      try {
        const result = await ptzService.removePreset(id, token);
        return reply.send(result);
      } catch (err: any) {
        return handlePtzError(err, reply);
      }
    }
  );
};

export default ptzRoutes;
