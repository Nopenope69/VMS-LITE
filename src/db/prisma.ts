import { PrismaClient } from '@prisma/client';

declare global {
  // allow global `var` declarations in TypeScript
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma =
  globalThis.prismaGlobal ??
  new PrismaClient({
    log: [], // Suppress noisy unhandled DB connection logs during standalone evaluation mode
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

export default prisma;
