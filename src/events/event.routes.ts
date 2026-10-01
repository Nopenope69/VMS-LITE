import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { eventBus } from './event-bus.js';
import { EmitEventInput, EventQueryFilter } from './event.types.js';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { getVisibleCameraIds } from '../users/camera-access.js';

export const eventRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/events
  fastify.get<{
    Querystring: {
      type?: string;
      cameraId?: string;
      since?: string;
      limit?: string;
      offset?: string;
    };
  }>('/events', { preHandler: [authenticate] }, async (request) => {
    const limit = parseInt(request.query.limit ?? '', 10);
    const offset = parseInt(request.query.offset ?? '', 10);
    const filter: EventQueryFilter = {
      type: request.query.type,
      cameraId: request.query.cameraId,
      since: request.query.since,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    };

    // Operators only see events of cameras they are granted
    const visible = await getVisibleCameraIds(request.user);
    if (visible) {
      if (filter.cameraId && !visible.includes(filter.cameraId)) {
        return { events: [], count: 0 };
      }
      filter.cameraIds = visible;
    }

    const events = await eventBus.queryEvents(filter);
    return {
      events,
      count: events.length,
    };
  });

  // POST /api/events/emit (Admin or system internal)
  fastify.post<{
    Body: EmitEventInput;
  }>('/events/emit', { preHandler: [requireRole([Role.ADMIN])] }, async (request, reply) => {
    const { type, source, severity, metadata, cameraId, timestamp } = request.body || {};

    if (!type || !source) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Event type and source are required',
      });
    }

    const event = await eventBus.emitEvent({
      type,
      source,
      severity,
      metadata,
      cameraId,
      timestamp,
    });

    return reply.status(201).send({
      event,
    });
  });
};
