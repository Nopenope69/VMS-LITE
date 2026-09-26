import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const pingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/health/ping
   * Lightweight probe for measuring client-to-server RTT and estimating WAN link stability.
   */
  app.get('/ping', async (_request, reply) => {
    return reply.header('Cache-Control', 'no-store').send({
      pong: true,
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
    });
  });
};

export default pingRoutes;
