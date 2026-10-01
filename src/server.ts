import fs from 'fs';
import path from 'path';
import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { licensingPlugin, LicensingPluginOptions } from './licensing/plugin.js';
import { authRoutes } from './users/auth.routes.js';
import { eventRoutes } from './events/event.routes.js';
import { cameraRoutes } from './cameras/camera.routes.js';
import { recordingRoutes } from './recordings/recording.routes.js';
import { streamingRoutes } from './streaming/streaming.routes.js';
import { playbackRoutes } from './playback/playback.routes.js';
import { ptzRoutes } from './ptz/ptz.routes.js';
import { ptzService } from './ptz/ptz.service.js';
import { exportRoutes } from './export/export.routes.js';
import { bookmarkRoutes } from './bookmarks/bookmark.routes.js';
import { zoneRoutes } from './zones/zone.routes.js';
import { healthRoutes } from './health/health.routes.js';
import { cameraHealthService } from './health/camera-health.service.js';
import { notificationRoutes } from './notifications/notification.routes.js';
import { notificationService } from './notifications/notification-dispatcher.service.js';
import { smtpDispatcherService } from './notifications/smtp-dispatcher.service.js';
import { webhookRoutes } from './webhooks/webhook.routes.js';
import { settingsRoutes } from './settings/settings.routes.js';
import { systemRoutes } from './system/system.routes.js';
import { shutdownRoutes } from './system/shutdown.routes.js';
import { backupRoutes } from './system/backup.routes.js';
import { auditRoutes } from './audit/audit.routes.js';
import { storageTelemetryRoutes } from './system/storage-telemetry.routes.js';
import { storageTelemetryService } from './system/storage-telemetry.service.js';
import { registerProcessSignalHandlers } from './system/shutdown.service.js';
import { webhookDispatcherService } from './webhooks/webhook-dispatcher.service.js';
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

  // Global Error Handler for Fail-Loud Architecture (503 on database unavailability)
  app.setErrorHandler((error: any, request, reply) => {
    if (
      error.code === 'DATABASE_UNAVAILABLE' ||
      error.code === 'P1001' ||
      error.code === 'P1002' ||
      error.code === 'P1003' ||
      error.name === 'PrismaClientInitializationError' ||
      error.name === 'PrismaClientRustPanicError' ||
      (typeof error.message === 'string' &&
        (error.message.includes("Can't reach database server") ||
         error.message.includes('Connection terminated unexpectedly') ||
         error.message.includes('Database is currently unreachable') ||
         error.message.includes('Database unavailable') ||
         error.message.includes('database is unreachable')))
    ) {
      return reply.status(503).send({
        error: 'DatabaseUnavailable',
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database service is currently unavailable. Please check PostgreSQL connection.',
      });
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        error: error.name || 'Error',
        message: error.message,
      });
    }

    return reply.status(500).send({
      error: 'InternalServerError',
      message: error.message || 'An unexpected error occurred',
    });
  });

  // Domain route registration
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(eventRoutes, { prefix: '/api' });
  await app.register(cameraRoutes, { prefix: '/api/cameras' });
  await app.register(ptzRoutes, { prefix: '/api/cameras' });
  await app.register(recordingRoutes, { prefix: '/api/recordings' });
  await app.register(exportRoutes, { prefix: '/api/recordings' });
  await app.register(bookmarkRoutes, { prefix: '/api/cameras' });
  await app.register(zoneRoutes, { prefix: '/api/cameras' });
  await app.register(healthRoutes, { prefix: '/api/cameras' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(streamingRoutes, { prefix: '/api/streaming' });
  await app.register(playbackRoutes, { prefix: '/api/playback' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(systemRoutes, { prefix: '/api/system' });
  await app.register(shutdownRoutes, { prefix: '/api/system' });
  await app.register(backupRoutes, { prefix: '/api/system' });
  await app.register(storageTelemetryRoutes, { prefix: '/api/system/storage' });
  await app.register(auditRoutes, { prefix: '/api/audit' });

  // Register static file serving & SPA fallback if client/dist exists
  const clientDist = path.resolve(process.cwd(), 'client/dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/health')) {
        return reply.status(404).send({
          error: 'NotFound',
          statusCode: 404,
          message: `Route ${request.method}:${request.url} not found`,
        });
      }

      if (request.method === 'GET') {
        return reply.sendFile('index.html');
      }

      return reply.status(404).send({
        error: 'NotFound',
        statusCode: 404,
        message: 'Resource not found',
      });
    });
  }

  // Attach background services when server is ready
  app.addHook('onReady', async () => {
    await engine.start();
    onvifEvents.start();
    cameraHealthService.start();
    await notificationService.start();
    await webhookDispatcherService.start();
    await smtpDispatcherService.start();
    await storageTelemetryService.start();
    wsFeed.attach(app.server, async (token: string) => {
      return app.jwt.verify(token);
    });
  });

  // Clean up on server close
  app.addHook('onClose', async () => {
    storageTelemetryService.stop();
    notificationService.stop();
    webhookDispatcherService.stop();
    smtpDispatcherService.stop();
    cameraHealthService.stop();
    ptzService.destroy();
    await engine.stop();
    onvifEvents.stop();
    wsFeed.close();
  });

  // Register process signal handlers for graceful shutdown (skip in test env)
  if (process.env.NODE_ENV !== 'test') {
    registerProcessSignalHandlers(app);
  }

  return app;
}

export { registerProcessSignalHandlers } from './system/shutdown.service.js';
export default createServer;
