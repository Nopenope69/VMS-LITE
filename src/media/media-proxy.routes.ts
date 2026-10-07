import { Readable } from 'node:stream';
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { UserTokenPayload } from '../users/rbac.guard.js';
import { CameraAccess, CameraPermissionFlag, CameraScope } from '../users/camera-scope.js';
import { isSessionValid } from '../users/session.js';

/**
 * Authenticated reverse proxy for MediaMTX's browser-facing endpoints.
 *
 *   POST/PATCH/DELETE /api/media/whep/:path/whep[/:session]  -> WebRTC (WHEP) signalling
 *   GET               /api/media/hls/:path/*                  -> HLS playlists and parts
 *   GET               /api/media/playback/get?path&start&...  -> recorded fMP4
 *
 * MediaMTX's HTTP listeners stay bound to localhost, so video is only reachable
 * through the control plane, with the same JWT and per-camera permissions as the
 * REST API, on the same origin and port. That is what makes remote sites viewable
 * through one URL. WebRTC media itself flows over MediaMTX's UDP port.
 *
 * Browsers cannot attach Authorization headers to <video src> or native HLS requests,
 * so GET endpoints also accept the HttpOnly `vms_media` cookie set at login.
 */

export const MEDIA_COOKIE = 'vms_media';
export const MEDIA_COOKIE_PATH = '/api/media';

const upstream = {
  webrtc: () =>
    (process.env.MEDIAMTX_WEBRTC_URL || process.env.MEDIAMTX_WHEP_URL || 'http://127.0.0.1:8889').replace(/\/+$/, ''),
  hls: () => (process.env.MEDIAMTX_HLS_URL || 'http://127.0.0.1:8888').replace(/\/+$/, ''),
  playback: () => (process.env.MEDIAMTX_PLAYBACK_URL || 'http://127.0.0.1:9996').replace(/\/+$/, ''),
};

const PATH_NAME = /^[A-Za-z0-9_.-]+$/;
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'etag', 'accept-patch', 'link'];

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Cookie that authorises media GETs. SameSite=Strict + path-scoped to /api/media, and
 * only accepted by these read-only endpoints, so it adds no CSRF surface to the API.
 */
export function setMediaCookie(request: FastifyRequest, reply: FastifyReply, token: string): void {
  const secure =
    request.protocol === 'https' || String(request.headers['x-forwarded-proto'] || '').startsWith('https');
  reply.header(
    'set-cookie',
    `${MEDIA_COOKIE}=${encodeURIComponent(token)}; Path=${MEDIA_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}${secure ? '; Secure' : ''}`
  );
}

export function clearMediaCookie(reply: FastifyReply): void {
  reply.header('set-cookie', `${MEDIA_COOKIE}=; Path=${MEDIA_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0`);
}

async function authenticateMedia(
  app: FastifyInstance,
  request: FastifyRequest,
  allowCookie: boolean
): Promise<UserTokenPayload | null> {
  const auth = request.headers.authorization;
  let token: string | undefined;
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7).trim();
  } else if (allowCookie) {
    token = readCookie(request, MEDIA_COOKIE);
  }
  if (!token) return null;
  try {
    const payload = app.jwt.verify<UserTokenPayload>(token);
    return (await isSessionValid(payload)) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the camera that owns a MediaMTX path (main or sub-stream) and checks access.
 * Temporary onboarding previews belong to no camera and are admin-only.
 */
async function authorizePath(
  user: UserTokenPayload,
  pathName: string,
  permission: CameraPermissionFlag
): Promise<boolean> {
  if (pathName.startsWith('preview_')) {
    return user.role === Role.ADMIN;
  }
  const camera = await prisma.camera.findFirst({
    where: { OR: [{ mediaMtxPath: pathName }, { subMediaMtxPath: pathName }] },
    select: { id: true },
  });
  if (!camera) return false;
  return (await CameraScope.forUser(user)).can(camera.id, permission);
}

async function forward(
  request: FastifyRequest,
  reply: FastifyReply,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  rewriteLocation?: (location: string) => string
): Promise<FastifyReply> {
  const controller = new AbortController();
  // Stop pulling from MediaMTX when the browser goes away (long playback/HLS reads)
  reply.raw.on('close', () => controller.abort());

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
  } catch (err) {
    return reply.status(502).send({
      error: 'MediaUnavailable',
      message: `Media server unreachable: ${(err as Error).message}`,
    });
  }

  reply.status(res.status);
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value) reply.header(name, value);
  }
  const location = res.headers.get('location');
  if (location && rewriteLocation) {
    reply.header('location', rewriteLocation(location));
  }

  if (!res.body) {
    return reply.send();
  }
  return reply.send(Readable.fromWeb(res.body as any));
}

const BY_STREAM_PATH: CameraAccess = { custom: 'guard() resolves the MediaMTX path to its camera and checks the Camera Scope' };

export const mediaProxyRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addContentTypeParser(
    ['application/sdp', 'application/trickle-ice-sdpfrag'],
    { parseAs: 'string' },
    (_req, body, done) => done(null, body)
  );

  const guard =
    (
      permission: CameraPermissionFlag,
      allowCookie: boolean,
      getPath: (request: FastifyRequest) => string = (request) => (request.params as any).path
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await authenticateMedia(app, request, allowCookie);
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      }
      const pathName = getPath(request) || '';
      if (!PATH_NAME.test(pathName)) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Invalid stream path' });
      }
      if (!(await authorizePath(user, pathName, permission))) {
        return reply.status(403).send({ error: 'Forbidden', message: 'No access to this camera' });
      }
      request.user = user;
    };

  // ---- WebRTC / WHEP signalling ----------------------------------------------------
  // MediaMTX answers with Location: /<path>/whep/<session>; keep clients on the proxy.
  const rewriteWhepLocation = (location: string) =>
    `/api/media/whep/${location.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '')}`;
  const sessionUrl = (path: string, session: string) =>
    `${upstream.webrtc()}/${path}/whep/${encodeURIComponent(session)}`;

  app.post<{ Params: { path: string } }>(
    '/whep/:path/whep',
    { preHandler: guard('canViewLive', false), config: { cameraAccess: BY_STREAM_PATH } },
    async (request, reply) =>
      forward(
        request,
        reply,
        `${upstream.webrtc()}/${request.params.path}/whep`,
        { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: String(request.body ?? '') },
        rewriteWhepLocation
      )
  );

  app.patch<{ Params: { path: string; session: string } }>(
    '/whep/:path/whep/:session',
    { preHandler: guard('canViewLive', false), config: { cameraAccess: BY_STREAM_PATH } },
    async (request, reply) =>
      forward(request, reply, sessionUrl(request.params.path, request.params.session), {
        method: 'PATCH',
        headers: {
          'Content-Type': request.headers['content-type'] || 'application/trickle-ice-sdpfrag',
          ...(request.headers['if-match'] ? { 'If-Match': String(request.headers['if-match']) } : {}),
        },
        body: String(request.body ?? ''),
      })
  );

  app.delete<{ Params: { path: string; session: string } }>(
    '/whep/:path/whep/:session',
    { preHandler: guard('canViewLive', false), config: { cameraAccess: BY_STREAM_PATH } },
    async (request, reply) =>
      forward(request, reply, sessionUrl(request.params.path, request.params.session), { method: 'DELETE' })
  );

  // ---- HLS fallback -----------------------------------------------------------------
  app.get<{ Params: { path: string; '*': string } }>(
    '/hls/:path/*',
    { preHandler: guard('canViewLive', true), config: { cameraAccess: BY_STREAM_PATH } },
    async (request, reply) => {
      const rest = request.params['*'];
      if (!rest || rest.split('/').some((seg) => seg === '..' || seg === '.')) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Invalid HLS resource' });
      }
      const query = request.raw.url?.split('?')[1];
      return forward(request, reply, `${upstream.hls()}/${request.params.path}/${rest}${query ? `?${query}` : ''}`, {
        method: 'GET',
      });
    }
  );

  // ---- Recorded playback (fMP4) -------------------------------------------------------
  app.get<{ Querystring: { path?: string; start?: string; duration?: string } }>(
    '/playback/get',
    { preHandler: guard('canViewPlayback', true, (request) => (request.query as any).path), config: { cameraAccess: BY_STREAM_PATH } },
    async (request, reply) => {
      const { path, start, duration } = request.query;
      const startDate = new Date(start ?? '');
      const durationSec = Number(duration);
      if (isNaN(startDate.getTime()) || !Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 3600) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'start must be an ISO timestamp and duration between 0 and 3600 seconds',
        });
      }
      const params = new URLSearchParams({
        path: path!,
        start: startDate.toISOString(),
        duration: String(durationSec),
        format: 'fmp4',
      });
      return forward(request, reply, `${upstream.playback()}/get?${params}`, { method: 'GET' });
    }
  );
};

export default mediaProxyRoutes;
