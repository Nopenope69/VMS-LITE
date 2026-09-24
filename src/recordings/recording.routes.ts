import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate } from '../users/rbac.guard.js';
import { recordingService } from './recording.service.js';
import {
  RecordingQuerySchema,
  SegmentCompleteWebhookSchema,
} from './recording.types.js';

export const recordingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/recordings/segments
   * Webhook endpoint called by MediaMTX runOnRecordSegmentComplete hook (REC-03)
   */
  app.post('/segments', async (request, reply) => {
    try {
      const payload = SegmentCompleteWebhookSchema.parse(request.body);
      const recording = await recordingService.ingestSegment(payload);
      return reply.status(201).send({
        success: true,
        recording,
      });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid segment hook payload',
          details: err.errors,
        });
      }
      return reply.status(500).send({
        error: 'IngestionFailed',
        message: err.message || 'Failed to ingest segment',
      });
    }
  });

  /**
   * GET /api/recordings
   * Queries cataloged recording chunks with camera and time filters (Admin & Viewer)
   */
  app.get(
    '/',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const query = RecordingQuerySchema.parse(request.query);
        const recordings = await recordingService.queryRecordings(query);
        return reply.send({
          count: recordings.length,
          recordings,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid query parameters',
            details: err.errors,
          });
        }
        return reply.status(500).send({
          error: 'QueryFailed',
          message: err.message || 'Failed to query recordings',
        });
      }
    }
  );

  /**
   * GET /api/recordings/:id
   * Retrieves single recording chunk metadata (Admin & Viewer)
   */
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const recording = await recordingService.getRecordingById(id);

      if (!recording) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Recording segment with id ${id} not found`,
        });
      }

      return reply.send(recording);
    }
  );
};

export default recordingRoutes;
