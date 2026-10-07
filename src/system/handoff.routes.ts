import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { handoffService } from './handoff.service.js';
import { ADMIN_ONLY } from '../users/camera-scope.js';

export const handoffRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/system/handoff-report
   * Generates a printable installer acceptance certificate with appliance telemetry & sign-off fields.
   */
  app.get(
    '/handoff-report',
    {
      // Lists every camera: an installer (admin) document
      preHandler: [authenticate, requireRole('ADMIN')],
      config: { cameraAccess: ADMIN_ONLY },
    },
    async (request, reply) => {
      try {
        const query = request.query as any;
        const html = await handoffService.generateHtmlReport({
          siteName: query.siteName,
          technicianName: query.technicianName,
          clientName: query.clientName,
          installerNotes: query.installerNotes,
        });

        return reply
          .header('Content-Type', 'text/html; charset=utf-8')
          .send(html);
      } catch (err: any) {
        return reply.status(500).send({
          error: 'HandoffReportError',
          message: err.message || 'Failed to generate handoff certificate',
        });
      }
    }
  );
};

export default handoffRoutes;
