import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiFetch, configureApi } from '../client/src/api/client.js';

describe('Browser API client', () => {
  const calls: Array<{ url: string; auth: string | null }> = [];
  let status = 200;
  const unauthorized: Array<string | null> = [];

  beforeEach(() => {
    calls.length = 0;
    unauthorized.length = 0;
    status = 200;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('Authorization') });
      return new Response('{}', { status });
    });
    configureApi({ getToken: () => 'session-token', onUnauthorized: (t) => unauthorized.push(t) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('adds the session token to API calls only', async () => {
    await apiFetch('/api/cameras');
    await apiFetch('/assets/logo.svg');
    expect(calls).toEqual([
      { url: '/api/cameras', auth: 'Bearer session-token' },
      { url: '/assets/logo.svg', auth: null },
    ]);
  });

  it("keeps a caller's own Authorization header", async () => {
    await apiFetch('/api/auth/me', { headers: { Authorization: 'Bearer other' } });
    expect(calls[0].auth).toBe('Bearer other');
  });

  it('reports a 401 with the token that was rejected', async () => {
    status = 401;
    const res = await apiFetch('/api/recordings');
    expect(res.status).toBe(401);
    expect(unauthorized).toEqual(['session-token']);
  });
});
