/**
 * Camera Health Routes (EXT-06)
 *
 * REST API for camera health diagnostics and telemetry.
 * Defined relative to the '/api/cameras' registration prefix.
 *
 * Protected by:
 * - Authentication (JWT)
 * - Role-Based Access Control: Role.ADMIN, Role.OPERATOR (T-12-02)
 * - Capability: 'extended.camera_health'
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { cameraScopeOf } from '../users/camera-scope.js';
import { requireCapability } from '../licensing/plugin.js';
import { cameraHealthService } from './camera-health.service.js';

export const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/cameras/health
   * Returns health summary and telemetry map for all cameras.
   */
  app.get(
    '/health',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN, Role.OPERATOR]),
        requireCapability('extended.camera_health'),
      ],
      config: { cameraAccess: { list: 'view' } },
    },
    async (request, reply) => {
      const scope = await cameraScopeOf(request);
      const summary = cameraHealthService.getAllTelemetry((cameraId) => scope.can(cameraId, 'view'));
      return reply.code(200).send(summary);
    }
  );

  /**
   * GET /api/cameras/:id/health
   * Returns detailed health telemetry for a specific camera.
   */
  app.get<{ Params: { id: string } }>(
    '/:id/health',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN, Role.OPERATOR]),
        requireCapability('extended.camera_health'),
      ],
      config: { cameraAccess: { camera: 'params.id', right: 'view' } },
    },
    async (request, reply) => {
      const { id } = request.params;
      const telemetry = cameraHealthService.getTelemetry(id);

      if (!telemetry) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Camera health telemetry not found for ID '${id}'`,
        });
      }

      return reply.code(200).send(telemetry);
    }
  );
};

export default healthRoutes;
