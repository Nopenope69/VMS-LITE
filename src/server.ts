import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import { licensingPlugin, LicensingPluginOptions } from './licensing/plugin.js';
import { authRoutes } from './users/auth.routes.js';
import { eventRoutes } from './events/event.routes.js';
import { cameraRoutes } from './cameras/camera.routes.js';
import { recordingRoutes } from './recordings/recording.routes.js';
import { streamingRoutes } from './streaming/streaming.routes.js';
import { playbackRoutes } from './playback/playback.routes.js';
import { webSocketFeedService, WebSocketFeedService } from './events/websocket-feed.service.js';
import { onvifEventListenerService as defaultOnvifEvents, OnvifEventListenerService } from './events/onvif-events.service.js';
import { recordingEngine as defaultRecordingEngine, RecordingEngine } from './recordings/recording-engine.js';

export interface ServerOptions {
  logger?: boolean;
  jwtSecret?: string;
  licensing?: LicensingPluginOptions;
  wsFeedService?: WebSocketFeedService;
  recordingEngine?: RecordingEngine;
  onvifEventsService?: OnvifEventListenerService;
}

export async function createServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = fastify({
    logger: opts.logger ?? (process.env.NODE_ENV !== 'test'),
  });

  const wsFeed = opts.wsFeedService || webSocketFeedService;
  const engine = opts.recordingEngine || defaultRecordingEngine;
  const onvifEvents = opts.onvifEventsService || defaultOnvifEvents;

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
  await app.register(recordingRoutes, { prefix: '/api/recordings' });
  await app.register(streamingRoutes, { prefix: '/api/streaming' });
  await app.register(playbackRoutes, { prefix: '/api/playback' });

  // Attach background services when server is ready
  app.addHook('onReady', async () => {
    await engine.start();
    onvifEvents.start();
    wsFeed.attach(app.server, async (token: string) => {
      return app.jwt.verify(token);
    });
  });

  // Clean up on server close
  app.addHook('onClose', async () => {
    await engine.stop();
    onvifEvents.stop();
    wsFeed.close();
  });

  return app;
}

export default createServer;
