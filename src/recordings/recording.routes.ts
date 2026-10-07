import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { recordingEngine } from './recording-engine.js';
import {
  RecordingQuerySchema,
  SetCameraScheduleSchema,
} from './recording.types.js';

export const recordingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
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
        const metrics = await recordingEngine.getStorageStatus();
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
        const result = await recordingEngine.runStorageCleanup();
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
      const schedule = await recordingEngine.getSchedule(cameraId);
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
        const schedule = await recordingEngine.setSchedule(cameraId, body.mode, body.windows);
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
        if (err.name === 'CameraNotFoundError') {
          return reply.status(404).send({ error: 'NotFound', message: err.message });
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
   * Queries recorded segments with optional camera, date, and limit filtering (REC-01, T-03-02)
   */
  app.get(
    '/',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const query = RecordingQuerySchema.parse(request.query);
        const recordings = await recordingEngine.queryRecordings(query);
        return reply.send({
          count: recordings.length,
          recordings,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid recording query parameters',
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
   * GET /api/recordings/motion-buffer/status
   * Returns per-camera buffered segment counts and active incident timers (MVP-09)
   */
  app.get<{ Querystring: { cameraId?: string } }>(
    '/motion-buffer/status',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { cameraId } = request.query;
        const status = await recordingEngine.getMotionBufferStatus(cameraId);
        return reply.send({
          success: true,
          ...status,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'MotionBufferStatusFailed',
          message: err.message || 'Failed to retrieve motion buffer status',
        });
      }
    }
  );

  /**
   * GET /api/recordings/:id
   * Retrieves single recording metadata by UUID (REC-01, T-03-02)
   */
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const recording = await recordingEngine.getRecordingById(id);

      if (!recording) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Recording with id ${id} not found`,
        });
      }

      return reply.send(recording);
    }
  );
};

export default recordingRoutes;
