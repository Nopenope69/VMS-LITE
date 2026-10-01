import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { AuthService } from '../src/users/auth.service.js';
import { LoginThrottle } from '../src/users/login-throttle.js';
import { HandoffService } from '../src/system/handoff.service.js';

describe('Security hardening', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
    adminToken = app.jwt.sign({ id: 'sec-admin', username: 'sec-admin', role: 'ADMIN' });
    viewerToken = app.jwt.sign({ id: 'sec-viewer', username: 'sec-viewer', role: 'VIEWER' });
    operatorToken = app.jwt.sign({ id: 'sec-operator', username: 'sec-operator', role: 'OPERATOR' });
    await new AuthService().createUser('throttled-user', 'correct-horse-battery');
  });

  afterAll(async () => {
    await app.close();
  });

  it('throttles repeated failed logins and keeps rejecting even the right password while blocked', async () => {
    const attempt = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '203.0.113.9',
        payload: { username: 'throttled-user', password },
      });

    for (let i = 0; i < 5; i++) {
      expect((await attempt('wrong')).statusCode).toBe(401);
    }
    const blocked = await attempt('correct-horse-battery');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('LoginThrottle releases after the window and resets on success', () => {
    let now = 0;
    const throttle = new LoginThrottle(2, 100, 1000, () => now);
    throttle.recordFailure('ip', 'u');
    throttle.recordFailure('ip', 'u');
    expect(throttle.retryAfterSeconds('ip', 'u')).toBe(1);
    now = 1000;
    expect(throttle.retryAfterSeconds('ip', 'u')).toBe(0);
    throttle.recordFailure('ip', 'u');
    throttle.recordSuccess('ip', 'u');
    expect(throttle.retryAfterSeconds('ip', 'u')).toBe(0);
  });

  it('rejects short passwords and unknown roles when creating users', async () => {
    const short = await app.inject({
      method: 'POST',
      url: '/api/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: 'shorty', password: '1234' },
    });
    expect(short.statusCode).toBe(400);

    const badRole = await app.inject({
      method: 'POST',
      url: '/api/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: 'root2', password: 'long-enough-pass', role: 'SUPERUSER' },
    });
    expect(badRole.statusCode).toBe(400);
  });

  it('only admins may make the server probe arbitrary hosts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cameras/probe-network',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { ip: '10.0.0.1', port: 22 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('enforces operator camera grants on the playback API', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/playback/timeline?cameraId=some-camera&date=2026-10-01',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('escapes user-supplied text in the handoff certificate', async () => {
    const html = await new HandoffService().generateHtmlReport({
      siteName: '<script>alert(1)</script>',
      clientName: '"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});
