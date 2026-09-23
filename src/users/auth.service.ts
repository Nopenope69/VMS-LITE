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
}
