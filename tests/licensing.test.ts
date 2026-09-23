import { describe, it, expect, beforeAll } from 'vitest';
import * as ed from '@noble/ed25519';
import fastify, { FastifyInstance } from 'fastify';
import {
  createSignedLicenseToken,
  verifyLicenseToken,
  LicenseVerificationError,
} from '../src/licensing/verifier.js';
import { CapabilityRegistry, createEvaluationRegistry } from '../src/licensing/capabilities.js';
import { licensingPlugin, requireCapability } from '../src/licensing/plugin.js';
import { LicensePayload } from '../src/licensing/types.js';

describe('Ed25519 Licensing & Capability Registry', () => {
  let privateKeyHex: string;
  let publicKeyHex: string;

  beforeAll(async () => {
    const privBytes = ed.utils.randomPrivateKey();
    privateKeyHex = Buffer.from(privBytes).toString('hex');
    const pubBytes = await ed.getPublicKeyAsync(privBytes);
    publicKeyHex = Buffer.from(pubBytes).toString('hex');
  });

  it('signs and verifies a valid Core license token', async () => {
    const payload: LicensePayload = {
      product: 'basic-vms',
      edition: 'core',
      capabilities: ['core.live', 'core.record', 'core.playback'],
      cameraLimit: 8,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      issuedAt: new Date().toISOString(),
    };

    const token = await createSignedLicenseToken(payload, privateKeyHex);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const verified = await verifyLicenseToken(token, publicKeyHex);
    expect(verified.product).toBe('basic-vms');
    expect(verified.edition).toBe('core');
    expect(verified.cameraLimit).toBe(8);
    expect(verified.capabilities).toContain('core.live');
  });

  it('rejects tampered license token payload', async () => {
    const payload: LicensePayload = {
      product: 'basic-vms',
      edition: 'core',
      capabilities: ['core.live'],
      cameraLimit: 4,
      expiresAt: null,
      issuedAt: new Date().toISOString(),
    };

    const token = await createSignedLicenseToken(payload, privateKeyHex);
    const [header, , sig] = token.split('.');

    // Tamper payload to ask for 100 cameras
    const tamperedPayload = { ...payload, cameraLimit: 100 };
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url');
    const tamperedToken = `${header}.${tamperedPayloadB64}.${sig}`;

    await expect(verifyLicenseToken(tamperedToken, publicKeyHex)).rejects.toThrow(
      LicenseVerificationError
    );
  });

  it('rejects token signed by an untrusted key', async () => {
    const otherPrivBytes = ed.utils.randomPrivateKey();
    const otherPrivHex = Buffer.from(otherPrivBytes).toString('hex');

    const payload: LicensePayload = {
      product: 'basic-vms',
      edition: 'core',
      capabilities: ['core.live'],
      cameraLimit: 4,
      expiresAt: null,
      issuedAt: new Date().toISOString(),
    };

    const token = await createSignedLicenseToken(payload, otherPrivHex);
    await expect(verifyLicenseToken(token, publicKeyHex)).rejects.toThrow(
      LicenseVerificationError
    );
  });

  it('CapabilityRegistry handles expiration correctly', () => {
    const expiredPayload: LicensePayload = {
      product: 'basic-vms',
      edition: 'core',
      capabilities: ['core.live'],
      cameraLimit: 4,
      expiresAt: new Date(Date.now() - 10000).toISOString(), // expired 10s ago
      issuedAt: new Date(Date.now() - 20000).toISOString(),
    };

    const registry = new CapabilityRegistry(expiredPayload);
    expect(registry.isExpired()).toBe(true);
    expect(registry.has('core.live')).toBe(false);
    expect(registry.getAllCapabilities()).toEqual([]);
  });

  it('createEvaluationRegistry provides default Package 1 capabilities', () => {
    const evalRegistry = createEvaluationRegistry();
    expect(evalRegistry.isExpired()).toBe(false);
    expect(evalRegistry.has('core.live')).toBe(true);
    expect(evalRegistry.has('extended.ptz')).toBe(false);
    expect(evalRegistry.getCameraLimit()).toBe(2);
  });

  describe('Fastify requireCapability Route Guard', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = fastify();

      const payload: LicensePayload = {
        product: 'basic-vms',
        edition: 'extended',
        capabilities: ['core.live', 'extended.ptz'],
        cameraLimit: 16,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      };

      const token = await createSignedLicenseToken(payload, privateKeyHex);

      await app.register(licensingPlugin, {
        licenseToken: token,
        publicKeyHex,
      });

      // Allowed route
      app.get(
        '/api/ptz',
        { preHandler: [requireCapability('extended.ptz')] },
        async () => ({ success: true })
      );

      // Forbidden route (requires capability not in license)
      app.get(
        '/api/ai',
        { preHandler: [requireCapability('ai.anpr')] },
        async () => ({ success: true })
      );

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('allows access when capability is present', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/ptz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
    });

    it('denies access with 403 when capability is absent', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/ai' });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.capability).toBe('ai.anpr');
    });
  });
});
