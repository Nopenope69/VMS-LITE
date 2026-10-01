import { Role } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { UserTokenPayload } from './rbac.guard.js';

/**
 * Cameras a user may see. Returns null for unrestricted roles (ADMIN, VIEWER);
 * operators see only cameras with an explicit live or playback grant.
 */
export async function getVisibleCameraIds(
  user: Pick<UserTokenPayload, 'id' | 'role'>,
  prisma: any = defaultPrisma
): Promise<string[] | null> {
  if (user.role !== Role.OPERATOR) {
    return null;
  }
  const permissions = await prisma.cameraPermission.findMany({
    where: {
      userId: user.id,
      OR: [{ canViewLive: true }, { canViewPlayback: true }],
    },
    select: { cameraId: true },
  });
  return permissions.map((p: { cameraId: string }) => p.cameraId);
}

export type CameraPermissionFlag = 'canViewLive' | 'canViewPlayback' | 'canControlPtz' | 'canExportClips';

/**
 * Per-camera permission check shared by route guards and the media proxy.
 * ADMIN: everything. VIEWER: live + playback on all cameras. OPERATOR: explicit grants.
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
  if (user.role === Role.OPERATOR) {
    const perm = await prisma.cameraPermission.findUnique({
      where: { userId_cameraId: { userId: user.id, cameraId } },
    });
    return Boolean(perm && perm[permission]);
  }
  return false;
}
