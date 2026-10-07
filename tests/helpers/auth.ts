import type { FastifyInstance } from 'fastify';
import { invalidateSessionCache } from '../../src/users/session.js';

/**
 * Signs a JWT for a user that really exists in the (mock) database, so tests go
 * through the same session validation as production (user exists, role matches,
 * token version matches). Creates the user, or aligns its role, as needed.
 */
export async function signAs(
  app: FastifyInstance,
  claims: { id: string; username?: string; role: string; [key: string]: unknown }
): Promise<string> {
  const { prisma } = await import('../../src/db/prisma.js');
  let user = await prisma.user.findUnique({ where: { id: claims.id } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: claims.id,
        username: claims.username ?? claims.id,
        passwordHash: 'test-only',
        role: claims.role,
        tokenVersion: 0,
      },
    });
  } else if (user.role !== claims.role) {
    user = await prisma.user.update({ where: { id: claims.id }, data: { role: claims.role } });
  }
  invalidateSessionCache(claims.id);
  return app.jwt.sign({ ...claims, tv: user.tokenVersion ?? 0 } as any);
}

/** Gives an operator rights on a camera (a real CameraPermission row). */
export async function grantCamera(
  userId: string,
  cameraId: string,
  rights: Partial<Record<'canViewLive' | 'canViewPlayback' | 'canControlPtz' | 'canExportClips', boolean>>
): Promise<void> {
  const { prisma } = await import('../../src/db/prisma.js');
  const data = { canViewLive: false, canViewPlayback: false, canControlPtz: false, canExportClips: false, ...rights };
  const existing = await prisma.cameraPermission.findUnique({ where: { userId_cameraId: { userId, cameraId } } });
  if (existing) {
    await prisma.cameraPermission.update({ where: { userId_cameraId: { userId, cameraId } }, data });
  } else {
    await prisma.cameraPermission.create({ data: { userId, cameraId, ...data } });
  }
}
