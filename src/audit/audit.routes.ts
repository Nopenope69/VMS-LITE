import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate } from '../users/rbac.guard.js';
import { auditService } from './audit.service.js';
import { TokenBucketRateLimiter } from '../notifications/token-bucket-rate-limiter.js';

export const snapshotRateLimiter = new TokenBucketRateLimiter({
  capacity: 5,
  refillRatePerMinute: 30,
  cooldownSeconds: 2,
});

function parseImageBuffer(rawImage: unknown): Buffer | null {
  if (Buffer.isBuffer(rawImage)) {
    return rawImage.length > 0 ? rawImage : null;
  }
  if (typeof rawImage !== 'string' || !rawImage.trim()) {
    return null;
  }

  let base64Data = rawImage.trim();
  const match = base64Data.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/s);
  if (match) {
    base64Data = match[1];
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

export const auditRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/audit/snapshot
   * Server-authoritative snapshot audit pipeline (BSA-aware)
   * Calculates exact-byte SHA-256 and logs audit trail
   */
  app.post(
    '/snapshot',
    {
      bodyLimit: 15 * 1024 * 1024, // 15MB limit to allow high-resolution JPEG captures
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      const body = (request.body as any) || {};

      // Validate cameraId
      if (!body.cameraId || typeof body.cameraId !== 'string') {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Missing or invalid cameraId',
        });
      }

      // Validate image payload
      const imageBuffer = parseImageBuffer(body.image);
      if (!imageBuffer) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Missing or invalid image payload',
        });
      }

      // Validate timestampUtc
      let timestampUtc = new Date();
      if (body.timestampUtc) {
        const parsed = new Date(body.timestampUtc);
        if (isNaN(parsed.getTime())) {
          return reply.status(400).send({
            error: 'ValidationError',
            message: 'Invalid timestampUtc format',
          });
        }
        timestampUtc = parsed;
      }

      // Enforce token-bucket rate limiting per operator and camera
      const rateLimitKey = `snapshot:${user.id}:${body.cameraId}`;
      const rateResult = snapshotRateLimiter.tryAcquire(rateLimitKey);
      if (!rateResult.allowed) {
        return reply.status(429).send({
          error: 'RateLimitExceeded',
          message: rateResult.reason || 'Snapshot rate limit exceeded. Please wait before taking another snapshot.',
          retryAfter: rateResult.waitSeconds || 1,
        });
      }

      const clientIp = request.ip || request.socket.remoteAddress || '127.0.0.1';

      const result = await auditService.recordSnapshot({
        imageBuffer,
        userId: user.id,
        username: user.username,
        cameraId: body.cameraId,
        timestampUtc,
        streamProfile: body.streamProfile,
        resolution: body.resolution,
        playbackSegmentId: body.playbackSegmentId,
        mediaOffsetSeconds: typeof body.mediaOffsetSeconds === 'number' ? body.mediaOffsetSeconds : undefined,
        clientIp,
      });

      return reply.status(201).send(result);
    }
  );

  /**
   * GET /api/audit/snapshot/:id/download
   * Streams the persisted snapshot image file with attachment headers
   */
  app.get<{ Params: { id: string } }>(
    '/snapshot/:id/download',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;

      const record = await auditService.getSnapshotById(id);
      if (!record) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Snapshot with id ${id} not found`,
        });
      }

      try {
        await fsPromises.access(record.filePath);
      } catch {
        return reply.status(404).send({
          error: 'NotFound',
          message: 'Snapshot image file not found on disk',
        });
      }

      const filename = path.basename(record.filePath);
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(fsSync.createReadStream(record.filePath));
    }
  );
};

export default auditRoutes;
