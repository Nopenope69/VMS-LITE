import { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { getVisibleCameraIds } from '../users/camera-access.js';
import { auditService } from '../audit/audit.service.js';
import { SiteError, SiteInputSchema, SiteUpdateSchema, siteService } from './site.service.js';

function sendError(reply: FastifyReply, err: any) {
  if (err instanceof SiteError) {
    return reply.status(err.statusCode).send({ error: err.name, message: err.message });
  }
  if (err?.name === 'ZodError') {
    return reply.status(400).send({ error: 'ValidationError', message: 'Invalid site payload', details: err.errors });
  }
  throw err;
}

export const siteRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /api/sites - sites with camera counts and live health (operators: their cameras only)
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const visible = await getVisibleCameraIds(request.user);
    const sites = await siteService.listSummaries(visible);
    return { count: sites.length, sites };
  });

  // POST /api/sites (Admin)
  app.post('/', { preHandler: [requireRole([Role.ADMIN])] }, async (request, reply) => {
    try {
      const site = await siteService.createSite(SiteInputSchema.parse(request.body ?? {}));
      await auditService.log({
        action: 'SITE_CREATED',
        userId: request.user.id,
        username: request.user.username,
        ipAddress: request.ip,
        resource: `site:${site.id}`,
        metadata: { name: site.name },
      });
      return reply.status(201).send(site);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // PATCH /api/sites/:id (Admin)
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole([Role.ADMIN])] },
    async (request, reply) => {
      try {
        const site = await siteService.updateSite(request.params.id, SiteUpdateSchema.parse(request.body ?? {}));
        await auditService.log({
          action: 'SITE_UPDATED',
          userId: request.user.id,
          username: request.user.username,
          ipAddress: request.ip,
          resource: `site:${site.id}`,
          metadata: { name: site.name },
        });
        return site;
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // DELETE /api/sites/:id (Admin) - only when the site has no cameras
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole([Role.ADMIN])] },
    async (request, reply) => {
      try {
        const site = await siteService.deleteSite(request.params.id);
        await auditService.log({
          action: 'SITE_DELETED',
          userId: request.user.id,
          username: request.user.username,
          ipAddress: request.ip,
          resource: `site:${site.id}`,
          metadata: { name: site.name },
        });
        return { success: true };
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );
};

export default siteRoutes;
