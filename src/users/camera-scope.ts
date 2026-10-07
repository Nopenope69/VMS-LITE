import { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import { Role } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import type { UserTokenPayload } from './rbac.guard.js';

/**
 * Camera Scope: the one place that answers "what may this user do on which camera".
 *
 * ADMIN: everything. VIEWER: live + playback on every camera. OPERATOR: only what is
 * granted, per camera (CameraPermission) or per site (SitePermission). A site grant
 * covers every camera currently at that site, including cameras added or moved there
 * later. The effective right on a camera is camera grant OR site grant.
 */

export type CameraPermissionFlag = 'canViewLive' | 'canViewPlayback' | 'canControlPtz' | 'canExportClips';
export const PERMISSION_FLAGS: CameraPermissionFlag[] = ['canViewLive', 'canViewPlayback', 'canControlPtz', 'canExportClips'];
/** A permission flag, or 'view' for live OR playback. */
export type CameraRight = CameraPermissionFlag | 'view';

export type EffectivePermission = Record<CameraPermissionFlag, boolean> & {
  cameraId: string;
  /** Where the rights come from (UI explanation) */
  viaCamera: boolean;
  viaSite: boolean;
};

type Rights = Record<CameraPermissionFlag, boolean>;
const ALL: Rights = { canViewLive: true, canViewPlayback: true, canControlPtz: true, canExportClips: true };
const VIEW_ONLY: Rights = { canViewLive: true, canViewPlayback: true, canControlPtz: false, canExportClips: false };

export class CameraScope {
  private constructor(
    /** Rights on every camera (ADMIN, VIEWER), or null when rights are per camera */
    private readonly everyCamera: Rights | null,
    private readonly perCamera: Map<string, EffectivePermission>
  ) {}

  static async forUser(user: Pick<UserTokenPayload, 'id' | 'role'>, prisma: any = defaultPrisma): Promise<CameraScope> {
    if (user.role === Role.ADMIN) return new CameraScope(ALL, new Map());
    if (user.role === Role.VIEWER) return new CameraScope(VIEW_ONLY, new Map());
    if (user.role !== Role.OPERATOR) return new CameraScope(null, new Map());
    const granted = await effectiveGrants(user.id, prisma);
    return new CameraScope(null, new Map(granted.map((p) => [p.cameraId, p])));
  }

  can(cameraId: string, right: CameraRight): boolean {
    const rights = this.everyCamera ?? this.perCamera.get(cameraId);
    if (!rights) return false;
    return right === 'view' ? rights.canViewLive || rights.canViewPlayback : rights[right];
  }

  /** Cameras with the right, or null when the user has it on every camera. */
  cameraIds(right: CameraRight = 'view'): string[] | null {
    if (this.everyCamera) return this.can('*', right) ? null : [];
    return [...this.perCamera.keys()].filter((id) => this.can(id, right));
  }

  /** Effective rights per camera, for clients; cameras without any right are omitted. */
  permissions(allCameraIds: string[]): EffectivePermission[] {
    if (!this.everyCamera) return [...this.perCamera.values()];
    const rights = this.everyCamera;
    return allCameraIds.map((cameraId) => ({ cameraId, ...rights, viaCamera: false, viaSite: false }));
  }
}

/** Operator rights merged from camera and site grants. */
async function effectiveGrants(userId: string, prisma: any): Promise<EffectivePermission[]> {
  const [cameraGrants, siteGrants] = await Promise.all([
    prisma.cameraPermission.findMany({ where: { userId } }),
    prisma.sitePermission.findMany({ where: { userId } }),
  ]);

  const merged = new Map<string, EffectivePermission>();
  const apply = (cameraId: string, grant: any, source: 'viaCamera' | 'viaSite') => {
    const entry =
      merged.get(cameraId) ??
      ({ cameraId, canViewLive: false, canViewPlayback: false, canControlPtz: false, canExportClips: false, viaCamera: false, viaSite: false } as EffectivePermission);
    for (const flag of PERMISSION_FLAGS) entry[flag] = entry[flag] || Boolean(grant[flag]);
    entry[source] = true;
    merged.set(cameraId, entry);
  };

  for (const grant of cameraGrants) apply(grant.cameraId, grant, 'viaCamera');

  if (siteGrants.length > 0) {
    const cameras = await prisma.camera.findMany({
      where: { siteId: { in: siteGrants.map((g: any) => g.siteId) } },
      select: { id: true, siteId: true },
    });
    const bySite = new Map(siteGrants.map((g: any) => [g.siteId, g]));
    for (const cam of cameras) apply(cam.id, bySite.get(cam.siteId), 'viaSite');
  }

  return [...merged.values()].filter((p) => PERMISSION_FLAGS.some((f) => p[f]));
}

const SCOPE = Symbol('cameraScope');

/** The Camera Scope of an authenticated request, resolved once per request. */
export async function cameraScopeOf(request: FastifyRequest): Promise<CameraScope> {
  const cached = (request as any)[SCOPE] as Promise<CameraScope> | undefined;
  if (cached) return cached;
  const scope = CameraScope.forUser(request.user);
  (request as any)[SCOPE] = scope;
  return scope;
}

// ---- Route declarations ----------------------------------------------------------

type CameraIdSource = 'params.id' | 'params.cameraId' | 'query.cameraId' | 'body.cameraId';

/**
 * How a route reaches camera data. Every route under CAMERA_ROUTE_PREFIXES must declare
 * one in `config.cameraAccess`; the server refuses to start otherwise.
 * - camera: the request names the camera; checked before the handler
 * - resource: the request names something a camera owns; resolve returns its camera id
 *   (null = not found, 404); checked before the handler
 * - list: the handler filters what it returns with cameraScopeOf(request)
 * - custom: the route checks access itself (say where)
 * - none: no camera data, or admin-only (say why)
 */
export type CameraAccess =
  | { camera: CameraIdSource; right: CameraRight }
  | { resource: (request: FastifyRequest) => Promise<string | null>; right: CameraRight }
  | { list: CameraRight }
  | { custom: string }
  | { none: string };

/** For routes that only ADMIN may call (enforced by requireRole). */
export const ADMIN_ONLY: CameraAccess = { none: 'admin only' };

declare module 'fastify' {
  interface FastifyContextConfig {
    cameraAccess?: CameraAccess;
  }
}

export const CAMERA_ROUTE_PREFIXES = [
  '/api/cameras',
  '/api/recordings',
  '/api/playback',
  '/api/streaming',
  '/api/media',
  '/api/audit',
  '/api/sites',
  '/api/events',
  '/api/system',
];

function cameraIdFrom(request: FastifyRequest, source: CameraIdSource): string | undefined {
  const [part, key] = source.split('.') as ['params' | 'query' | 'body', string];
  const value = (request[part] as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function enforce(access: Extract<CameraAccess, { right: CameraRight }>) {
  return async function enforceCameraAccess(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (reply.sent) return;
    if (!request.user) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }
    let cameraId: string | null | undefined;
    if ('camera' in access) {
      cameraId = cameraIdFrom(request, access.camera);
      if (!cameraId) {
        reply.status(400).send({ error: 'ValidationError', message: `Missing camera id (${access.camera})` });
        return;
      }
    } else {
      cameraId = await access.resource(request);
      if (!cameraId) {
        reply.status(404).send({ error: 'NotFound', message: 'Not found' });
        return;
      }
    }
    if (!(await cameraScopeOf(request)).can(cameraId, access.right)) {
      reply.status(403).send({
        error: 'Forbidden',
        message: `No '${access.right}' access to camera '${cameraId}'`,
        cameraId,
        permission: access.right,
      });
    }
  };
}

/** Validates a route's camera access declaration and wires its check. Throws if missing. */
export function applyCameraAccess(route: RouteOptions): void {
  if (!CAMERA_ROUTE_PREFIXES.some((p) => route.url === p || route.url.startsWith(`${p}/`))) return;
  const access = route.config?.cameraAccess;
  if (!access) {
    throw new Error(`Route ${route.method} ${route.url} must declare config.cameraAccess`);
  }
  if ('right' in access) {
    const existing = route.preHandler ? (Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler]) : [];
    route.preHandler = [...existing, enforce(access)];
  }
}

/** Registers the declaration check for every route added after this call. */
export function registerCameraAccess(app: FastifyInstance): void {
  app.addHook('onRoute', applyCameraAccess);
}
