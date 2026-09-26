import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { tourService } from './tour.service.js';
import { CreateTourDto } from './tour.types.js';

export const tourRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Authentication preHandler
  const authenticate = async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      // Allow unauthenticated GET in demo/kiosk mode if needed, or enforce token
      if (request.method !== 'GET') {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      }
    }
  };

  // ================= GUARD TOURS =================

  app.get('/tours', async () => {
    const tours = await tourService.listTours();
    return { success: true, tours };
  });

  app.get('/tours/:id', async (request: any, reply) => {
    const tour = await tourService.getTour(request.params.id);
    if (!tour) {
      return reply.status(404).send({ error: 'NotFound', message: 'Tour not found' });
    }
    return { success: true, tour };
  });

  app.post<{ Body: CreateTourDto }>('/tours', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body;
    if (!body || !body.name) {
      return reply.status(400).send({ error: 'ValidationError', message: 'Tour name is required' });
    }

    const created = await tourService.createTour(body);
    return reply.status(201).send({ success: true, tour: created });
  });

  app.put<{ Params: { id: string }; Body: Partial<CreateTourDto> }>(
    '/tours/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const updated = await tourService.updateTour(request.params.id, request.body);
      if (!updated) {
        return reply.status(404).send({ error: 'NotFound', message: 'Tour not found' });
      }
      return { success: true, tour: updated };
    }
  );

  app.delete<{ Params: { id: string } }>('/tours/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const deleted = await tourService.deleteTour(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'NotFound', message: 'Tour not found' });
    }
    return { success: true, message: 'Tour deleted successfully' };
  });

  // ================= CAMERA ZONES =================

  app.get('/camera-zones', async () => {
    const zones = await tourService.listZones();
    return { success: true, zones };
  });

  app.post<{ Body: { name: string; description?: string; cameraIds?: string[] } }>(
    '/camera-zones',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!request.body?.name) {
        return reply.status(400).send({ error: 'ValidationError', message: 'Zone name is required' });
      }
      const zone = await tourService.createZone(request.body);
      return reply.status(201).send({ success: true, zone });
    }
  );

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string; cameraIds?: string[] } }>(
    '/camera-zones/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const updated = await tourService.updateZone(request.params.id, request.body);
      if (!updated) {
        return reply.status(404).send({ error: 'NotFound', message: 'Zone not found' });
      }
      return { success: true, zone: updated };
    }
  );

  app.delete<{ Params: { id: string } }>('/camera-zones/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const deleted = await tourService.deleteZone(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'NotFound', message: 'Zone not found' });
    }
    return { success: true, message: 'Zone deleted successfully' };
  });
};
