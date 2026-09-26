import { createMockPrisma } from './mocks/prisma.mock.js';

// If no active PostgreSQL is reachable or in unit test mode, initialize global mock prisma
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('5432')) {
  (globalThis as any).prismaGlobal = createMockPrisma();
}
