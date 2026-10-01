import { PrismaClient } from '@prisma/client';

declare global {
  // allow global `var` declarations in TypeScript
  var prismaGlobal: any;
}

/**
 * Database client selection.
 *
 * Production always uses PostgreSQL. The seeded in-memory mock is only used when
 * explicitly requested with USE_MOCK_DB=true (UI demos / local development).
 * There is deliberately no automatic fallback: silently swapping to an in-memory
 * store on a slow Postgres start would lose all data and expose demo credentials.
 * Connection readiness is handled by waitForDatabase() at boot.
 */
if (!globalThis.prismaGlobal) {
  if (process.env.USE_MOCK_DB === 'true') {
    const { createSeededMockPrisma } = await import('./mock-seed.js');
    globalThis.prismaGlobal = await createSeededMockPrisma();
    console.warn(
      '⚠️  [Database] USE_MOCK_DB=true: using in-memory demo database. Data is NOT persisted.'
    );
  } else {
    globalThis.prismaGlobal = new PrismaClient({ log: ['error'] });
  }
}

export const prisma = globalThis.prismaGlobal;
export default prisma;

/**
 * Blocks until the database accepts connections, retrying with backoff.
 * Throws after `timeoutMs` so the process exits and the supervisor restarts it.
 */
export async function waitForDatabase(timeoutMs = 60_000): Promise<void> {
  if (typeof prisma.$connect !== 'function') {
    return; // In-memory mock
  }
  const deadline = Date.now() + timeoutMs;
  let delayMs = 500;
  for (;;) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (Date.now() + delayMs > deadline) {
        throw new Error(`Database unreachable after ${timeoutMs}ms: ${(err as Error).message}`);
      }
      console.warn(`[Database] Waiting for PostgreSQL (${(err as Error).message.split('\n')[0]})`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 5_000);
    }
  }
}
