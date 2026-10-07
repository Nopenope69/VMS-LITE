import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { ADMIN_ONLY, CameraAccess, cameraScopeOf } from '../users/camera-scope.js';
import { recordingEngine as defaultRecordingEngine, RecordingEngine } from './recording-engine.js';
import {
  RecordingQuerySchema,
  SetCameraScheduleSchema,
} from './recording.types.js';

export const recordingRoutes: FastifyPluginAsync<{ recordingEngine?: RecordingEngine }> = async (app: FastifyInstance, opts) => {
  const recordingEngine = opts.recordingEngine ?? defaultRecordingEngine;
  const RECORDING_OWNER: CameraAccess = {
    resource: async (request) =>
      (await recordingEngine.getRecordingById((request.params as { id: string }).id))?.cameraId ?? null,
    right: 'canViewPlayback',
  };
  /**
   * GET /api/recordings/storage
   * Returns current storage utilization metrics and thresholds (REC-04)
   */
  app.get(
    '/storage',
    {
      preHandler: [authenticate],
      config: { cameraAccess: { none: 'appliance-wide storage metrics' } },
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
      config: { cameraAccess: ADMIN_ONLY },
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
      config: { cameraAccess: { camera: 'params.cameraId', right: 'view' } },
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
      config: { cameraAccess: ADMIN_ONLY },
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
      config: { cameraAccess: { list: 'canViewPlayback' } },
    },
    async (request, reply) => {
      try {
        const query = RecordingQuerySchema.parse(request.query);
        const scope = await cameraScopeOf(request);
        if (query.cameraId && !scope.can(query.cameraId, 'canViewPlayback')) {
          return reply.status(403).send({ error: 'Forbidden', message: `No playback access to camera '${query.cameraId}'` });
        }
        const cameraIds = scope.cameraIds('canViewPlayback') ?? undefined;
        const recordings = await recordingEngine.queryRecordings({ ...query, cameraIds });
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
      config: { cameraAccess: { list: 'view' } },
    },
    async (request, reply) => {
      try {
        const { cameraId } = request.query;
        const scope = await cameraScopeOf(request);
        if (cameraId && !scope.can(cameraId, 'view')) {
          return reply.status(403).send({ error: 'Forbidden', message: `No access to camera '${cameraId}'` });
        }
        const status = await recordingEngine.getMotionBufferStatus(cameraId);
        const cameras = status.cameras.filter((c) => scope.can(c.cameraId, 'view'));
        return reply.send({
          success: true,
          ...status,
          totalBufferedSegments: cameras.reduce((sum, c) => sum + c.bufferedSegmentsCount, 0),
          totalBufferedBytes: cameras.reduce((sum, c) => sum + c.bufferedBytes, 0),
          activeIncidentsCount: cameras.filter((c) => c.incidentActive).length,
          cameras,
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
      config: { cameraAccess: RECORDING_OWNER },
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
