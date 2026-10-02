import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { AuthService } from '../src/users/auth.service.js';
import { signAs } from './helpers/auth.js';

/**
 * Tokens are stateless JWTs; these tests prove they still stop working when the
 * account behind them is deleted, demoted, has its password changed or is signed
 * out everywhere.
 */
describe('Session revocation and user management', () => {
  let app: FastifyInstance;
  let adminToken: string;
  const auth = new AuthService();

  const login = async (username: string, password: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    return res.json().token as string;
  };
  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
  const asAdmin = (method: any, url: string, payload?: any) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${adminToken}` } });

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
    adminToken = await signAs(app, { id: 'rev-admin', username: 'rev-admin', role: 'ADMIN' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects tokens of deleted users, on the API and the media proxy', async () => {
    const user = await auth.createUser('rev-delete', 'delete-me-123');
    const token = await login('rev-delete', 'delete-me-123');
    expect((await me(token)).statusCode).toBe(200);

    expect((await asAdmin('DELETE', `/api/auth/users/${user.id}`)).statusCode).toBe(200);
    expect((await me(token)).statusCode).toBe(401);

    const media = await app.inject({
      method: 'GET',
      url: '/api/media/hls/any_cam/index.m3u8',
      headers: { cookie: `vms_media=${token}` },
    });
    expect(media.statusCode).toBe(401);
  });

  it('forces re-login after a role change', async () => {
    const user = await auth.createUser('rev-role', 'role-change-123', 'ADMIN' as any);
    const token = await login('rev-role', 'role-change-123');

    const res = await asAdmin('PATCH', `/api/auth/users/${user.id}`, { role: 'VIEWER' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('VIEWER');

    expect((await me(token)).statusCode).toBe(401);
    const fresh = await login('rev-role', 'role-change-123');
    expect((await me(fresh)).json().user.role).toBe('VIEWER');
  });

  it('revokes sessions on admin password reset and on sign-out everywhere', async () => {
    const user = await auth.createUser('rev-reset', 'original-pass-1');
    const token = await login('rev-reset', 'original-pass-1');

    expect((await asAdmin('POST', `/api/auth/users/${user.id}/reset-password`, { password: 'short' })).statusCode).toBe(400);
    expect((await asAdmin('POST', `/api/auth/users/${user.id}/reset-password`, { password: 'replaced-pass-2' })).statusCode).toBe(200);
    expect((await me(token)).statusCode).toBe(401);

    const second = await login('rev-reset', 'replaced-pass-2');
    const self = await app.inject({
      method: 'POST',
      url: `/api/auth/users/${user.id}/revoke-sessions`,
      headers: { authorization: `Bearer ${second}` },
    });
    expect(self.statusCode).toBe(200);
    expect((await me(second)).statusCode).toBe(401);
  });

  it('lets users change their own password, keeping only the new session', async () => {
    await auth.createUser('rev-self', 'self-pass-111');
    const other = await login('rev-self', 'self-pass-111');
    const current = await login('rev-self', 'self-pass-111');

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/me/password',
      headers: { authorization: `Bearer ${current}` },
      payload: { currentPassword: 'nope', newPassword: 'self-pass-222' },
    });
    expect(wrong.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/me/password',
      headers: { authorization: `Bearer ${current}` },
      payload: { currentPassword: 'self-pass-111', newPassword: 'self-pass-222' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await me(ok.json().token)).statusCode).toBe(200);
    expect((await me(other)).statusCode).toBe(401);
    expect((await me(current)).statusCode).toBe(401);
  });

  it('protects administrators from locking themselves out', async () => {
    expect((await asAdmin('DELETE', '/api/auth/users/rev-admin')).statusCode).toBe(409);
    expect((await asAdmin('PATCH', '/api/auth/users/rev-admin', { role: 'VIEWER' })).statusCode).toBe(409);
    expect((await asAdmin('DELETE', '/api/auth/users/does-not-exist')).statusCode).toBe(404);
  });

  it('keeps pre-upgrade tokens (no version claim) valid until revoked', async () => {
    const user = await auth.createUser('rev-legacy', 'legacy-pass-123');
    const legacy = app.jwt.sign({ id: user.id, username: user.username, role: user.role });
    expect((await me(legacy)).statusCode).toBe(200);
    await auth.revokeSessions(user.id);
    expect((await me(legacy)).statusCode).toBe(401);
  });

  it('only admins manage other users', async () => {
    const viewer = await signAs(app, { id: 'rev-viewer', username: 'rev-viewer', role: 'VIEWER' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/users/rev-admin/revoke-sessions',
      headers: { authorization: `Bearer ${viewer}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
