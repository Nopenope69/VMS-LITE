import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { EventBus } from '../src/events/event-bus.js';
import { TokenBucketRateLimiter } from '../src/notifications/token-bucket-rate-limiter.js';
import { MockSmtpTransport } from '../src/notifications/smtp-client.js';
import { SmtpDispatcherService, smtpDispatcherService } from '../src/notifications/smtp-dispatcher.service.js';
import { Role } from '@prisma/client';
import { signAs } from './helpers/auth.js';

describe('Built-in SMTP Email Alerting Subsystem (Phase 19 - Plan 01 - MVP-12)', () => {
  let mockTransport: MockSmtpTransport;
  let testEventBus: EventBus;
  let testRateLimiter: TokenBucketRateLimiter;
  let service: SmtpDispatcherService;

  beforeEach(() => {
    mockTransport = new MockSmtpTransport();
    testEventBus = new EventBus();
    testRateLimiter = new TokenBucketRateLimiter();

    service = new SmtpDispatcherService({
      eventBus: testEventBus,
      rateLimiter: testRateLimiter,
      transport: mockTransport,
    });

    service.updateConfig({
      host: 'smtp.testrelay.lan',
      port: 587,
      user: 'alerts@testrelay.lan',
      pass: 'SecretPassword123',
      from: 'Basic VMS <alerts@testrelay.lan>',
      recipients: ['security-lead@company.lan', 'admin@company.lan'],
      cooldownSeconds: 60,
      events: ['motion.detected', 'camera.offline', 'storage.warning'],
      enabled: true,
    });
  });

  afterEach(() => {
    service.stop();
  });

  it('securely manages and masks credentials without leaking plain text passwords', () => {
    const config = service.getConfig();
    expect(config.host).toBe('smtp.testrelay.lan');
    expect(config.port).toBe(587);
    expect(config.hasPassword).toBe(true);
    expect((config as any).pass).toBeUndefined(); // Password field must not exist in DTO

    // Updating with masked password placeholder does not erase the underlying password
    service.updateConfig({ pass: '********', host: 'smtp.newhost.lan' });
    const updated = service.getConfig();
    expect(updated.host).toBe('smtp.newhost.lan');
    expect(updated.hasPassword).toBe(true);
  });

  it('formats high-contrast HTML email with IST timestamp, incident badge, and timeline playback deep link', () => {
    const timestampIso = '2026-09-27T03:30:00.000Z';
    const alert = service.generateHtmlAlert(
      'motion.detected',
      'Warehouse Gate Camera',
      'cam-warehouse-01',
      timestampIso,
      { zoneName: 'Perimeter Exclusion 1' }
    );

    expect(alert.subject).toContain('[Basic VMS]');
    expect(alert.subject).toContain('Motion Alert: Warehouse Gate Camera');
    expect(alert.subject).toContain('IST');

    // Verify HTML contents
    expect(alert.html).toContain('MOTION DETECTED');
    expect(alert.html).toContain('Warehouse Gate Camera');
    expect(alert.html).toContain('Perimeter Exclusion 1');
    expect(alert.html).toContain('Open 24h Timeline Playback');
    expect(alert.html).toContain('/playback?cameraId=cam-warehouse-01');
  });

  it('dispatches test email to configured or custom recipient', async () => {
    const result = await service.sendTestAlert('test-operator@company.lan');
    expect(result.success).toBe(true);
    expect(result.messageId).toContain('mock-');

    expect(mockTransport.sentMails).toHaveLength(1);
    expect(mockTransport.sentMails[0].to).toEqual(['test-operator@company.lan']);
    expect(mockTransport.sentMails[0].subject).toContain('Test Email Notification');
    expect(mockTransport.sentMails[0].html).toContain('Basic VMS Email Dispatch Test');
  });

  it('subscribes to EventBus and dispatches alerts on motion.detected with anti-flood cooldown', async () => {
    await service.start();

    // 1. First motion alert on cam-01 -> should be dispatched
    await testEventBus.emitEvent({
      type: 'motion.detected',
      source: 'onvif',
      cameraId: 'cam-01',
      timestamp: new Date().toISOString(),
      metadata: { cameraName: 'Front Entrance' },
    });

    expect(mockTransport.sentMails).toHaveLength(1);
    expect(mockTransport.sentMails[0].subject).toContain('Motion Alert: Front Entrance');
    expect(mockTransport.sentMails[0].to).toEqual(['security-lead@company.lan', 'admin@company.lan']);

    // 2. Immediate second motion alert on same cam-01 -> suppressed by 60s rate limit
    await testEventBus.emitEvent({
      type: 'motion.detected',
      source: 'onvif',
      cameraId: 'cam-01',
      timestamp: new Date().toISOString(),
      metadata: { cameraName: 'Front Entrance' },
    });

    expect(mockTransport.sentMails).toHaveLength(1); // Still 1

    // 3. Motion alert on DIFFERENT camera cam-02 -> should be dispatched immediately
    await testEventBus.emitEvent({
      type: 'motion.detected',
      source: 'onvif',
      cameraId: 'cam-02',
      timestamp: new Date().toISOString(),
      metadata: { cameraName: 'Backyard Alley' },
    });

    expect(mockTransport.sentMails).toHaveLength(2);
    expect(mockTransport.sentMails[1].subject).toContain('Motion Alert: Backyard Alley');

    // 4. Storage warning alert -> should be dispatched
    await testEventBus.emitEvent({
      type: 'storage.warning',
      source: 'storage-controller',
      cameraId: 'system',
      timestamp: new Date().toISOString(),
      metadata: { usedPercent: 88 },
    });

    expect(mockTransport.sentMails).toHaveLength(3);
    expect(mockTransport.sentMails[2].subject).toContain('Storage Pool Warning');
    expect(mockTransport.sentMails[2].html).toContain('88%');
  });

  describe('Fastify REST API Routes (/api/notifications/smtp)', () => {
    let app: FastifyInstance;
    let adminToken: string;
    let operatorToken: string;
    let viewerToken: string;

    beforeEach(async () => {
      app = await createServer({ logger: false });
      await app.ready();

      // Hook mock transport to singleton service used by server
      smtpDispatcherService.setTransport(mockTransport);

      adminToken = await signAs(app, { id: 'usr-admin', username: 'admin', role: Role.ADMIN });
      operatorToken = await signAs(app, { id: 'usr-operator', username: 'operator', role: Role.OPERATOR });
      viewerToken = await signAs(app, { id: 'usr-viewer', username: 'viewer', role: Role.VIEWER });
    });

    afterEach(async () => {
      await app.close();
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications/smtp',
      });
      expect(res.statusCode).toBe(401);
    });

    it('allows Operator and Admin to fetch SMTP settings', async () => {
      // Operator
      const opRes = await app.inject({
        method: 'GET',
        url: '/api/notifications/smtp',
        headers: { Authorization: `Bearer ${operatorToken}` },
      });
      expect(opRes.statusCode).toBe(200);
      const opBody = JSON.parse(opRes.body);
      expect(opBody).toHaveProperty('host');
      expect(opBody).toHaveProperty('port');
      expect(opBody).toHaveProperty('hasPassword');

      // Admin
      const adminRes = await app.inject({
        method: 'GET',
        url: '/api/notifications/smtp',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(adminRes.statusCode).toBe(200);
    });

    it('forbids Operator from modifying SMTP settings or dispatching test emails (403)', async () => {
      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/notifications/smtp',
        headers: { Authorization: `Bearer ${operatorToken}` },
        payload: { host: 'smtp.hacked.lan' },
      });
      expect(putRes.statusCode).toBe(403);

      const testRes = await app.inject({
        method: 'POST',
        url: '/api/notifications/smtp/test',
        headers: { Authorization: `Bearer ${operatorToken}` },
        payload: { recipient: 'test@target.com' },
      });
      expect(testRes.statusCode).toBe(403);
    });

    it('allows Admin to update SMTP settings and dispatch test email', async () => {
      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/notifications/smtp',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          requireTls: false,
          user: 'security@mycctv.com',
          pass: 'mypassword',
          recipients: ['duty-officer@mycctv.com'],
          cooldownSeconds: 45,
        },
      });
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.host).toBe('smtp.gmail.com');
      expect(putBody.port).toBe(465);
      expect(putBody.secure).toBe(true);
      expect(putBody.recipients).toEqual(['duty-officer@mycctv.com']);
      expect(putBody.hasPassword).toBe(true);

      const testRes = await app.inject({
        method: 'POST',
        url: '/api/notifications/smtp/test',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { recipient: 'duty-officer@mycctv.com' },
      });
      expect(testRes.statusCode).toBe(200);
      const testBody = JSON.parse(testRes.body);
      expect(testBody.success).toBe(true);
      expect(testBody.messageId).toBeDefined();
    });
  });
});
