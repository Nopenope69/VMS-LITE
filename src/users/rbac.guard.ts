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
 * Pre-handler hook enforcing single-site RBAC (ADMIN vs VIEWER).
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
