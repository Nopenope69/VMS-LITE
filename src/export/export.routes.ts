import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import { authenticate, requireCameraPermission } from '../users/rbac.guard.js';
import { requireCapability } from '../licensing/plugin.js';
import { exportService } from './export.service.js';

const CreateExportBodySchema = z.object({
  cameraId: z.string().uuid(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  exportMode: z.enum(['STREAM_COPY', 'TRANSCODED_OSD']).optional(),
  includeOsd: z.boolean().optional(),
});

export const exportRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/recordings/export
   * Initiates a clip export job (Stream Copy default or Transcoded OSD Derivative)
   */
  app.post(
    '/export',
    {
      preHandler: [
        authenticate,
        requireCameraPermission('canExportClips'),
        requireCapability('extended.clip_export'),
      ],
    },
    async (request, reply) => {
      const parsed = CreateExportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid export request body',
          details: parsed.error.errors,
        });
      }

      try {
        const job = await exportService.createExportJob({
          ...parsed.data,
          userId: (request as any).user?.id,
        });

        return reply.status(202).send({
          success: true,
          job,
        });
      } catch (err: any) {
        if (err.code === 'INCOMPATIBLE_SEGMENTS') {
          return reply.status(400).send({
            error: 'INCOMPATIBLE_SEGMENTS',
            message: err.message,
            job: err.job,
          });
        }
        if (err.code === 'NO_RECORDINGS_FOUND') {
          return reply.status(404).send({
            error: 'NO_RECORDINGS_FOUND',
            message: err.message,
            job: err.job,
          });
        }
        return reply.status(500).send({
          error: 'ExportFailed',
          message: err.message || 'Failed to initialize export job',
        });
      }
    }
  );

  /**
   * GET /api/recordings/export/:id
   * Checks status and metadata (SHA-256 integrity checksum, progress) of an export job
   */
  app.get<{ Params: { id: string } }>(
    '/export/:id',
    {
      preHandler: [
        authenticate,
        requireCapability('extended.clip_export'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const job = await exportService.getExportJob(id);

      if (!job) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Export job ${id} not found`,
        });
      }

      return reply.send({
        success: true,
        job,
      });
    }
  );

  /**
   * GET /api/recordings/export/:id/download
   * Streams the exported MP4 file with SHA-256 integrity checksum header
   */
  app.get<{ Params: { id: string } }>(
    '/export/:id/download',
    {
      preHandler: [
        authenticate,
        requireCapability('extended.clip_export'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const details = await exportService.getExportFileDetails(id);

      if (!details) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Export file for job ${id} is not available for download`,
        });
      }

      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Disposition', `attachment; filename="${details.fileName}"`);
      if (details.sha256) {
        reply.header('X-Checksum-SHA256', details.sha256);
      }

      const stream = createReadStream(details.filePath);
      return reply.send(stream);
    }
  );
};
