import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate } from '../users/rbac.guard.js';
import { cameraService } from '../cameras/camera.service.js';
import {
  CameraStreamInfo,
  IceServerConfig,
  StreamingConfigDto,
} from './streaming.types.js';

export interface IceServerOptions {
  stunUrls?: string[];
  turnHost?: string;
  turnPort?: number;
  turnSecret?: string;
  ttlSeconds?: number;
}

/**
 * Scans directories for user-provided or simulated video files (.mp4, .webm)
 */
function getAvailableMediaFiles(): string[] {
  const dirs = [
    path.resolve(process.cwd(), 'media'),
    path.resolve(process.cwd(), 'tools', 'cctv-simulator', 'media'),
  ];
  const files: string[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          const ext = path.extname(f).toLowerCase();
          if (['.mp4', '.webm', '.m4v'].includes(ext) && !seen.has(f)) {
            seen.add(f);
            files.push(f);
          }
        }
      }
    } catch {}
  }
  return files;
}

function resolveCameraMediaSource(cam: any, availableFiles: string[]): string | null {
  if (cam.mediaSource) return cam.mediaSource;

  const nameLower = (cam.name || '').toLowerCase();
  // 1. Channel number match: CH-01 -> 1.mp4, CH-02 -> 2.mp4, etc.
  const chMatch = nameLower.match(/ch[-_ ]*0?(\d+)/i) || nameLower.match(/cam[-_ ]*0?(\d+)/i) || nameLower.match(/camera[-_ ]*0?(\d+)/i);
  if (chMatch) {
    const candidateNumbered = `${chMatch[1]}.mp4`;
    if (availableFiles.includes(candidateNumbered)) return candidateNumbered;
  }

  // 2. Keyword matches
  if ((nameLower.includes('gate') || nameLower.includes('barrier')) && availableFiles.includes('1.mp4')) return '1.mp4';
  if ((nameLower.includes('warehouse') || nameLower.includes('bay')) && availableFiles.includes('2.mp4')) return '2.mp4';
  if ((nameLower.includes('perimeter') || nameLower.includes('fence') || nameLower.includes('north')) && availableFiles.includes('3.mp4')) return '3.mp4';
  if ((nameLower.includes('reception') || nameLower.includes('lobby') || nameLower.includes('office')) && availableFiles.includes('4.mp4')) return '4.mp4';
  if ((nameLower.includes('production') || nameLower.includes('machinery')) && availableFiles.includes('5.mp4')) return '5.mp4';

  // 3. Fallback to any available clip
  if (availableFiles.length > 0) {
    return availableFiles[0];
  }
  return null;
}

/**
 * Generates active ICE servers including ephemeral TURN credentials (RFC 5766 REST API) (LIVE-04, T-04-02).
 */
export function generateIceServers(
  userId: string = 'vms_client',
  opts: IceServerOptions = {}
): IceServerConfig[] {
  const stunUrls = opts.stunUrls || [
    process.env.STUN_SERVER_URL || 'stun:stun.l.google.com:19302',
  ];
  const turnHost = opts.turnHost || process.env.TURN_SERVER_HOST;
  const turnPort = opts.turnPort || Number(process.env.TURN_SERVER_PORT) || 3478;
  const turnSecret = opts.turnSecret || process.env.TURN_SECRET;
  const ttlSeconds = opts.ttlSeconds || 3600;

  const servers: IceServerConfig[] = [{ urls: stunUrls }];

  if (turnHost && turnSecret) {
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiry}:${userId}`;
    const credential = crypto
      .createHmac('sha1', turnSecret)
      .update(username)
      .digest('base64');

    servers.push({
      urls: [
        `turn:${turnHost}:${turnPort}?transport=udp`,
        `turn:${turnHost}:${turnPort}?transport=tcp`,
      ],
      username,
      credential,
    });
  }

  return servers;
}

export const streamingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const getWhepBaseUrl = () =>
    process.env.MEDIAMTX_WHEP_BASE_URL || 'http://localhost:8889';
  const getHlsBaseUrl = () =>
    process.env.MEDIAMTX_HLS_BASE_URL || 'http://localhost:8888';

  const mapCameraToStreamInfo = (cam: any): CameraStreamInfo => {
    const whepBase = getWhepBaseUrl().replace(/\/$/, '');
    const hlsBase = getHlsBaseUrl().replace(/\/$/, '');
    const mainPath = cam.mediaMtxPath;
    const hasSubStream = Boolean(cam.subStreamUrl);
    const subPath = hasSubStream ? `${mainPath}_sub` : null;

    const availableFiles = getAvailableMediaFiles();
    const mediaSource = cam.mediaSource || resolveCameraMediaSource(cam, availableFiles);

    return {
      cameraId: cam.id,
      name: cam.name,
      mediaMtxPath: mainPath,
      subStreamPath: subPath,
      whepUrl: `${whepBase}/${mainPath}/whep`,
      subStreamWhepUrl: subPath ? `${whepBase}/${subPath}/whep` : null,
      hlsUrl: `${hlsBase}/${mainPath}/index.m3u8`,
      subStreamHlsUrl: subPath ? `${hlsBase}/${subPath}/index.m3u8` : null,
      mediaSource,
      mediaUrl: mediaSource ? `/media/${encodeURIComponent(mediaSource)}` : null,
    };
  };

  /**
   * GET /api/streaming/config
   * Returns media endpoints (WHEP/HLS), ICE servers, and stream mappings for all cameras (LIVE-01, LIVE-02, LIVE-03).
   */
  app.get(
    '/config',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const cameras = await cameraService.listCameras();
        const userId = request.user?.id || 'vms_client';
        const iceServers = generateIceServers(userId);

        const response: StreamingConfigDto = {
          whepBaseUrl: getWhepBaseUrl(),
          hlsBaseUrl: getHlsBaseUrl(),
          iceServers,
          cameras: cameras.map(mapCameraToStreamInfo),
        };
        return reply.send(response);
      } catch (err: any) {
        return reply.status(500).send({
          error: 'StreamingConfigError',
          message: err.message || 'Failed to retrieve streaming configuration',
        });
      }
    }
  );

  /**
   * GET /api/streaming/ice-servers
   * Returns active STUN and ephemeral TURN credentials for mobile client NAT traversal (LIVE-04).
   */
  app.get(
    '/ice-servers',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const userId = request.user?.id || 'vms_client';
        const iceServers = generateIceServers(userId);
        return reply.send({
          success: true,
          iceServers,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'IceServerResolutionError',
          message: err.message || 'Failed to resolve ICE servers',
        });
      }
    }
  );

  /**
   * GET /api/streaming/bandwidth-stats
   * Returns WAN egress bandwidth consumption and savings comparison for Dual-Stream Cloud Proxy.
   */
  app.get(
    '/bandwidth-stats',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      try {
        const cameras = await cameraService.listCameras();
        const totalCameras = cameras.length;
        const subStreamCapableCount = cameras.filter((c) => Boolean(c.subStreamUrl)).length;

        // Estimated bitrates: Main 1080p = 4000 kbps, Sub 360p = 200 kbps
        const baselineFullHdKbps = totalCameras * 4000;
        // In 4-grid view, 3 cameras on Sub-Stream + 1 active Hero camera on Main-Stream
        const activeDualStreamKbps =
          totalCameras <= 1
            ? baselineFullHdKbps
            : (totalCameras - 1) * 200 + 1 * 4000;
        const savingsPercent =
          baselineFullHdKbps > 0
            ? Math.round(
                ((baselineFullHdKbps - activeDualStreamKbps) / baselineFullHdKbps) * 100
              )
            : 0;

        return reply.send({
          success: true,
          mode: 'DUAL_STREAM_CLOUD_PROXY',
          totalCameras,
          subStreamCapableCount,
          baselineFullHdKbps,
          activeDualStreamKbps,
          savingsPercent,
          unit: 'kbps',
          mainStreamBitrateKbps: 4000,
          subStreamBitrateKbps: 200,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'BandwidthStatsError',
          message: err.message || 'Failed to calculate bandwidth stats',
        });
      }
    }
  );

  /**
   * GET /api/streaming/cameras/:id
   * Returns stream URLs for a specific camera (Admin & Viewer).
   */
  app.get<{ Params: { id: string } }>(
    '/cameras/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params;
      const camera = await cameraService.getCameraById(id);

      if (!camera) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Camera with id ${id} not found`,
        });
      }

      const streamInfo = mapCameraToStreamInfo(camera);
      return reply.send(streamInfo);
    }
  );
};

export default streamingRoutes;
