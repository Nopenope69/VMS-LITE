import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate } from '../users/rbac.guard.js';
import { storageTelemetryService } from './storage-telemetry.service.js';

export const storageTelemetryRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/system/storage/drives
   * Returns list of all detected block devices with real-time SMART & temperature telemetry.
   */
  app.get(
    '/drives',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      try {
        const drives = storageTelemetryService.getCachedDrives();
        const summary = storageTelemetryService.getSummary();
        return reply.send({
          success: true,
          summary,
          drives,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'DriveTelemetryError',
          message: err.message || 'Failed to retrieve storage telemetry',
        });
      }
    }
  );

  /**
   * GET /api/system/storage/removable
   * Returns mounted removable / USB targets suitable for secondary backup/export.
   */
  app.get(
    '/removable',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      try {
        const summary = storageTelemetryService.getSummary();
        return reply.send({
          success: true,
          removableMounts: summary.removableMounts,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'RemovableStorageError',
          message: err.message || 'Failed to query removable storage',
        });
      }
    }
  );
};

export default storageTelemetryRoutes;
