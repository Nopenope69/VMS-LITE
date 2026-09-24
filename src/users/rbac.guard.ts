import { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';

export interface UserTokenPayload {
  id: string;
  username: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: UserTokenPayload;
    user: UserTokenPayload;
  }
}

/**
 * Pre-handler hook requiring a valid JWT session token.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required or token expired',
    });
  }
}

/**
 * Pre-handler hook enforcing single-site RBAC (ADMIN, OPERATOR, VIEWER).
 */
export function requireRole(allowedRoles: Role | Role[]) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Ensure authentication ran first
    if (!request.user) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
        return;
      }
    }

    if (!roles.includes(request.user.role)) {
      reply.status(403).send({
        error: 'Forbidden',
        message: `Insufficient role permissions. Required: [${roles.join(', ')}], current: ${request.user.role}`,
        requiredRoles: roles,
        currentRole: request.user.role,
      });
    }
  };
}

export type CameraPermissionKey =
  | 'canViewLive'
  | 'canViewPlayback'
  | 'canControlPtz'
  | 'canExportClips';

/**
 * Pre-handler hook enforcing per-camera permission ACLs for Operators.
 * - ADMIN: full access bypass
 * - VIEWER: allowed read-only access (live and playback), forbidden from control/export
 * - OPERATOR: requires explicit CameraPermission record with corresponding flag set to true
 */
export function requireCameraPermission(permission: CameraPermissionKey) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
        return;
      }
    }

    const { role, id: userId } = request.user;

    // Admin has full bypass across all cameras and actions
    if (role === Role.ADMIN) {
      return;
    }

    // Viewer has baseline read access across all cameras (Package 1 Core parity)
    if (role === Role.VIEWER) {
      if (permission === 'canControlPtz' || permission === 'canExportClips') {
        reply.status(403).send({
          error: 'Forbidden',
          message: `Viewers do not have permission to perform '${permission}'`,
          permission,
        });
      }
      return;
    }

    // Operator requires explicit per-camera permission
    if (role === Role.OPERATOR) {
      const params = request.params as { id?: string; cameraId?: string };
      const cameraId = params.id || params.cameraId;

      if (!cameraId) {
        return;
      }

      const { prisma } = await import('../db/prisma.js');
      const perm = await prisma.cameraPermission.findUnique({
        where: {
          userId_cameraId: {
            userId,
            cameraId,
          },
        },
      });

      if (!perm || !perm[permission]) {
        reply.status(403).send({
          error: 'Forbidden',
          message: `Operator lacks '${permission}' permission for camera '${cameraId}'`,
          cameraId,
          permission,
        });
      }
    }
  };
}
