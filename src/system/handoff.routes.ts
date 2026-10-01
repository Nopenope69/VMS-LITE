import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate } from '../users/rbac.guard.js';
import { handoffService } from './handoff.service.js';

export const handoffRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/system/handoff-report
   * Generates a printable installer acceptance certificate with appliance telemetry & sign-off fields.
   */
  app.get(
    '/handoff-report',
    {
      preHandler: [authenticate],
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
