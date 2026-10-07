import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMockPrisma } from './mocks/prisma.mock.js';

// The storage write probe really writes under the recordings root; give each test file a
// writable one (CI runners cannot write to the /var/recordings default)
if (!process.env.RECORDINGS_PATH) {
  process.env.RECORDINGS_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'vms-test-recordings-'));
}

// If no active PostgreSQL is reachable or in unit test mode, initialize global mock prisma
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('5432')) {
  (globalThis as any).prismaGlobal = createMockPrisma();
}
