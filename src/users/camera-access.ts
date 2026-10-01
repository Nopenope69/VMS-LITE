import { Role } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { UserTokenPayload } from './rbac.guard.js';

/**
 * Operator access model.
 *
 * ADMIN: everything. VIEWER: live + playback on every camera. OPERATOR: only what is
 * granted, either per camera (CameraPermission) or per site (SitePermission). A site
 * grant covers every camera currently at that site, including cameras added or moved
 * there later. The effective right on a camera is camera grant OR site grant.
 */

export type CameraPermissionFlag = 'canViewLive' | 'canViewPlayback' | 'canControlPtz' | 'canExportClips';
export const PERMISSION_FLAGS: CameraPermissionFlag[] = ['canViewLive', 'canViewPlayback', 'canControlPtz', 'canExportClips'];

export type EffectivePermission = Record<CameraPermissionFlag, boolean> & {
  cameraId: string;
  /** Where the rights come from (UI explanation) */
  viaCamera: boolean;
  viaSite: boolean;
};

/**
 * Effective per-camera rights of an operator, merged from camera and site grants.
 * Cameras without any right are omitted.
 */
export async function getEffectiveCameraPermissions(
  userId: string,
  prisma: any = defaultPrisma
): Promise<EffectivePermission[]> {
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
    const siteIds = siteGrants.map((g: any) => g.siteId);
    const cameras = await prisma.camera.findMany({
      where: { siteId: { in: siteIds } },
      select: { id: true, siteId: true },
    });
    const bySite = new Map(siteGrants.map((g: any) => [g.siteId, g]));
    for (const cam of cameras) apply(cam.id, bySite.get(cam.siteId), 'viaSite');
  }

  return [...merged.values()].filter((p) => PERMISSION_FLAGS.some((f) => p[f]));
}

/**
 * Cameras a user may see. Returns null for unrestricted roles (ADMIN, VIEWER);
 * operators see cameras they may view live or play back, via camera or site grants.
 */
export async function getVisibleCameraIds(
  user: Pick<UserTokenPayload, 'id' | 'role'>,
  prisma: any = defaultPrisma
): Promise<string[] | null> {
  if (user.role !== Role.OPERATOR) {
    return null;
  }
  const effective = await getEffectiveCameraPermissions(user.id, prisma);
  return effective.filter((p) => p.canViewLive || p.canViewPlayback).map((p) => p.cameraId);
}

/**
 * Per-camera permission check shared by route guards and the media proxy.
 */
export async function hasCameraPermission(
  user: Pick<UserTokenPayload, 'id' | 'role'>,
  cameraId: string,
  permission: CameraPermissionFlag,
  prisma: any = defaultPrisma
): Promise<boolean> {
  if (user.role === Role.ADMIN) return true;
  if (user.role === Role.VIEWER) {
    return permission === 'canViewLive' || permission === 'canViewPlayback';
  }
  if (user.role !== Role.OPERATOR) return false;

  const cameraGrant = await prisma.cameraPermission.findUnique({
    where: { userId_cameraId: { userId: user.id, cameraId } },
  });
  if (cameraGrant?.[permission]) return true;

  const camera = await prisma.camera.findUnique({ where: { id: cameraId }, select: { siteId: true } });
  if (!camera?.siteId) return false;
  const siteGrant = await prisma.sitePermission.findUnique({
    where: { userId_siteId: { userId: user.id, siteId: camera.siteId } },
  });
  return Boolean(siteGrant?.[permission]);
}
