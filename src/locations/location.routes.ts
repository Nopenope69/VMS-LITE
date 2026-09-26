import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../users/rbac.guard.js';
import { locationService } from './location.service.js';

export const LocationSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().default(''),
  icon: z.string().optional(),
  cameraIds: z.array(z.string()).default([]),
});

export const ZoneSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  color: z.string().default('#4fc3f7'),
  icon: z.string().optional(),
  cameraIds: z.array(z.string()).default([]),
});

export const locationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/v1/locations
   * Lists all locations and operational zones.
   */
  app.get('/', async (_request, reply) => {
    return reply.send({
      success: true,
      locations: locationService.getLocations(),
      zones: locationService.getZones(),
    });
  });

  /**
   * POST /api/v1/locations
   * Create new custom branch location.
   */
  app.post(
    '/',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const parsed = LocationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.issues });
      }
      const created = locationService.createLocation(parsed.data);
      return reply.status(201).send({ success: true, location: created });
    }
  );

  /**
   * PUT /api/v1/locations/:id
   * Update location.
   */
  app.put<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = LocationSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.issues });
      }
      try {
        const updated = locationService.updateLocation(id, parsed.data);
        return reply.send({ success: true, location: updated });
      } catch (err: any) {
        return reply.status(404).send({ error: 'NotFound', message: err.message });
      }
    }
  );

  /**
   * DELETE /api/v1/locations/:id
   * Delete location.
   */
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const ok = locationService.deleteLocation(id);
      if (!ok) {
        return reply.status(404).send({ error: 'NotFound', message: `Location ${id} not found` });
      }
      return reply.send({ success: true, message: 'Location deleted' });
    }
  );

  /**
   * GET /api/v1/locations/zones
   * List all operational zones.
   */
  app.get('/zones', async (_request, reply) => {
    return reply.send({
      success: true,
      zones: locationService.getZones(),
    });
  });

  /**
   * POST /api/v1/locations/zones
   * Create new operational zone.
   */
  app.post(
    '/zones',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const parsed = ZoneSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.issues });
      }
      const created = locationService.createZone(parsed.data);
      return reply.status(201).send({ success: true, zone: created });
    }
  );

  /**
   * PUT /api/v1/locations/zones/:id
   * Update operational zone.
   */
  app.put<{ Params: { id: string } }>(
    '/zones/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = ZoneSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.issues });
      }
      try {
        const updated = locationService.updateZone(id, parsed.data);
        return reply.send({ success: true, zone: updated });
      } catch (err: any) {
        return reply.status(404).send({ error: 'NotFound', message: err.message });
      }
    }
  );

  /**
   * DELETE /api/v1/locations/zones/:id
   * Delete operational zone.
   */
  app.delete<{ Params: { id: string } }>(
    '/zones/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const ok = locationService.deleteZone(id);
      if (!ok) {
        return reply.status(404).send({ error: 'NotFound', message: `Zone ${id} not found` });
      }
      return reply.send({ success: true, message: 'Zone deleted' });
    }
  );

  /**
   * POST /api/v1/locations/reset
   * Reset locations and zones to defaults.
   */
  app.post(
    '/reset',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      const reset = locationService.resetToDefaults();
      return reply.send({ success: true, ...reset });
    }
  );
};

export default locationRoutes;
