import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate } from '../users/rbac.guard.js';
import { cameraService } from '../cameras/camera.service.js';
import {
  CameraStreamInfo,
  IceServerConfig,
  StreamingConfigDto,
} from './streaming.types.js';

export const streamingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const getWhepBaseUrl = () =>
    process.env.MEDIAMTX_WHEP_BASE_URL || 'http://localhost:8889';
  const getHlsBaseUrl = () =>
    process.env.MEDIAMTX_HLS_BASE_URL || 'http://localhost:8888';
  const getDefaultIceServers = (): IceServerConfig[] => {
    const configuredStun = process.env.STUN_SERVER_URL || 'stun:stun.l.google.com:19302';
    return [{ urls: configuredStun }];
  };

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
    async (_request, reply) => {
      try {
        const cameras = await cameraService.listCameras();
        const response: StreamingConfigDto = {
          whepBaseUrl: getWhepBaseUrl(),
          hlsBaseUrl: getHlsBaseUrl(),
          iceServers: getDefaultIceServers(),
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
