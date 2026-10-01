import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { auditService } from '../src/audit/audit.service.js';

describe('Sub-Project D: Installer Handoff & Audit Security End-to-End', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    const { prisma } = await import('../src/db/prisma.js');
    await prisma.user.deleteMany({ where: { username: 'admin' } });
    await prisma.user.create({
      data: { id: 'admin-uuid-001', username: 'admin', passwordHash: 'x', role: 'ADMIN' },
    });

    adminToken = app.jwt.sign({
      id: 'admin-uuid-001',
      username: 'admin',
      role: 'ADMIN',
    });

    operatorToken = app.jwt.sign({
      id: 'operator-uuid-002',
      username: 'guard',
      role: 'OPERATOR',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('First-Boot Provisioning Flow', () => {
    it('queries setup status without authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/system/setup-status',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(typeof body.isFirstBoot).toBe('boolean');
      expect(typeof body.defaultPasswordActive).toBe('boolean');
      expect(typeof body.hostname).toBe('string');
      expect(Array.isArray(body.networkInterfaces)).toBe(true);
    });

    it('rejects setup-complete from non-admin role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/system/setup-complete',
        headers: { Authorization: `Bearer ${operatorToken}` },
        payload: {
          newPassword: 'new-strong-password-123',
          siteName: 'Warehouse 04 - Sector 18',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows admin to complete first-boot setup wizard', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/system/setup-complete',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          newPassword: 'new-strong-password-123',
          siteName: 'Connaught Place Retail Branch',
          timezone: 'Asia/Kolkata',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.message).toContain('completed successfully');

      // Verify setup status has updated
      const statusRes = await app.inject({
        method: 'GET',
        url: '/api/system/setup-status',
      });
      const statusBody = JSON.parse(statusRes.payload);
      expect(statusBody.isFirstBoot).toBe(false);
    });
  });

  describe('Audit Security & Access Logs', () => {
    it('records explicit audit entries in auditService', async () => {
      const record = await auditService.log({
        userId: 'admin-uuid-001',
        username: 'admin',
        action: 'SETTINGS_UPDATE',
        resource: 'system/setup',
        ipAddress: '127.0.0.1',
        metadata: { field: 'timezone', value: 'Asia/Kolkata' },
      });

      expect(record.id).toBeDefined();
      expect(record.action).toBe('SETTINGS_UPDATE');
      expect(record.username).toBe('admin');
      expect(record.timestamp).toBeInstanceOf(Date);
    });

    it('retrieves audit logs via GET /api/audit/logs for admin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit/logs?limit=50',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.logs)).toBe(true);
      expect(typeof body.total).toBe('number');
      expect(body.logs.length).toBeGreaterThanOrEqual(1);

      const log = body.logs[0];
      expect(log.id).toBeDefined();
      expect(log.action).toBeDefined();
      expect(log.timestamp).toBeDefined();
    });

    it('supports action filtering on GET /api/audit/logs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit/logs?action=SETTINGS_UPDATE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.logs.every((l: any) => l.action === 'SETTINGS_UPDATE')).toBe(true);
    });

    it('forbids non-admin users from reading audit logs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit/logs',
        headers: { Authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('Installer Handoff Acceptance Certificate', () => {
    it('serves printable HTML handoff report with text/html content-type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/system/handoff-report?clientName=Acme%20Logistics&technicianName=Ramesh%20Kumar',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');

      const html = res.payload;
      expect(html).toContain('INSTALLER ACCEPTANCE CERTIFICATE');
      expect(html).toContain('Acme Logistics');
      expect(html).toContain('Ramesh Kumar');
      expect(html).toContain('1. Appliance & Host Telemetry');
      expect(html).toContain('3. Storage Infrastructure & S.M.A.R.T. Health');
      expect(html).toContain('4. Commissioned Camera Fleet Roster');
      expect(html).toContain('Certified Installer Acceptance:');
    });
  });
});
