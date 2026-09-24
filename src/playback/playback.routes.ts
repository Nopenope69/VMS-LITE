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
};

export default playbackRoutes;
