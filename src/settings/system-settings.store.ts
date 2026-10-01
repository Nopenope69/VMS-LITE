import { prisma as defaultPrisma } from '../db/prisma.js';

/**
 * Durable key/value store for appliance-level configuration (system_settings table).
 * Keeps operational settings, setup state and generated secrets across restarts.
 */
export class SystemSettingsStore {
  constructor(private readonly prisma: any = defaultPrisma) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as any },
      update: { value: value as any },
    });
  }
}

export const systemSettingsStore = new SystemSettingsStore();
