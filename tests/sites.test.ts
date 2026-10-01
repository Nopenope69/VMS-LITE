import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { cameraHealthService } from '../src/health/camera-health.service.js';
import { SiteService } from '../src/sites/site.service.js';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { createBackup, restoreBackup } from '../src/system/backup.service.js';
import { signAs } from './helpers/auth.js';
import * as ed from '@noble/ed25519';
import { createSignedLicenseToken } from '../src/licensing/verifier.js';
import { EXTENDED_CAPABILITIES } from '../src/licensing/types.js';

/** Licensing options for a 32-camera Extended install (evaluation allows 2 cameras). */
async function extendedLicense() {
  const priv = ed.utils.randomPrivateKey();
  const publicKeyHex = Buffer.from(await ed.getPublicKeyAsync(priv)).toString('hex');
  const licenseToken = await createSignedLicenseToken(
    {
      product: 'basic-vms',
      edition: 'extended',
      capabilities: [...EXTENDED_CAPABILITIES],
      cameraLimit: 32,
      expiresAt: null,
      issuedAt: new Date().toISOString(),
    },
    Buffer.from(priv).toString('hex')
  );
  return { licenseToken, publicKeyHex, fallbackToEvaluation: false };
}

describe('Multi-site model', () => {
  let app: FastifyInstance;
  let admin: string;
  let operator: string;
  let northId: string;
  let southId: string;
  const cams: Record<string, string> = {};

  const api = (method: any, url: string, token: string, payload?: any) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    app = await createServer({ logger: false, licensing: await extendedLicense() });
    await app.ready();
    admin = await signAs(app, { id: 'site-admin', username: 'site-admin', role: 'ADMIN' });
    operator = await signAs(app, { id: 'site-operator', username: 'site-operator', role: 'OPERATOR' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, renames and validates sites', async () => {
    const north = await api('POST', '/api/sites', admin, { name: 'North Branch', address: 'Sector 18, Noida' });
    expect(north.statusCode).toBe(201);
    northId = north.json().id;
    southId = (await api('POST', '/api/sites', admin, { name: 'South Warehouse' })).json().id;

    expect((await api('POST', '/api/sites', admin, { name: 'North Branch' })).statusCode).toBe(409);
    expect((await api('POST', '/api/sites', admin, { name: 'Unassigned' })).statusCode).toBe(400);
    expect((await api('POST', '/api/sites', admin, { name: '' })).statusCode).toBe(400);
    expect((await api('POST', '/api/sites', operator, { name: 'Nope' })).statusCode).toBe(403);

    const renamed = await api('PATCH', `/api/sites/${southId}`, admin, { name: 'South Depot' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe('South Depot');
  });

  it('assigns cameras to sites on creation and rejects unknown sites', async () => {
    for (const [name, siteId] of [
      ['North Gate', () => northId],
      ['North Lobby', () => northId],
      ['South Dock', () => southId],
      ['Loose Cam', () => null],
    ] as const) {
      const res = await api('POST', '/api/cameras', admin, {
        name,
        rtspUrl: `rtsp://10.1.0.${Object.keys(cams).length + 1}/stream`,
        ...(siteId() ? { siteId: siteId() } : {}),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().siteId).toBe(siteId());
      cams[name] = res.json().id;
    }
    const bad = await api('POST', '/api/cameras', admin, { name: 'X', rtspUrl: 'rtsp://10.1.9.9/s', siteId: 'nope' });
    expect(bad.statusCode).toBe(400);
  });

  it('filters cameras and streaming config by site', async () => {
    const north = (await api('GET', `/api/cameras?siteId=${northId}`, admin)).json();
    expect(north.cameras.map((c: any) => c.name).sort()).toEqual(['North Gate', 'North Lobby']);

    const unassigned = (await api('GET', '/api/cameras?siteId=unassigned', admin)).json();
    expect(unassigned.cameras.map((c: any) => c.name)).toEqual(['Loose Cam']);

    const streaming = (await api('GET', `/api/streaming/config?siteId=${southId}`, admin)).json();
    expect(streaming.cameras).toHaveLength(1);
    expect(streaming.cameras[0]).toMatchObject({ name: 'South Dock', siteId: southId });
  });

  it('moves and renames cameras', async () => {
    const res = await api('PATCH', `/api/cameras/${cams['Loose Cam']}`, admin, { siteId: southId, name: 'South Gate' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ siteId: southId, name: 'South Gate' });

    expect((await api('PATCH', `/api/cameras/${cams['Loose Cam']}`, admin, { siteId: 'missing' })).statusCode).toBe(400);
    expect((await api('PATCH', `/api/cameras/${cams['Loose Cam']}`, operator, { name: 'Hijack' })).statusCode).toBe(403);
    expect((await api('PATCH', '/api/cameras/unknown-camera', admin, { name: 'X' })).statusCode).toBe(404);
  });

  it('summarises live health per site', async () => {
    const statuses: Record<string, string> = {
      [cams['North Gate']]: 'ONLINE',
      [cams['North Lobby']]: 'OFFLINE',
      [cams['South Dock']]: 'ONLINE',
    };
    const spy = vi
      .spyOn(cameraHealthService, 'getTelemetry')
      .mockImplementation((id: string) => (statuses[id] ? ({ status: statuses[id] } as any) : null));

    const { sites } = (await api('GET', '/api/sites', admin)).json();
    const north = sites.find((s: any) => s.id === northId);
    const south = sites.find((s: any) => s.id === southId);
    expect(north).toMatchObject({ cameraCount: 2, status: 'CRITICAL', health: { online: 1, offline: 1 } });
    expect(south).toMatchObject({ cameraCount: 2, status: 'HEALTHY', health: { online: 1, unknown: 1 } });
    spy.mockRestore();
  });

  it('shows operators only the sites and cameras they are granted', async () => {
    const { prisma } = await import('../src/db/prisma.js');
    await prisma.cameraPermission.create({
      data: { userId: 'site-operator', cameraId: cams['North Gate'], canViewLive: true, canViewPlayback: true },
    });
    const { sites } = (await api('GET', '/api/sites', operator)).json();
    expect(sites.map((s: any) => s.name)).toEqual(['North Branch']);
    expect(sites[0].cameraCount).toBe(1);
  });

  it('filters events by site', async () => {
    const { eventBus } = await import('../src/events/event-bus.js');
    await eventBus.emitEvent({ type: 'motion.detected', source: 'test', cameraId: cams['North Gate'] });
    await eventBus.emitEvent({ type: 'motion.detected', source: 'test', cameraId: cams['South Dock'] });
    const { events } = (await api('GET', `/api/events?siteId=${southId}&type=motion.detected`, admin)).json();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e: any) => e.cameraId === cams['South Dock'])).toBe(true);
  });

  it('refuses to delete a site that still has cameras', async () => {
    expect((await api('DELETE', `/api/sites/${southId}`, admin)).statusCode).toBe(409);
    const empty = (await api('POST', '/api/sites', admin, { name: 'Temp Site' })).json();
    expect((await api('DELETE', `/api/sites/${empty.id}`, admin)).statusCode).toBe(200);
  });
});

describe('SiteService helpers', () => {
  it('turns the first-boot site name into the first site and adopts unassigned cameras', async () => {
    const prisma = createMockPrisma();
    await prisma.camera.create({ data: { id: 'c1', name: 'Cam', rtspUrl: 'rtsp://x/1', mediaMtxPath: 'c1' } });
    const service = new SiteService(prisma, { getTelemetry: () => null });

    await service.ensureInitialSite('Head Office');
    const sites = await prisma.site.findMany();
    expect(sites.map((s: any) => s.name)).toEqual(['Head Office']);
    expect((await prisma.camera.findUnique({ where: { id: 'c1' } })).siteId).toBe(sites[0].id);

    await service.ensureInitialSite('Second Name'); // no-op once a site exists
    expect(await prisma.site.count()).toBe(1);
  });

  it('round-trips sites through backup and restore', async () => {
    const source = createMockPrisma();
    await source.site.create({ data: { id: 's1', name: 'Branch A' } });
    await source.camera.create({ data: { id: 'c1', name: 'Cam', rtspUrl: 'rtsp://x/1', mediaMtxPath: 'c1', siteId: 's1' } });
    const archive = await createBackup(source as any);

    const target = createMockPrisma();
    await restoreBackup(target as any, archive);
    expect((await target.site.findUnique({ where: { id: 's1' } }))?.name).toBe('Branch A');
    expect((await target.camera.findUnique({ where: { id: 'c1' } }))?.siteId).toBe('s1');
  });
});
