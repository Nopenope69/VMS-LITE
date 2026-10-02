import { describe, it, expect } from 'vitest';
import { invalidateSessionCache, isSessionValid } from '../src/users/session.js';

describe('Session cache and revocation', () => {
  it('does not let a lookup that started before a revocation re-validate the old token', async () => {
    let tokenVersion = 0;
    let releaseSlowRead!: () => void;
    let slow = true;
    const prisma = {
      user: {
        findUnique: async () => {
          const snapshot = { role: 'ADMIN', tokenVersion };
          if (slow) {
            slow = false;
            await new Promise<void>((r) => (releaseSlowRead = r)); // read happened, reply delayed
          }
          return snapshot;
        },
      },
    };
    const oldToken = { id: 'race-user', username: 'u', role: 'ADMIN' as any, tv: 0 };

    // A request with the old token is mid-lookup when the password changes
    const inFlight = isSessionValid(oldToken, prisma);
    await new Promise((r) => setTimeout(r, 0));
    tokenVersion = 1; // password change bumps tokenVersion...
    invalidateSessionCache('race-user'); // ...and invalidates the cache
    releaseSlowRead();
    expect(await inFlight).toBe(true); // that request was already under way

    // Every later request must see the revocation, not a cached stale "valid"
    expect(await isSessionValid(oldToken, prisma)).toBe(false);
    expect(await isSessionValid({ ...oldToken, tv: 1 }, prisma)).toBe(true);
  });
});
