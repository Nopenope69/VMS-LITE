import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { eventBus } from './event-bus.js';
import { EmitEventInput, EventQueryFilter } from './event.types.js';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { getVisibleCameraIds } from '../users/camera-access.js';
import { parseSiteFilter } from '../cameras/camera.routes.js';
import { cameraService } from '../cameras/camera.service.js';

export const eventRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/events
  fastify.get<{
    Querystring: {
      type?: string;
      cameraId?: string;
      siteId?: string;
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
    let allowed = await getVisibleCameraIds(request.user);

    // ?siteId= restricts to that site's cameras (system events have no camera or site)
    const siteFilter = parseSiteFilter(request.query.siteId);
    if (siteFilter.siteId !== undefined) {
      const siteCameraIds = (await cameraService.listCameras(siteFilter)).map((c) => c.id);
      allowed = allowed ? allowed.filter((id) => siteCameraIds.includes(id)) : siteCameraIds;
    }

    if (allowed) {
      if (filter.cameraId && !allowed.includes(filter.cameraId)) {
        return { events: [], count: 0 };
      }
      filter.cameraIds = allowed;
      // Site-level events (site.offline/online) of the sites those cameras belong to
      if (!filter.cameraId) {
        const visible = new Set(allowed);
        const cameras = await cameraService.listCameras();
        filter.siteIds = [
          ...new Set(cameras.filter((c) => visible.has(c.id) && c.siteId).map((c) => c.siteId as string)),
        ];
        // A selected site with no visible cameras yet still shows its own link events to unrestricted users
        if (siteFilter.siteId && request.user.role !== 'OPERATOR' && !filter.siteIds.includes(siteFilter.siteId)) {
          filter.siteIds.push(siteFilter.siteId);
        }
      }
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
