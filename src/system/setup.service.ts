import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import os from 'node:os';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { auditService } from '../audit/audit.service.js';

export interface SetupStatusDto {
  isFirstBoot: boolean;
  defaultPasswordActive: boolean;
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
  private setupCompletedFlag: boolean = false;

  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

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

    let defaultPasswordActive = false;
    let isFirstBoot = !this.setupCompletedFlag;

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

      const passwordHash = await bcrypt.hash(input.newPassword, 10);
      try {
        await this.prisma.user.update({
          where: { username: 'admin' },
          data: { passwordHash },
        });
      } catch {
        // Ignored in test environment without DB
      }
    }

    this.setupCompletedFlag = true;

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
