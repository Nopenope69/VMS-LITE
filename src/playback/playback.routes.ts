import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../users/rbac.guard.js';
import { recordingEngine } from '../recordings/recording-engine.js';
import { TimelineQuerySchema } from './playback.types.js';

const StreamQuerySchema = z.object({
  cameraId: z.string().min(1, 'cameraId is required'),
  startTime: z.string().datetime('startTime must be valid ISO datetime'),
  duration: z.coerce.number().positive().max(3600).default(300),
});

export const playbackRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/playback/timeline
   * Returns recorded video intervals for a camera within a 24-hour window (PLAY-01).
   */
  app.get(
    '/timeline',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const query = TimelineQuerySchema.parse(request.query);
        const timeline = await recordingEngine.getTimelineSpans(query);
        return reply.send({
          success: true,
          ...timeline,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid timeline query parameters',
            details: err.errors,
          });
        }
        return reply.status(500).send({
          error: 'TimelineQueryError',
          message: err.message || 'Failed to retrieve timeline spans',
        });
      }
    }
  );

  /**
   * GET /api/playback/stream
   * Resolves MediaMTX fMP4 playback streaming URL for camera and timestamp (PLAY-03).
   */
  app.get(
    '/stream',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const query = StreamQuerySchema.parse(request.query);
        const streamInfo = await recordingEngine.getPlaybackStreamUrl(
          query.cameraId,
          query.startTime,
          query.duration
        );
        return reply.send({
          success: true,
          ...streamInfo,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid stream query parameters',
            details: err.errors,
          });
        }
        if (err.message?.includes('not found')) {
          return reply.status(404).send({
            error: 'NotFound',
            message: err.message,
          });
        }
        return reply.status(500).send({
          error: 'PlaybackStreamError',
          message: err.message || 'Failed to resolve playback stream URL',
        });
      }
    }
  );

  /**
   * GET /api/playback/timeline-multi
   * Returns recorded video intervals for multiple cameras in parallel.
   */
  app.get(
    '/timeline-multi',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { cameraIds, date, startTime, endTime } = request.query as {
          cameraIds?: string;
          date?: string;
          startTime?: string;
          endTime?: string;
        };

        if (!cameraIds) {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'cameraIds query parameter is required (comma-separated)',
          });
        }

        const ids = cameraIds.split(',').map((id) => id.trim()).filter(Boolean);
        const results: Record<string, any> = {};

        await Promise.all(
          ids.map(async (cameraId) => {
            try {
              const timeline = await recordingEngine.getTimelineSpans({
                cameraId,
                date,
                startTime,
                endTime,
              });
              results[cameraId] = timeline;
            } catch (err: any) {
              results[cameraId] = {
                cameraId,
                date: date || '',
                playbackBaseUrl: '',
                totalDurationSeconds: 0,
                spans: [],
                error: err.message,
              };
            }
          })
        );

        return reply.send({
          success: true,
          date: date || '',
          timelines: results,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'TimelineMultiError',
          message: err.message || 'Failed to retrieve multi-camera timelines',
        });
      }
    }
  );

  /**
   * GET /api/playback/sync-streams
   * Resolves MediaMTX fMP4 playback streaming URLs for multiple cameras at a specific timestamp.
   */
  app.get(
    '/sync-streams',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { cameraIds, startTime, duration } = request.query as {
          cameraIds?: string;
          startTime?: string;
          duration?: string;
        };

        if (!cameraIds || !startTime) {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'cameraIds and startTime query parameters are required',
          });
        }

        const dur = duration ? Math.min(Math.max(parseInt(duration, 10), 10), 3600) : 300;
        const ids = cameraIds.split(',').map((id) => id.trim()).filter(Boolean);
        const streams: Record<string, any> = {};

        await Promise.all(
          ids.map(async (cameraId) => {
            try {
              const streamInfo = await recordingEngine.getPlaybackStreamUrl(cameraId, startTime, dur);
              streams[cameraId] = {
                available: true,
                ...streamInfo,
              };
            } catch (err: any) {
              streams[cameraId] = {
                available: false,
                fmp4StreamUrl: null,
                error: err.message,
              };
            }
          })
        );

        return reply.send({
          success: true,
          startTime,
          duration: dur,
          streams,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'SyncStreamsError',
          message: err.message || 'Failed to resolve multi-camera playback streams',
        });
      }
    }
  );
};

export default playbackRoutes;
