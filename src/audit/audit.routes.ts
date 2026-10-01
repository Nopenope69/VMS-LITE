import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { auditService } from './audit.service.js';

export const auditRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/audit/logs
   * Admin-only. Retrieves filtered security & operator audit events.
   */
  app.get(
    '/logs',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
    },
    async (request, reply) => {
      try {
        const query = request.query as any;
        const result = await auditService.queryLogs({
          userId: query.userId,
          username: query.username,
          action: query.action,
          since: query.since,
          until: query.until,
          limit: query.limit ? parseInt(query.limit, 10) : 50,
          offset: query.offset ? parseInt(query.offset, 10) : 0,
        });

        return reply.send({
          success: true,
          ...result,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'AuditQueryError',
          message: err.message || 'Failed to query audit logs',
        });
      }
    }
  );
};

export default auditRoutes;
