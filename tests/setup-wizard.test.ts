import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { setupService } from '../src/system/setup.service.js';

describe('Setup Wizard Routes & Service', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    const { prisma } = await import('../src/db/prisma.js');
    await prisma.user.deleteMany({ where: { username: 'admin' } });
    await prisma.user.create({
      data: { id: 'admin-uuid', username: 'admin', passwordHash: 'x', role: 'ADMIN' },
    });

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/system/setup-status returns system provisioning status without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/setup-status',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(typeof body.isFirstBoot).toBe('boolean');
    expect(typeof body.defaultPasswordActive).toBe('boolean');
    expect(typeof body.hostname).toBe('string');
    expect(Array.isArray(body.networkInterfaces)).toBe(true);
  });

  it('POST /api/system/setup-complete requires ADMIN role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/setup-complete',
      payload: { siteName: 'Site 1' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/system/setup-complete updates configuration and marks setup complete', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/setup-complete',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        newPassword: 'newsecurepassword123',
        siteName: 'Main Warehouse Gate',
        timezone: 'Asia/Kolkata',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);

    const status = await setupService.getSetupStatus();
    expect(status.isFirstBoot).toBe(false);
  });
});
