import crypto from 'node:crypto';
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

    return {
      cameraId: cam.id,
      name: cam.name,
      mediaMtxPath: mainPath,
      subStreamPath: subPath,
      whepUrl: `${whepBase}/${mainPath}/whep`,
      subStreamWhepUrl: subPath ? `${whepBase}/${subPath}/whep` : null,
      hlsUrl: `${hlsBase}/${mainPath}/index.m3u8`,
      subStreamHlsUrl: subPath ? `${hlsBase}/${subPath}/index.m3u8` : null,
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
