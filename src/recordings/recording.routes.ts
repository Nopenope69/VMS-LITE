import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { recordingService } from './recording.service.js';
import { recordingScheduler } from './recording-scheduler.service.js';
import { storageManager } from './storage-manager.service.js';
import {
  RecordingQuerySchema,
  SegmentCompleteWebhookSchema,
  SetCameraScheduleSchema,
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
   * GET /api/recordings/storage
   * Returns current storage utilization metrics and thresholds (REC-04)
   */
  app.get(
    '/storage',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      try {
        const metrics = await storageManager.getStorageMetrics();
        return reply.send({
          success: true,
          metrics,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'StorageMetricsFailed',
          message: err.message || 'Failed to retrieve storage metrics',
        });
      }
    }
  );

  /**
   * POST /api/recordings/storage/cleanup
   * Triggers manual disk check and FIFO rollover if threshold exceeded (Admin only, REC-05, T-03-05)
   */
  app.post(
    '/storage/cleanup',
    {
      preHandler: [authenticate, requireRole(Role.ADMIN)],
    },
    async (_request, reply) => {
      try {
        const result = await storageManager.checkStorage();
        return reply.send({
          success: true,
          ...result,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'CleanupFailed',
          message: err.message || 'Failed to run storage cleanup',
        });
      }
    }
  );

  /**
   * GET /api/recordings/schedules/:cameraId
   * Retrieves recording schedule configuration for a camera (Admin & Viewer, REC-02)
   */
  app.get<{ Params: { cameraId: string } }>(
    '/schedules/:cameraId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { cameraId } = request.params;
      const schedule = await recordingScheduler.getCameraSchedule(cameraId);
      return reply.send({
        success: true,
        cameraId,
        schedule,
      });
    }
  );

  /**
   * POST /api/recordings/schedules/:cameraId
   * Sets recording schedule mode and windows for a camera (Admin only, REC-02, T-03-05)
   */
  app.post<{ Params: { cameraId: string } }>(
    '/schedules/:cameraId',
    {
      preHandler: [authenticate, requireRole(Role.ADMIN)],
    },
    async (request, reply) => {
      const { cameraId } = request.params;
      try {
        const body = SetCameraScheduleSchema.parse(request.body);
        await recordingScheduler.setCameraSchedule(cameraId, body.mode, body.windows);
        const schedule = await recordingScheduler.getCameraSchedule(cameraId);
        return reply.send({
          success: true,
          cameraId,
          schedule,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid schedule payload',
            details: err.errors,
          });
        }
        return reply.status(500).send({
          error: 'ScheduleUpdateFailed',
          message: err.message || 'Failed to update camera schedule',
        });
      }
    }
  );

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
