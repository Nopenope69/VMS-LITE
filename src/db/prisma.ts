import { PrismaClient } from '@prisma/client';

declare global {
  // allow global `var` declarations in TypeScript
  var prismaGlobal: any;
}

if (!globalThis.prismaGlobal) {
  let useMock = process.env.USE_MOCK_DB === 'true';

  if (!useMock) {
    // Attempt a quick connection probe to PostgreSQL
    const probeClient = new PrismaClient({
      log: ['error'],
    });
    try {
      await Promise.race([
        probeClient.$connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('DB_CONNECT_TIMEOUT')), 1500)
        ),
      ]);
      globalThis.prismaGlobal = probeClient;
    } catch {
      await probeClient.$disconnect().catch(() => {});
      useMock = true;
      console.warn(
        '⚠️  [Database] PostgreSQL at localhost:5432 is unreachable. Automatically activating in-memory mock database mode.'
      );
    }
  }

  if (useMock && !globalThis.prismaGlobal) {
    const { createSeededMockPrisma } = await import('./mock-seed.js');
    globalThis.prismaGlobal = await createSeededMockPrisma();
    console.log(
      '✅ [Database] In-memory mock database active. Seeded admin/operator accounts, cameras, & events.'
    );
  }
}

export const prisma = globalThis.prismaGlobal;
export default prisma;
