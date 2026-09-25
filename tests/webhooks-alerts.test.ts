import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { TokenBucketRateLimiter } from '../src/notifications/token-bucket-rate-limiter.js';
import {
  NotificationService,
  MockNotificationDispatcher,
  notificationService,
} from '../src/notifications/notification-dispatcher.service.js';
import {
  WebhookDispatcherService,
  webhookDispatcherService,
} from '../src/webhooks/webhook-dispatcher.service.js';
import { ALLOWED_WEBHOOK_EVENTS } from '../src/webhooks/webhook.types.js';
import { EventBus } from '../src/events/event-bus.js';

describe('WhatsApp Alerts & Outbound Webhooks (Phase 12 - Plan 02 - EXT-07, EXT-08)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-1',
      username: 'admin',
      role: Role.ADMIN,
    });

    operatorToken = app.jwt.sign({
      id: 'op-1',
      username: 'operator',
      role: Role.OPERATOR,
    });

    viewerToken = app.jwt.sign({
      id: 'view-1',
      username: 'viewer',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    notificationService.mockDispatcher.clear();
    webhookDispatcherService.reset();
  });

  describe('1. Token-Bucket Rate Limiter & Anti-Spam Cooldown', () => {
    it('enforces mandatory 60-second cooldown per (cameraId:eventType) key', () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 3, cooldownSeconds: 60 });
      const key = 'cam-1:motion.detected';

      // First acquire: permitted
      const first = limiter.tryAcquire(key);
      expect(first.allowed).toBe(true);

      // Immediate second acquire: blocked by 60s cooldown
      const second = limiter.tryAcquire(key);
      expect(second.allowed).toBe(false);
      expect(second.reason).toContain('Anti-spam cooldown active');
      expect(second.waitSeconds).toBeGreaterThanOrEqual(59);

      // Different event type on same camera: permitted (independent key)
      const diffEvent = limiter.tryAcquire('cam-1:camera.offline');
      expect(diffEvent.allowed).toBe(true);
    });

    it('enforces token bucket burst capacity exhaustion', () => {
      let now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);

      // Limiter with 0s cooldown to test token bucket capacity independently
      const limiter = new TokenBucketRateLimiter({ capacity: 2, cooldownSeconds: 0 });
      const key = 'cam-burst';

      // 1st token consumed (1 remaining)
      expect(limiter.tryAcquire(key).allowed).toBe(true);

      // 2nd token consumed (0 remaining)
      expect(limiter.tryAcquire(key).allowed).toBe(true);

      // 3rd attempt: capacity exhausted
      const third = limiter.tryAcquire(key);
      expect(third.allowed).toBe(false);
      expect(third.reason).toContain('Token bucket capacity exhausted');

      // Advance time by 60s (refills 1 token)
      now += 60_000;
      expect(limiter.tryAcquire(key).allowed).toBe(true);
    });
  });

  describe('2. WhatsApp Alert Formatting & Signed Snapshot Delivery', () => {
    it('formats IST timestamps and structured alert message with signed snapshot URL', () => {
      const service = new NotificationService();
      const signedUrl = service.generateSignedSnapshotUrl('cam-101', 'https://vms.example.com');

      expect(signedUrl).toContain('https://vms.example.com/api/cameras/cam-101/snapshot');
      expect(signedUrl).toContain('expires=');
      expect(signedUrl).toContain('sig=');

      const istTime = service.formatIstTimestamp(new Date('2026-09-25T08:15:22.000Z'));
      expect(istTime).toContain('IST');

      const message = service.formatAlertMessage('motion.detected', 'Front Porch', istTime, signedUrl);
      expect(message).toContain('*VMS ALERT: Motion Detected*');
      expect(message).toContain('Front Porch');
      expect(message).toContain(signedUrl);
    });

    it('filters out camera.degraded events unless explicitly configured in events list', async () => {
      const mockBus = new EventBus();
      const mockDispatcher = new MockNotificationDispatcher();
      const service = new NotificationService({
        eventBus: mockBus,
        mockDispatcher,
      });

      // Default events: motion.detected, camera.offline
      await service.updateConfig({
        provider: 'mock',
        recipientPhones: ['+919876543210'],
        events: ['motion.detected', 'camera.offline'],
        enabled: true,
      });

      await service.start();

      // Emit camera.degraded event -> should be ignored
      await mockBus.emitEvent({
        type: 'camera.degraded',
        cameraId: 'cam-deg',
        source: 'test',
        metadata: { cameraName: 'Backyard' },
      });

      expect(mockDispatcher.dispatches.length).toBe(0);

      // Enable camera.degraded in config
      await service.updateConfig({
        events: ['motion.detected', 'camera.offline', 'camera.degraded'],
      });

      // Emit camera.degraded event again -> should be dispatched
      await mockBus.emitEvent({
        type: 'camera.degraded',
        cameraId: 'cam-deg-2',
        source: 'test',
        metadata: { cameraName: 'Backyard 2' },
      });

      expect(mockDispatcher.dispatches.length).toBe(1);
      expect(mockDispatcher.dispatches[0].eventType).toBe('camera.degraded');

      service.stop();
    });

    it('masks sensitive credentials in GET response and preserves them on PUT when masked placeholder sent', async () => {
      const service = new NotificationService();

      // Set credentials
      await service.updateConfig({
        provider: 'whatsapp_cloud',
        credentialsJson: JSON.stringify({ accessToken: 'super_secret_access_token_12345', phoneNumberId: '10992' }),
      });

      const config = await service.getConfig();
      expect(config.credentialsJson).toContain('whsec_');
      expect(config.credentialsJson).not.toContain('super_secret_access_token_12345');

      // Update unrelated field with masked credentials sent back
      await service.updateConfig({
        cooldownSeconds: 45,
        credentialsJson: config.credentialsJson, // masked placeholder
      });

      // Verify unmasked secret was preserved in dispatcher
      const dispatcher = service.whatsappCloudDispatcher;
      const creds = (dispatcher as any).getCredentials();
      expect(creds.accessToken).toBe('super_secret_access_token_12345');
    });
  });

  describe('3. Cryptographic HMAC-SHA256 Outbound Webhooks', () => {
    it('computes HMAC-SHA256 signature binding timestamp and raw body', () => {
      const service = new WebhookDispatcherService();
      const secret = 'whsec_test_secret_1234567890';
      const timestamp = '2026-09-25T08:00:00.000Z';
      const rawBody = JSON.stringify({ event: 'motion.detected', camera: 'cam-1' });

      const sig = service.computeSignature(secret, timestamp, rawBody);
      expect(sig.startsWith('sha256=')).toBe(true);

      // Verify mathematically
      const expectedHmac = crypto.createHmac('sha256', secret);
      expectedHmac.update(`${timestamp}.${rawBody}`);
      expect(sig).toBe(`sha256=${expectedHmac.digest('hex')}`);
    });

    it('re-uses identical X-VMS-Delivery UUID across all retry attempts for receiver idempotency', async () => {
      const service = new WebhookDispatcherService({ allowPrivateIpsForTesting: true });
      const capturedHeaders: Headers[] = [];

      // Mock fetch that fails twice (500) and succeeds on 3rd attempt (200)
      let attemptCount = 0;
      global.fetch = vi.fn().mockImplementation(async (_url, opts) => {
        attemptCount++;
        capturedHeaders.push(new Headers(opts.headers));
        if (attemptCount < 2) {
          return { status: 500, ok: false, text: async () => 'Internal Server Error' };
        }
        return { status: 200, ok: true, text: async () => 'OK' };
      }) as any;

      const job = {
        deliveryId: 'idempotent-uuid-001',
        endpointId: 'ep-1',
        endpointName: 'Turnstile',
        url: 'http://127.0.0.1:8080/hook',
        secret: 'whsec_secret_1234',
        eventType: 'motion.detected',
        payload: {
          eventId: 'evt-1',
          eventType: 'motion.detected',
          timestamp: new Date().toISOString(),
          cameraId: 'cam-1',
          data: {},
        },
        attempts: 0,
        maxAttempts: 3,
        nextAttemptTime: Date.now(),
      };

      // Attempt 1 (fails 500)
      const res1 = await service.executeDelivery(job);
      expect(res1.success).toBe(false);

      // Attempt 2 (succeeds 200)
      const res2 = await service.executeDelivery(job);
      expect(res2.success).toBe(true);

      // Verify both attempts transmitted the EXACT SAME X-VMS-Delivery header
      expect(capturedHeaders.length).toBe(2);
      expect(capturedHeaders[0].get('X-VMS-Delivery')).toBe('idempotent-uuid-001');
      expect(capturedHeaders[1].get('X-VMS-Delivery')).toBe('idempotent-uuid-001');
      expect(capturedHeaders[0].get('X-VMS-Signature')).toBeDefined();
    });

    it('terminates immediately without retry on client error (4xx)', async () => {
      const service = new WebhookDispatcherService({ allowPrivateIpsForTesting: true });

      global.fetch = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        text: async () => 'Not Found',
      }) as any;

      const job = {
        deliveryId: 'test-404-uuid',
        endpointId: 'ep-404',
        endpointName: 'Barrier',
        url: 'http://127.0.0.1:8080/bad-endpoint',
        secret: 'whsec_secret_1234',
        eventType: 'camera.offline',
        payload: { eventId: 'e-404', eventType: 'camera.offline', timestamp: new Date().toISOString(), cameraId: null, data: {} },
        attempts: 0,
        maxAttempts: 3,
        nextAttemptTime: Date.now(),
      };

      const result = await service.executeDelivery(job);
      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.error).toContain('Terminal client error (404)');
    });
  });

  describe('4. SSRF Defense-in-Depth & DNS Pre-Resolution', () => {
    it('detects and blocks private/loopback/cloud metadata IP addresses (IPv4 & IPv6)', () => {
      const service = new WebhookDispatcherService({ allowPrivateIpsForTesting: false });

      // IPv4 blocked
      expect(service.isPrivateOrBlockedIp('127.0.0.1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('169.254.169.254')).toBe(true);
      expect(service.isPrivateOrBlockedIp('10.0.0.1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('192.168.1.1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('172.16.0.1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('172.31.255.255')).toBe(true);

      // IPv6 blocked
      expect(service.isPrivateOrBlockedIp('::1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('fe80::1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('fc00::1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('fd12:3456:789a::1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('::ffff:127.0.0.1')).toBe(true);
      expect(service.isPrivateOrBlockedIp('::ffff:169.254.169.254')).toBe(true);

      // Public IPs allowed
      expect(service.isPrivateOrBlockedIp('8.8.8.8')).toBe(false);
      expect(service.isPrivateOrBlockedIp('1.1.1.1')).toBe(false);
      expect(service.isPrivateOrBlockedIp('2606:4700:4700::1111')).toBe(false);
    });

    it('pre-resolves DNS and rejects hostnames that resolve to internal IPs (SSRF DNS rebinding guard)', async () => {
      const service = new WebhookDispatcherService({ allowPrivateIpsForTesting: false });

      // Simulate DNS lookup resolving to 169.254.169.254
      vi.spyOn(dns, 'lookup').mockResolvedValue({ address: '169.254.169.254', family: 4 });

      const check = await service.validateUrlSafety('https://evil-metadata.com/hook');
      expect(check.safe).toBe(false);
      expect(check.error).toContain('Resolved destination IP 169.254.169.254 belongs to blocked/private range');
    });

    it('rejects URLs with non-http/https protocol schemes', async () => {
      const service = new WebhookDispatcherService({ allowPrivateIpsForTesting: false });

      const ftp = await service.validateUrlSafety('ftp://example.com/hook');
      expect(ftp.safe).toBe(false);
      expect(ftp.error).toContain('Webhook URL protocol must be http: or https:');

      const file = await service.validateUrlSafety('file:///etc/passwd');
      expect(file.safe).toBe(false);
    });
  });

  describe('5. Webhook Wildcard Subscription Allowlist', () => {
    it('restricts wildcard ["*"] expansion strictly to ALLOWED_WEBHOOK_EVENTS', async () => {
      const service = new WebhookDispatcherService({ allowPrivateIpsForTesting: true });
      const mockBus = new EventBus();
      (service as any).eventBus = mockBus;

      const endpoint = await service.createEndpoint({
        name: 'Wildcard Sub',
        url: 'http://127.0.0.1:8080/hooks',
        events: ['*'],
      });

      await service.start();

      const enqueuedEvents: string[] = [];
      vi.spyOn(service, 'enqueueEvent').mockImplementation((_ep, ev) => {
        enqueuedEvents.push(ev.type);
      });

      // Allowed event: motion.detected
      await mockBus.emitEvent({ type: 'motion.detected', source: 'test' });
      await new Promise((r) => setTimeout(r, 25));
      expect(enqueuedEvents).toContain('motion.detected');

      // Internal event: user.password_changed -> must NEVER be forwarded
      await mockBus.emitEvent({ type: 'user.password_changed', source: 'auth' });
      await new Promise((r) => setTimeout(r, 25));
      expect(enqueuedEvents).not.toContain('user.password_changed');

      service.stop();
    });
  });

  describe('6. REST API Endpoints & RBAC / Capability Protection', () => {
    describe('/api/notifications', () => {
      it('GET /api/notifications/settings requires authentication and returns 401 without JWT', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/notifications/settings',
        });
        expect(res.statusCode).toBe(401);
      });

      it('GET /api/notifications/settings returns 403 Forbidden for OPERATOR role (ADMIN required)', async () => {
        const origHas = app.capabilities.has.bind(app.capabilities);
        vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
          if (cap === 'extended.whatsapp_alerts') return true;
          return origHas(cap);
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/notifications/settings',
          headers: { authorization: `Bearer ${operatorToken}` },
        });

        expect(res.statusCode).toBe(403);
        const body = res.json();
        expect(body.error).toBe('Forbidden');
      });

      it('GET /api/notifications/settings returns 403 when extended.whatsapp_alerts capability missing', async () => {
        vi.spyOn(app.capabilities, 'has').mockReturnValue(false);

        const res = await app.inject({
          method: 'GET',
          url: '/api/notifications/settings',
          headers: { authorization: `Bearer ${adminToken}` },
        });

        expect(res.statusCode).toBe(403);
        const body = res.json();
        expect(body.capability).toBe('extended.whatsapp_alerts');
      });

      it('GET and PUT /api/notifications/settings succeed for ADMIN with capability', async () => {
        const origHas = app.capabilities.has.bind(app.capabilities);
        vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
          if (cap === 'extended.whatsapp_alerts') return true;
          return origHas(cap);
        });

        const putRes = await app.inject({
          method: 'PUT',
          url: '/api/notifications/settings',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            provider: 'mock',
            recipientPhones: ['+919999988888'],
            cooldownSeconds: 90,
          },
        });

        expect(putRes.statusCode).toBe(200);
        const updated = putRes.json();
        expect(updated.recipientPhones).toEqual(['+919999988888']);
        expect(updated.cooldownSeconds).toBe(90);

        const getRes = await app.inject({
          method: 'GET',
          url: '/api/notifications/settings',
          headers: { authorization: `Bearer ${adminToken}` },
        });

        expect(getRes.statusCode).toBe(200);
        const fetched = getRes.json();
        expect(fetched.recipientPhones).toEqual(['+919999988888']);
      });

      it('POST /api/notifications/test sends test notification successfully', async () => {
        const origHas = app.capabilities.has.bind(app.capabilities);
        vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
          if (cap === 'extended.whatsapp_alerts') return true;
          return origHas(cap);
        });

        const res = await app.inject({
          method: 'POST',
          url: '/api/notifications/test',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { recipientPhone: '+919999900000' },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.success).toBe(true);
        expect(body.messageId).toBeDefined();
      });
    });

    describe('/api/webhooks', () => {
      it('GET /api/webhooks requires authentication and returns 401 without JWT', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/webhooks',
        });
        expect(res.statusCode).toBe(401);
      });

      it('GET /api/webhooks returns 403 Forbidden for OPERATOR role (ADMIN required)', async () => {
        const origHas = app.capabilities.has.bind(app.capabilities);
        vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
          if (cap === 'extended.api_webhooks') return true;
          return origHas(cap);
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/webhooks',
          headers: { authorization: `Bearer ${operatorToken}` },
        });

        expect(res.statusCode).toBe(403);
      });

      it('GET /api/webhooks returns 403 when extended.api_webhooks capability missing', async () => {
        vi.spyOn(app.capabilities, 'has').mockReturnValue(false);

        const res = await app.inject({
          method: 'GET',
          url: '/api/webhooks',
          headers: { authorization: `Bearer ${adminToken}` },
        });

        expect(res.statusCode).toBe(403);
        const body = res.json();
        expect(body.capability).toBe('extended.api_webhooks');
      });

      it('Performs complete CRUD lifecycle for webhooks with secret masking', async () => {
        const origHas = app.capabilities.has.bind(app.capabilities);
        vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => {
          if (cap === 'extended.api_webhooks') return true;
          return origHas(cap);
        });

        // 1. POST /api/webhooks (Create)
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/webhooks',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            name: 'Access Control Gateway',
            url: 'https://barrier.example.com/api/v1/event',
            events: ['motion.detected'],
          },
        });

        expect(createRes.statusCode).toBe(201);
        const created = createRes.json();
        expect(created.name).toBe('Access Control Gateway');
        expect(created.secret).toContain('whsec_');
        const webhookId = created.id;

        // 2. GET /api/webhooks (List)
        const listRes = await app.inject({
          method: 'GET',
          url: '/api/webhooks',
          headers: { authorization: `Bearer ${adminToken}` },
        });

        expect(listRes.statusCode).toBe(200);
        const list = listRes.json();
        const found = list.find((w: any) => w.id === webhookId);
        expect(found).toBeDefined();
        expect(found.secret).toContain('whsec_');

        // 3. PUT /api/webhooks/:id (Update)
        const updateRes = await app.inject({
          method: 'PUT',
          url: `/api/webhooks/${webhookId}`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            name: 'Updated Barrier Gateway',
            secret: found.secret, // masked secret sent back
          },
        });

        expect(updateRes.statusCode).toBe(200);
        const updated = updateRes.json();
        expect(updated.name).toBe('Updated Barrier Gateway');

        // 4. POST /api/webhooks/:id/test (Test Ping)
        vi.spyOn(webhookDispatcherService, 'executeDelivery').mockResolvedValue({
          success: true,
          status: 200,
        });

        const testRes = await app.inject({
          method: 'POST',
          url: `/api/webhooks/${webhookId}/test`,
          headers: { authorization: `Bearer ${adminToken}` },
        });

        expect(testRes.statusCode).toBe(200);
        const testBody = testRes.json();
        expect(testBody.success).toBe(true);
        expect(testBody.deliveryId).toBeDefined();

        // 5. DELETE /api/webhooks/:id (Delete)
        const deleteRes = await app.inject({
          method: 'DELETE',
          url: `/api/webhooks/${webhookId}`,
          headers: { authorization: `Bearer ${adminToken}` },
        });

        expect(deleteRes.statusCode).toBe(200);
      });
    });
  });
});
