import { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';

export interface UserTokenPayload {
  id: string;
  username: string;
  role: Role;
  /** User.tokenVersion at issue time; absent on tokens issued before versioning (= 0). */
  tv?: number;
}

class SessionRevokedError extends Error {}

/** Verifies the JWT signature/expiry and that the session has not been revoked. */
async function verifyRequestSession(request: FastifyRequest): Promise<void> {
  await request.jwtVerify();
  const { isSessionValid } = await import('./session.js');
  if (!(await isSessionValid(request.user))) {
    throw new SessionRevokedError('Session revoked');
  }
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
    await verifyRequestSession(request);
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
        await verifyRequestSession(request);
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
