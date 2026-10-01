import bcrypt from 'bcrypt';
import { PrismaClient, Role, User } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { invalidateSessionCache } from './session.js';

export const MIN_PASSWORD_LENGTH = 8;

export class UserAdminError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'UserAdminError';
  }
}

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

  async listUsers(): Promise<Array<Omit<User, 'passwordHash' | 'tokenVersion'>>> {
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

  /** JWT claims for a user; `tv` ties the token to the user's current tokenVersion. */
  tokenClaims(user: Pick<User, 'id' | 'username' | 'role' | 'tokenVersion'>) {
    return { id: user.id, username: user.username, role: user.role, tv: user.tokenVersion ?? 0 };
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserAdminError(`User with id '${userId}' not found`, 404);
    return user;
  }

  private async assertNotLastAdmin(user: User): Promise<void> {
    if (user.role !== Role.ADMIN) return;
    const admins = await this.prisma.user.count({ where: { role: Role.ADMIN } });
    if (admins <= 1) {
      throw new UserAdminError('Cannot remove or demote the last administrator', 409);
    }
  }

  /** Invalidates every token issued to the user. */
  async revokeSessions(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: (user.tokenVersion ?? 0) + 1 },
    });
    invalidateSessionCache(userId);
    return updated;
  }

  async updateRole(userId: string, role: Role, actorId: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (user.role === role) return user;
    if (userId === actorId) throw new UserAdminError('You cannot change your own role', 409);
    if (role !== Role.ADMIN) await this.assertNotLastAdmin(user);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role, tokenVersion: (user.tokenVersion ?? 0) + 1 },
    });
    invalidateSessionCache(userId);
    return updated;
  }

  async deleteUser(userId: string, actorId: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (userId === actorId) throw new UserAdminError('You cannot delete your own account', 409);
    await this.assertNotLastAdmin(user);
    await this.prisma.user.delete({ where: { id: userId } });
    invalidateSessionCache(userId);
    return user;
  }

  async resetPassword(userId: string, newPassword: string): Promise<User> {
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new UserAdminError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }
    const user = await this.requireUser(userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(newPassword), tokenVersion: (user.tokenVersion ?? 0) + 1 },
    });
    invalidateSessionCache(userId);
    return updated;
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (!(await this.verifyPassword(currentPassword || '', user.passwordHash))) {
      throw new UserAdminError('Current password is incorrect', 403);
    }
    return this.resetPassword(userId, newPassword);
  }
}
