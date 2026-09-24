import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { cameraService, LicenseLimitExceededError } from './camera.service.js';
import { ManualCameraSchema, OnboardCameraSchema } from './camera.types.js';

export const cameraRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/cameras/discover
   * Scans local subnet for ONVIF IP cameras (Admin only)
   */
  app.post(
    '/discover',
    {
      preHandler: [requireRole([Role.ADMIN])],
    },
    async (request, reply) => {
      const body = (request.body as { timeoutMs?: number }) || {};
      const timeoutMs = body.timeoutMs ?? 3000;

      const devices = await cameraService.discover(timeoutMs);
      return reply.send({
        count: devices.length,
        devices,
      });
    }
  );

  /**
   * POST /api/cameras
   * Onboards an ONVIF or manual RTSP camera with license limit enforcement (Admin only)
   */
  app.post(
    '/',
    {
      preHandler: [requireRole([Role.ADMIN])],
    },
    async (request, reply) => {
      const body = request.body as any;
      const cameraLimit = request.server.capabilities.getCameraLimit();

      try {
        if (body.rtspUrl) {
          const manualInput = ManualCameraSchema.parse(body);
          const camera = await cameraService.onboardManualCamera(manualInput, cameraLimit);
          return reply.status(201).send(camera);
        } else {
          const onvifInput = OnboardCameraSchema.parse(body);
          const camera = await cameraService.onboardOnvifCamera(onvifInput, cameraLimit);
          return reply.status(201).send(camera);
        }
      } catch (err: any) {
        if (err instanceof LicenseLimitExceededError) {
          return reply.status(403).send({
            error: 'LicenseLimitExceeded',
            message: err.message,
            cameraLimit: err.cameraLimit,
          });
        }
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid camera payload',
            details: err.errors,
          });
        }
        return reply.status(400).send({
          error: 'OnboardingFailed',
          message: err.message || 'Failed to onboard camera',
        });
      }
    }
  );

  /**
   * GET /api/cameras
   * Lists all onboarded cameras (Admin or Viewer)
   */
  app.get(
    '/',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      const cameras = await cameraService.listCameras();
      return reply.send({
        count: cameras.length,
        cameras,
      });
    }
  );

  /**
   * GET /api/cameras/:id
   * Retrieves single camera details (Admin or Viewer)
   */
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const camera = await cameraService.getCameraById(id);

      if (!camera) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Camera with id ${id} not found`,
        });
      }

      return reply.send(camera);
    }
  );

  /**
   * DELETE /api/cameras/:id
   * Removes camera and tears down MediaMTX path (Admin only)
   */
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [requireRole([Role.ADMIN])],
    },
    async (request, reply) => {
      const { id } = request.params;
      const success = await cameraService.removeCamera(id);

      if (!success) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Camera with id ${id} not found`,
        });
      }

      return reply.send({
        success: true,
        message: 'Camera deleted and stream path removed',
      });
    }
  );
};

export default cameraRoutes;
