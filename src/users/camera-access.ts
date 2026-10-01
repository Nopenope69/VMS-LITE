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
