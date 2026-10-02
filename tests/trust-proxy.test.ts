import { describe, it, expect, afterEach } from 'vitest';
import { createServer, trustProxySetting } from '../src/server.js';

describe('TRUST_PROXY', () => {
  const original = process.env.TRUST_PROXY;
  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  });

  it('trusts only a proxy on this host for "true", and explicit addresses otherwise', () => {
    expect(trustProxySetting(undefined)).toBe(false);
    expect(trustProxySetting('')).toBe(false);
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('true')).toBe('127.0.0.1,::1');
    expect(trustProxySetting(' 10.0.0.5, 10.0.0.6 ')).toBe('10.0.0.5, 10.0.0.6');
  });

  it('uses X-Forwarded-For from a local proxy but not from other clients', async () => {
    process.env.TRUST_PROXY = 'true';
    const app = await createServer({ logger: false });
    app.get('/__ip', async (request) => ({ ip: request.ip, protocol: request.protocol }));
    await app.ready();

    const viaLocalProxy = await app.inject({
      url: '/__ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' },
    });
    expect(viaLocalProxy.json()).toEqual({ ip: '203.0.113.7', protocol: 'https' });

    const direct = await app.inject({
      url: '/__ip',
      remoteAddress: '192.0.2.50',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(direct.json().ip).toBe('192.0.2.50');
    await app.close();
  });
});
