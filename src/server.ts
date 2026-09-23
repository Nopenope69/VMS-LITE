import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

export interface ServerOptions {
  logger?: boolean;
}

export async function createServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = fastify({
    logger: opts.logger ?? (process.env.NODE_ENV !== 'test'),
  });

  // Register permissive CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Healthcheck endpoint
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'basic-vms',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

export default createServer;
