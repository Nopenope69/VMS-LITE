import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import os from 'node:os';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { auditService } from '../audit/audit.service.js';
import { SystemSettingsStore } from '../settings/system-settings.store.js';

export interface SetupState {
  completed: boolean;
  siteName: string;
  timezone: string;
  completedAt: string | null;
}

const SETUP_STATE_KEY = 'setup.state';
const DEFAULT_SETUP_STATE: SetupState = {
  completed: false,
  siteName: 'Default Site',
  timezone: 'UTC',
  completedAt: null,
};

export interface SetupStatusDto {
  isFirstBoot: boolean;
  defaultPasswordActive: boolean;
  siteName: string;
  timezone: string;
  needsNetworkSetup: boolean;
  hostname: string;
  networkInterfaces: Array<{
    name: string;
    ipAddress: string;
    macAddress: string;
  }>;
}

export interface CompleteSetupInput {
  newPassword?: string;
  siteName?: string;
  timezone?: string;
}

export class SetupService {
  private readonly store: SystemSettingsStore;

  constructor(private readonly prisma: PrismaClient = defaultPrisma) {
    this.store = new SystemSettingsStore(prisma);
  }

  async getSetupState(): Promise<SetupState> {
    try {
      return { ...DEFAULT_SETUP_STATE, ...(await this.store.get(SETUP_STATE_KEY, DEFAULT_SETUP_STATE)) };
    } catch {
      return { ...DEFAULT_SETUP_STATE };
    }
  }

  async getSetupStatus(): Promise<SetupStatusDto> {
    const interfaces: SetupStatusDto['networkInterfaces'] = [];
    const ifaces = os.networkInterfaces();

    for (const [name, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (!addr.internal && addr.family === 'IPv4') {
          interfaces.push({
            name,
            ipAddress: addr.address,
            macAddress: addr.mac,
          });
        }
      }
    }

    const state = await this.getSetupState();
    let defaultPasswordActive = false;
    let isFirstBoot = !state.completed;

    try {
      const adminUser = await this.prisma.user.findUnique({
        where: { username: 'admin' },
      });

      if (adminUser) {
        // Compare with default password "admin123"
        defaultPasswordActive = await bcrypt.compare('admin123', adminUser.passwordHash);
        if (defaultPasswordActive) {
          isFirstBoot = true;
        }
      }
    } catch {
      // Offline fallback
      defaultPasswordActive = true;
    }

    return {
      isFirstBoot,
      defaultPasswordActive,
      siteName: state.siteName,
      timezone: state.timezone,
      needsNetworkSetup: interfaces.length === 0,
      hostname: os.hostname(),
      networkInterfaces: interfaces,
    };
  }

  async completeSetup(input: CompleteSetupInput, actorUserId?: string): Promise<{ success: boolean; message: string }> {
    if (input.newPassword) {
      if (input.newPassword.length < 8) {
        throw new Error('New password must be at least 8 characters long');
      }

      if (input.newPassword === 'admin123') {
        throw new Error('New password must differ from the factory default');
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 10);
      // Change the password of the admin running the wizard (falls back to the factory account)
      await this.prisma.user.update({
        where: actorUserId ? { id: actorUserId } : { username: 'admin' },
        data: { passwordHash },
      });
    }

    const previous = await this.getSetupState();
    await this.store.set<SetupState>(SETUP_STATE_KEY, {
      completed: true,
      siteName: input.siteName?.trim() || previous.siteName,
      timezone: input.timezone?.trim() || previous.timezone,
      completedAt: new Date().toISOString(),
    });

    await auditService.log({
      action: 'INITIAL_SETUP_COMPLETED',
      userId: actorUserId,
      username: 'admin',
      metadata: {
        siteName: input.siteName || 'Default Site',
        timezone: input.timezone || 'UTC',
      },
    });

    return {
      success: true,
      message: 'Initial appliance provisioning completed successfully',
    };
  }
}

export const setupService = new SetupService();
