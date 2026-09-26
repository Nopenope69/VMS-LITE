import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { emapService } from './emap.service.js';

const MarkerSchema = z.object({
  cameraId: z.string().min(1),
  cameraName: z.string().optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  angle: z.number().min(0).max(360),
  fovDegrees: z.number().min(10).max(180).optional(),
});

const CreatePlanSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  widthMeters: z.number().positive().optional(),
  heightMeters: z.number().positive().optional(),
  markers: z.array(MarkerSchema).optional(),
});

const UpdateMarkersSchema = z.object({
  markers: z.array(MarkerSchema),
});

export const emapRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // List all floor plans (Viewers, Operators, Admins)
  app.get('/emap/plans', { preHandler: [authenticate] }, async () => {
    const plans = emapService.listFloorPlans();
    return { success: true, plans };
  });

  // Get specific floor plan by ID
  app.get<{ Params: { id: string } }>(
    '/emap/plans/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const plan = emapService.getFloorPlan(request.params.id);
      if (!plan) {
        return reply.status(404).send({ error: 'NotFound', message: 'Floor plan not found' });
      }
      return { success: true, plan };
    }
  );

  // Create new floor plan (Admin only)
  app.post(
    '/emap/plans',
    { preHandler: [authenticate, requireRole([Role.ADMIN])] },
    async (request, reply) => {
      const parsed = CreatePlanSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid floor plan data',
          details: parsed.error.errors,
        });
      }

      const plan = emapService.createFloorPlan(parsed.data);
      return reply.status(201).send({ success: true, plan });
    }
  );

  // Update camera marker positions (Operators and Admins)
  app.put<{ Params: { id: string } }>(
    '/emap/plans/:id/markers',
    { preHandler: [authenticate, requireRole([Role.ADMIN, Role.OPERATOR])] },
    async (request, reply) => {
      const parsed = UpdateMarkersSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid marker coordinate data',
          details: parsed.error.errors,
        });
      }

      const updated = emapService.updateMarkers(request.params.id, parsed.data.markers);
      if (!updated) {
        return reply.status(404).send({ error: 'NotFound', message: 'Floor plan not found' });
      }

      return { success: true, plan: updated };
    }
  );

  // Delete floor plan (Admin only)
  app.delete<{ Params: { id: string } }>(
    '/emap/plans/:id',
    { preHandler: [authenticate, requireRole([Role.ADMIN])] },
    async (request, reply) => {
      const ok = emapService.deleteFloorPlan(request.params.id);
      if (!ok) {
        return reply.status(404).send({ error: 'NotFound', message: 'Floor plan not found' });
      }
      return { success: true, message: 'Floor plan deleted' };
    }
  );
};

export default emapRoutes;
