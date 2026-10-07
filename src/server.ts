import fs from 'fs';
import path from 'path';
import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { licensingPlugin, LicensingPluginOptions } from './licensing/plugin.js';
import { registerCameraAccess } from './users/camera-scope.js';
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
import { settingsService } from './settings/settings.service.js';
import { systemRoutes } from './system/system.routes.js';
import { shutdownRoutes } from './system/shutdown.routes.js';
import { backupRoutes } from './system/backup.routes.js';
import { setupRoutes } from './system/setup.routes.js';
import { handoffRoutes } from './system/handoff.routes.js';
import { auditRoutes } from './audit/audit.routes.js';
import { mediaProxyRoutes } from './media/media-proxy.routes.js';
import { siteRoutes } from './sites/site.routes.js';
import { storageTelemetryRoutes } from './system/storage-telemetry.routes.js';
import { storageTelemetryService } from './system/storage-telemetry.service.js';
import { registerProcessSignalHandlers } from './system/shutdown.service.js';
import { webhookDispatcherService } from './webhooks/webhook-dispatcher.service.js';
import { eventBus } from './events/event-bus.js';
import { webSocketFeedService, WebSocketFeedService } from './events/websocket-feed.service.js';
import { onvifEventListenerService as defaultOnvifEvents, OnvifEventListenerService } from './events/onvif-events.service.js';
import { resolveJwtSecret } from './users/jwt-secret.js';
import { isSessionValid } from './users/session.js';
import type { UserTokenPayload } from './users/rbac.guard.js';
import { recordingEngine as defaultRecordingEngine, RecordingEngine } from './recordings/recording-engine.js';
import { backupScheduler } from './system/backup-scheduler.js';

let eventRetentionTimer: NodeJS.Timeout | null = null;

/** Prunes persisted events older than EVENT_RETENTION_DAYS (default 90) hourly. */
function startEventRetention(): void {
  if (eventRetentionTimer || process.env.NODE_ENV === 'test') return;
  const days = Math.max(1, Number(process.env.EVENT_RETENTION_DAYS) || 90);
  const prune = () =>
    eventBus.pruneOlderThan(days).catch((err) => console.warn('[Events] Retention prune failed:', err.message));
  prune();
  eventRetentionTimer = setInterval(prune, 60 * 60 * 1000);
  eventRetentionTimer.unref();
}

function stopEventRetention(): void {
  if (eventRetentionTimer) {
    clearInterval(eventRetentionTimer);
    eventRetentionTimer = null;
  }
}

/**
 * TRUST_PROXY: "true" trusts X-Forwarded-* only from a proxy on this host (the https
 * profile's Caddy). Trusting every hop would let any client pick its own IP and
 * sidestep the per-IP login throttle when the app port is reachable directly.
 * Any other non-empty value is a comma-separated list of proxy IPs/CIDRs.
 */
export function trustProxySetting(value: string | undefined): false | string {
  const setting = (value ?? '').trim();
  if (!setting || setting === 'false') return false;
  if (setting === 'true') return '127.0.0.1,::1';
  return setting;
}

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
    // Behind Caddy/nginx: take the client IP from X-Forwarded-For (audit logs)
    trustProxy: trustProxySetting(process.env.TRUST_PROXY),
  });

  const wsFeed = opts.wsFeedService || webSocketFeedService;
  const engine = opts.recordingEngine || defaultRecordingEngine;
  const onvifEvents = opts.onvifEventsService || defaultOnvifEvents;

  // The UI is served from this origin; cross-origin access only for explicitly listed origins
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    await app.register(cors, { origin: corsOrigins, credentials: true });
  }

  // JWT authentication plugin
  await app.register(fastifyJwt, {
    secret: opts.jwtSecret || (await resolveJwtSecret()),
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

  // Every camera-related route must declare its camera access (see camera-scope.ts)
  registerCameraAccess(app);

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
  await app.register(setupRoutes, { prefix: '/api/system' });
  await app.register(handoffRoutes, { prefix: '/api/system' });
  await app.register(storageTelemetryRoutes, { prefix: '/api/system/storage' });
  await app.register(auditRoutes, { prefix: '/api/audit' });
  await app.register(mediaProxyRoutes, { prefix: '/api/media' });
  await app.register(siteRoutes, { prefix: '/api/sites' });

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

      // SPA deep links get index.html; missing static files (e.g. /assets/x.js) stay 404
      if (request.method === 'GET' && !path.extname(request.url.split('?')[0])) {
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
    await settingsService.load();
    await engine.start();
    onvifEvents.start();
    cameraHealthService.start();
    await notificationService.start();
    await webhookDispatcherService.start();
    await smtpDispatcherService.start();
    startEventRetention();
    if (process.env.NODE_ENV !== 'test') backupScheduler.start();
    await storageTelemetryService.start();
    wsFeed.attach(app.server, async (token: string) => {
      const payload = app.jwt.verify<UserTokenPayload>(token);
      if (!(await isSessionValid(payload))) {
        throw new Error('Session revoked');
      }
      return payload;
    });
  });

  // Clean up on server close
  app.addHook('onClose', async () => {
    stopEventRetention();
    backupScheduler.stop();
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
