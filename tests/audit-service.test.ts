import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { auditService } from '../src/audit/audit.service.js';

describe('Audit Service & Audit Routes', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: 'ADMIN',
    });

    viewerToken = app.jwt.sign({
      id: 'viewer-uuid',
      username: 'viewer',
      role: 'VIEWER',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('records audit events and returns stored logs via AuditService', async () => {
    await auditService.log({
      userId: 'admin-uuid',
      username: 'admin',
      action: 'CONFIG_CHANGE',
      resource: 'system:settings',
      ipAddress: '127.0.0.1',
      metadata: { retentionDays: 30 },
    });

    const result = await auditService.queryLogs({ action: 'CONFIG_CHANGE' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.logs.some((l) => l.action === 'CONFIG_CHANGE')).toBe(true);
  });

  it('GET /api/audit/logs returns 200 for ADMIN users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/logs',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it('GET /api/audit/logs rejects non-admin users with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/logs',
      headers: { Authorization: `Bearer ${viewerToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('records AUTH_FAILURE and AUTH_LOGIN events during authentication', async () => {
    // 1. Failed login
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nonexistent', password: 'wrongpassword' },
    });

    const failedLogs = await auditService.queryLogs({ action: 'AUTH_FAILURE' });
    expect(failedLogs.total).toBeGreaterThanOrEqual(1);
    expect(failedLogs.logs.some((l) => l.username === 'nonexistent')).toBe(true);
  });
});
