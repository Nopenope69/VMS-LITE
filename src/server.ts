import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import { licensingPlugin, LicensingPluginOptions } from './licensing/plugin.js';
import { authRoutes } from './users/auth.routes.js';
import { eventRoutes } from './events/event.routes.js';
import { cameraRoutes } from './cameras/camera.routes.js';

export interface ServerOptions {
  logger?: boolean;
  jwtSecret?: string;
  licensing?: LicensingPluginOptions;
}

export async function createServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = fastify({
    logger: opts.logger ?? (process.env.NODE_ENV !== 'test'),
  });

  // Permissive CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // JWT authentication plugin
  await app.register(fastifyJwt, {
    secret: opts.jwtSecret || process.env.JWT_SECRET || 'dev-secret-basic-vms-super-secure',
    sign: {
      expiresIn: '7d',
    },
  });

  // Standalone Ed25519 Capability Registry plugin
  await app.register(licensingPlugin, opts.licensing ?? {});

  // Healthcheck endpoint
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'basic-vms',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  });

  // Domain route registration
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(eventRoutes, { prefix: '/api' });
  await app.register(cameraRoutes, { prefix: '/api/cameras' });

  return app;
}

export default createServer;
