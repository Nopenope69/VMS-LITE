import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { generateIceServers } from '../src/streaming/streaming.routes.js';

describe('generateIceServers & Coturn NAT Traversal (LIVE-04, T-04-02)', () => {
  it('returns default STUN configuration when TURN is not configured', () => {
    const servers = generateIceServers('vms_client', {
      stunUrls: ['stun:custom.stun.domain:3478'],
    });

    expect(servers).toHaveLength(1);
    expect(servers[0].urls).toEqual(['stun:custom.stun.domain:3478']);
    expect(servers[0].username).toBeUndefined();
    expect(servers[0].credential).toBeUndefined();
  });

  it('generates ephemeral RFC 5766 HMAC-SHA1 credentials when TURN is enabled', () => {
    const secret = 'super-secret-turn-token-1234';
    const turnHost = 'turn.vms-node.local';
    const ttlSeconds = 600; // 10 minutes

    const servers = generateIceServers('viewer_device_01', {
      stunUrls: ['stun:turn.vms-node.local:3478'],
      turnHost,
      turnPort: 3478,
      turnSecret: secret,
      ttlSeconds,
    });
    expect(servers).toHaveLength(2);

    // Entry 1: STUN
    expect(servers[0].urls).toEqual(['stun:turn.vms-node.local:3478']);

    // Entry 2: TURN
    const turnEntry = servers[1];
    expect(turnEntry.urls).toEqual([
      `turn:${turnHost}:3478?transport=udp`,
      `turn:${turnHost}:3478?transport=tcp`,
    ]);
    expect(turnEntry.username).toBeDefined();
    expect(turnEntry.credential).toBeDefined();

    // Verify username format: <timestamp>:<userId>
    const [expiryStr, userId] = (turnEntry.username as string).split(':');
    expect(userId).toBe('viewer_device_01');
    const expiry = parseInt(expiryStr, 10);
    const now = Math.floor(Date.now() / 1000);
    expect(expiry).toBeGreaterThan(now);
    expect(expiry).toBeLessThanOrEqual(now + ttlSeconds + 2);

    // Verify HMAC-SHA1 signature
    const expectedHash = crypto
      .createHmac('sha1', secret)
      .update(turnEntry.username as string)
      .digest('base64');
    expect(turnEntry.credential).toBe(expectedHash);
  });
});
