import { prisma as defaultPrisma } from '../db/prisma.js';
import type { UserTokenPayload } from './rbac.guard.js';

/**
 * Server-side session validity for stateless JWTs.
 *
 * A token is accepted only while its user still exists, still has the role in the
 * token, and its token version (`tv`, 0 for tokens issued before versioning) equals
 * the user's current tokenVersion. Deleting a user, changing their role or bumping
 * tokenVersion (password change, "sign out everywhere") therefore revokes all of
 * their tokens. Lookups are cached briefly because media requests (HLS parts) are
 * frequent; mutations call invalidateSessionCache() so they take effect at once.
 */

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { at: number; user: { role: string; tokenVersion: number } | null }>();
/**
 * Bumped on every invalidation. A lookup that started before a revocation must not
 * store what it read, or the revoked token would be accepted again until the TTL.
 */
const generations = new Map<string, number>();
let globalGeneration = 0;
const generationOf = (userId: string) => `${globalGeneration}:${generations.get(userId) ?? 0}`;

export async function isSessionValid(payload: UserTokenPayload, prisma: any = defaultPrisma): Promise<boolean> {
  if (!payload?.id) return false;
  let entry = cache.get(payload.id);
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
    const generation = generationOf(payload.id);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { role: true, tokenVersion: true },
    });
    entry = { at: Date.now(), user: user ? { role: user.role, tokenVersion: user.tokenVersion ?? 0 } : null };
    if (generationOf(payload.id) === generation) {
      cache.set(payload.id, entry);
      if (cache.size > 5_000) cache.delete(cache.keys().next().value!);
    }
  }
  return Boolean(entry.user && entry.user.role === payload.role && entry.user.tokenVersion === (payload.tv ?? 0));
}

export function invalidateSessionCache(userId?: string): void {
  if (userId) {
    generations.set(userId, (generations.get(userId) ?? 0) + 1);
    cache.delete(userId);
  } else {
    globalGeneration++;
    cache.clear();
  }
}
