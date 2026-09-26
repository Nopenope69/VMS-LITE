import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
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
import { webhookRoutes } from './webhooks/webhook.routes.js';
import { webhookDispatcherService } from './webhooks/webhook-dispatcher.service.js';
import { tourRoutes } from './tours/tour.routes.js';
import { kioskRoutes } from './kiosk/kiosk.routes.js';
import { emapRoutes } from './emap/emap.routes.js';
import { wanArchivalRoutes } from './recordings/wan-archival.routes.js';
import { nightlySyncRoutes } from './recordings/nightly-sync.routes.js';
import { nightlySyncService } from './recordings/nightly-sync.service.js';
import { pingRoutes } from './health/ping.routes.js';
import { locationRoutes } from './locations/location.routes.js';
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

  const defaultJwtSecret = opts.jwtSecret || process.env.JWT_SECRET || (
    process.env.NODE_ENV === 'production'
      ? crypto.randomBytes(32).toString('hex')
      : 'dev-secret-basic-vms-super-secure'
  );

  // JWT authentication plugin
  await app.register(fastifyJwt, {
    secret: defaultJwtSecret,
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
  await app.register(tourRoutes, { prefix: '/api' });
  await app.register(kioskRoutes, { prefix: '/api' });
  await app.register(emapRoutes, { prefix: '/api' });
  await app.register(pingRoutes, { prefix: '/api/health' });
  await app.register(wanArchivalRoutes, { prefix: '/api/v1/wan-archival' });
  await app.register(nightlySyncRoutes, { prefix: '/api/v1/nightly-sync' });
  await app.register(locationRoutes, { prefix: '/api/v1/locations' });

  // Available surveillance media clips (uploaded + builtin)
  app.get('/api/media/clips', async (_request, reply) => {
    const candidateDirs = [
      path.resolve(process.cwd(), 'media'),
      path.resolve(process.cwd(), 'tools', 'cctv-simulator', 'media'),
    ];
    const clips: Array<{ id: string; filename: string; title: string; size: number }> = [];
    const seen = new Set<string>();

    for (const dir of candidateDirs) {
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            const ext = path.extname(f).toLowerCase();
            if (['.mp4', '.webm', '.m4v'].includes(ext) && !seen.has(f)) {
              seen.add(f);
              const stat = fs.statSync(path.resolve(dir, f));
              clips.push({
                id: f,
                filename: f,
                title: f.replace(/\.[^/.]+$/, '').toUpperCase(),
                size: stat.size,
              });
            }
          }
        }
      } catch {}
    }

    return reply.send({ clips });
  });

  // Serve simulated / user-uploaded surveillance media clips with HTTP Range 206 support
  app.route({
    method: ['GET', 'HEAD'],
    url: '/media/:filename',
    handler: async (request, reply) => {
      const { filename } = request.params as { filename: string };
      const cleanName = path.basename(filename);
      const candidateDirs = [
        path.resolve(process.cwd(), 'media'),
        path.resolve(process.cwd(), 'tools', 'cctv-simulator', 'media'),
      ];

      let targetFile: string | null = null;
      for (const dir of candidateDirs) {
        const p = path.resolve(dir, cleanName);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          targetFile = p;
          break;
        }
      }

      if (!targetFile) {
        return reply.status(404).send({ error: 'NotFound', message: `Media file ${cleanName} not found` });
      }

      const stat = fs.statSync(targetFile);
      const ext = path.extname(targetFile).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.m4v': 'video/mp4',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      if (request.method === 'HEAD') {
        reply.headers({
          'Content-Length': stat.size,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        });
        return reply.status(200).send();
      }

      const range = request.headers.range;
      if (range && (ext === '.mp4' || ext === '.webm' || ext === '.m4v')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        // Default to a 2MB chunk for open-ended range requests to ensure instant playback without network buffer saturation
        const maxChunk = 2 * 1024 * 1024;
        const requestedEnd = parts[1] ? parseInt(parts[1], 10) : start + maxChunk - 1;
        const end = Math.min(requestedEnd, stat.size - 1);
        const chunkSize = end - start + 1;

        reply.status(206);
        reply.headers({
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });
        return reply.send(fs.createReadStream(targetFile, { start, end }));
      }

      reply.headers({
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      return reply.send(fs.createReadStream(targetFile));
    },
  });

  // Serve static client SPA if built
  const clientDistPath = path.resolve(process.cwd(), 'client', 'dist');
  if (fs.existsSync(clientDistPath)) {
    await app.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.raw.url && request.raw.url.startsWith('/api')) {
        return reply.status(404).send({ error: 'NotFound', message: 'API endpoint not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // Attach background services when server is ready
  app.addHook('onReady', async () => {
    await engine.start();
    onvifEvents.start();
    cameraHealthService.start();
    nightlySyncService.start();
    await notificationService.start();
    await webhookDispatcherService.start();
    wsFeed.attach(app.server, async (token: string) => {
      return app.jwt.verify(token);
    });
  });

  // Clean up on server close
  app.addHook('onClose', async () => {
    notificationService.stop();
    webhookDispatcherService.stop();
    cameraHealthService.stop();
    nightlySyncService.stop();
    ptzService.destroy();
    await engine.stop();
    onvifEvents.stop();
    wsFeed.close();
  });

  return app;
}

export default createServer;
