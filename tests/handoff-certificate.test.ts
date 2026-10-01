import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { handoffService } from '../src/system/handoff.service.js';

describe('Installer Handoff Certificate Routes & Service', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates a full HTML acceptance certificate via HandoffService', async () => {
    const html = await handoffService.generateHtmlReport({
      siteName: 'Acme Logistics Hub',
      technicianName: 'Jane Doe',
      clientName: 'Security Director',
    });

    expect(html).toContain('INSTALLER ACCEPTANCE CERTIFICATE');
    expect(html).toContain('Acme Logistics Hub');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Security Director');
    expect(html).toContain('Appliance & Host Telemetry');
    expect(html).toContain('Storage Infrastructure & S.M.A.R.T. Health');
    expect(html).toContain('Certified Installer Acceptance:');
  });

  it('GET /api/system/handoff-report serves HTML with text/html content-type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/handoff-report?siteName=TestSite',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('TestSite');
    expect(res.payload).toContain('INSTALLER ACCEPTANCE CERTIFICATE');
  });
});
