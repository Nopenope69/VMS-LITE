import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { Role } from '@prisma/client';
import { signAs } from './helpers/auth.js';

describe('Graceful Shutdown & Process Signal Handlers', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = await signAs(app, {
      id: 'admin-uuid',
      username: 'admin',
      role: Role.ADMIN,
    });

    operatorToken = await signAs(app, {
      id: 'operator-uuid',
      username: 'operator',
      role: Role.OPERATOR,
    });
  });

  afterAll(async () => {
    // App may already be closed by shutdown tests; ignore error
    try { await app.close(); } catch { /* already closed */ }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects shutdown without authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/shutdown',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects shutdown from non-admin users', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/shutdown',
      headers: {
        authorization: `Bearer ${operatorToken}`,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('POST /api/system/shutdown returns 200 with shutdown message (admin only)', async () => {
    // Mock process.kill and app.close to prevent actual shutdown
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const closeSpy = vi.spyOn(app, 'close').mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/system/shutdown',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe(
      'Shutdown initiated. Service will restart via process manager.'
    );

    // Verify app.close() was called (recording engine flush via onClose hook)
    expect(closeSpy).toHaveBeenCalled();

    // Wait for the 500ms setTimeout to fire so process.kill gets called
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('shutdown endpoint calls process.kill with SIGTERM after delay, not immediately', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const closeSpy = vi.spyOn(app, 'close').mockResolvedValue(undefined);

    await app.inject({
      method: 'POST',
      url: '/api/system/shutdown',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    // Should not be called immediately (500ms delay)
    expect(killSpy).not.toHaveBeenCalled();

    // Wait for the delayed SIGTERM
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });
});
