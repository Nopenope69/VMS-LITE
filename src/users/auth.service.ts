import bcrypt from 'bcrypt';
import { PrismaClient, Role, User } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';

export class AuthService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async verifyCredentials(username: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return null;
    }

    const isValid = await this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    return user;
  }

  async createUser(username: string, password: string, role: Role = Role.VIEWER): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new Error(`User with username '${username}' already exists`);
    }

    const passwordHash = await this.hashPassword(password);
    return this.prisma.user.create({
      data: {
        username,
        passwordHash,
        role,
      },
    });
  }

  async seedInitialAdmin(
    defaultUsername = 'admin',
    defaultPassword = 'admin123'
  ): Promise<User | null> {
    const count = await this.prisma.user.count();
    if (count > 0) {
      return null; // Users already exist
    }

    const admin = await this.createUser(defaultUsername, defaultPassword, Role.ADMIN);
    return admin;
  }

  async listUsers(): Promise<Array<Omit<User, 'passwordHash'>>> {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getUserPermissions(userId: string) {
    return this.prisma.cameraPermission.findMany({
      where: { userId },
      include: {
        camera: {
          select: { id: true, name: true, status: true },
        },
      },
    });
  }

  async setUserPermissions(
    userId: string,
    permissions: Array<{
      cameraId: string;
      canViewLive?: boolean;
      canViewPlayback?: boolean;
      canControlPtz?: boolean;
      canExportClips?: boolean;
    }>
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error(`User with id '${userId}' not found`);
    }

    const results = [];
    for (const p of permissions) {
      const upserted = await this.prisma.cameraPermission.upsert({
        where: {
          userId_cameraId: {
            userId,
            cameraId: p.cameraId,
          },
        },
        create: {
          userId,
          cameraId: p.cameraId,
          canViewLive: p.canViewLive ?? true,
          canViewPlayback: p.canViewPlayback ?? true,
          canControlPtz: p.canControlPtz ?? false,
          canExportClips: p.canExportClips ?? false,
        },
        update: {
          canViewLive: p.canViewLive,
          canViewPlayback: p.canViewPlayback,
          canControlPtz: p.canControlPtz,
          canExportClips: p.canExportClips,
        },
      });
      results.push(upserted);
    }
    return results;
  }
}
