/**
 * Motion Zone Routes (EXT-02)
 *
 * REST API for configuring spatial motion zones and testing coordinate containment.
 * Requires Role.ADMIN for all zone mutations, gated by 'extended.motion_zones' capability.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { requireCapability } from '../licensing/plugin.js';
import { motionZoneService } from './motion-zone.service.js';
import { spatialMotionFilter } from './spatial-motion-filter.js';

const PointSchema = z.object({
  x: z.number().min(0.0, 'X coordinate must be >= 0.0').max(1.0, 'X coordinate must be <= 1.0'),
  y: z.number().min(0.0, 'Y coordinate must be >= 0.0').max(1.0, 'Y coordinate must be <= 1.0'),
});

const CreateZoneSchema = z.object({
  name: z.string().min(1, 'Zone name is required').max(100),
  zoneType: z.enum(['INCLUSION', 'EXCLUSION']).default('INCLUSION'),
  coordinates: z
    .array(PointSchema)
    .min(3, 'Polygon must have at least 3 vertices')
    .max(32, 'Polygon cannot exceed 32 vertices'),
  enabled: z.boolean().optional().default(true),
  color: z.string().max(30).optional(),
});

const UpdateZoneSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  zoneType: z.enum(['INCLUSION', 'EXCLUSION']).optional(),
  coordinates: z
    .array(PointSchema)
    .min(3, 'Polygon must have at least 3 vertices')
    .max(32, 'Polygon cannot exceed 32 vertices')
    .optional(),
  enabled: z.boolean().optional(),
  color: z.string().max(30).optional(),
});

const TestPointSchema = z.object({
  x: z.number().min(0.0, 'X coordinate must be >= 0.0').max(1.0, 'X coordinate must be <= 1.0'),
  y: z.number().min(0.0, 'Y coordinate must be >= 0.0').max(1.0, 'Y coordinate must be <= 1.0'),
});

export const zoneRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/cameras/:id/zones
   * Lists all motion zones for a camera.
   */
  app.get<{ Params: { id: string } }>(
    '/:id/zones',
    {
      preHandler: [
        authenticate,
        requireCapability('extended.motion_zones'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const zones = await motionZoneService.listZones(id);
      return reply.send({
        success: true,
        zones,
      });
    }
  );

  /**
   * POST /api/cameras/:id/zones
   * Creates a new inclusion or exclusion motion zone for a camera.
   * Restricted to ADMIN.
   */
  app.post<{ Params: { id: string } }>(
    '/:id/zones',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.motion_zones'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = CreateZoneSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid motion zone parameters',
          details: parsed.error.errors,
        });
      }

      try {
        const zone = await motionZoneService.createZone(id, parsed.data);
        return reply.status(201).send({
          success: true,
          zone,
        });
      } catch (err: any) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: err.message,
        });
      }
    }
  );

  /**
   * PUT /api/cameras/:id/zones/:zoneId
   * Updates an existing motion zone.
   * Restricted to ADMIN.
   */
  app.put<{ Params: { id: string; zoneId: string } }>(
    '/:id/zones/:zoneId',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.motion_zones'),
      ],
    },
    async (request, reply) => {
      const { zoneId } = request.params;
      const parsed = UpdateZoneSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid motion zone update parameters',
          details: parsed.error.errors,
        });
      }

      try {
        const zone = await motionZoneService.updateZone(zoneId, parsed.data);
        return reply.send({
          success: true,
          zone,
        });
      } catch (err: any) {
        const isNotFound = err.message.includes('not found');
        return reply.status(isNotFound ? 404 : 400).send({
          error: isNotFound ? 'NotFound' : 'BadRequest',
          message: err.message,
        });
      }
    }
  );

  /**
   * DELETE /api/cameras/:id/zones/:zoneId
   * Deletes a motion zone.
   * Restricted to ADMIN.
   */
  app.delete<{ Params: { id: string; zoneId: string } }>(
    '/:id/zones/:zoneId',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.motion_zones'),
      ],
    },
    async (request, reply) => {
      const { zoneId } = request.params;
      try {
        await motionZoneService.deleteZone(zoneId);
        return reply.send({
          success: true,
          message: 'Motion zone deleted successfully',
        });
      } catch (err: any) {
        const isNotFound = err.message.includes('not found');
        return reply.status(isNotFound ? 404 : 400).send({
          error: isNotFound ? 'NotFound' : 'BadRequest',
          message: err.message,
        });
      }
    }
  );

  /**
   * POST /api/cameras/:id/zones/test
   * Tests a point against configured zones and returns truth table evaluation.
   */
  app.post<{ Params: { id: string } }>(
    '/:id/zones/test',
    {
      preHandler: [
        authenticate,
        requireCapability('extended.motion_zones'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = TestPointSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid coordinates for point test. x and y must be numbers between 0.0 and 1.0',
          details: parsed.error.errors,
        });
      }

      const zones = await motionZoneService.listZones(id);
      const result = spatialMotionFilter.evaluateMotionPoint(parsed.data, zones);

      return reply.send({
        success: true,
        point: parsed.data,
        result,
      });
    }
  );
};

export default zoneRoutes;
