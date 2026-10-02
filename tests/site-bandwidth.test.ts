import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { SiteService } from '../src/sites/site.service.js';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { formatBandwidth, linkUsageLevel } from '../client/src/types/sites.js';
import { signAs } from './helpers/auth.js';

describe('Site bandwidth', () => {
  it('sums main and sub-stream bitrates per site and compares them with the uplink', async () => {
    const prisma = createMockPrisma();
    await prisma.site.create({ data: { id: 'n', name: 'North', uplinkMbps: 10 } });
    await prisma.site.create({ data: { id: 's', name: 'South' } });
    for (const [id, siteId] of [['n1', 'n'], ['n2', 'n'], ['s1', 's'], ['s2', 's']]) {
      await prisma.camera.create({ data: { id, name: id, rtspUrl: `rtsp://x/${id}`, mediaMtxPath: id, siteId } });
    }
    const telemetry: Record<string, any> = {
      n1: { status: 'ONLINE', bitrateKbps: 4000, subBitrateKbps: 500 },
      n2: { status: 'ONLINE', bitrateKbps: 4000, subBitrateKbps: null },
      s1: { status: 'ONLINE', bitrateKbps: null, subBitrateKbps: null }, // warming up
    };
    const service = new SiteService(prisma, { getTelemetry: (id: string) => telemetry[id] ?? null });

    const [north, south] = await service.listSummaries();
    expect(north).toMatchObject({ name: 'North', uplinkMbps: 10, bandwidthKbps: 8500, linkUsage: 0.85 });
    expect(south).toMatchObject({ name: 'South', uplinkMbps: null, bandwidthKbps: null, linkUsage: null });
  });

  it('formats rates and grades link usage', () => {
    expect(formatBandwidth(850)).toBe('850 kbps');
    expect(formatBandwidth(4200)).toBe('4.2 Mbps');
    expect(formatBandwidth(25_400)).toBe('25 Mbps');
    expect(linkUsageLevel(0.5)).toBe('ok');
    expect(linkUsageLevel(0.85)).toBe('high');
    expect(linkUsageLevel(1.2)).toBe('saturated');
    expect(linkUsageLevel(null)).toBeNull();
  });
});

describe('Site uplink setting', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('stores, clears and validates the uplink capacity', async () => {
    const admin = await signAs(app, { id: 'bw-admin', username: 'bw-admin', role: 'ADMIN' });
    const h = { authorization: `Bearer ${admin}` };
    const created = await app.inject({ method: 'POST', url: '/api/sites', headers: h, payload: { name: 'BW Site', uplinkMbps: 20 } });
    expect(created.statusCode).toBe(201);
    expect(created.json().uplinkMbps).toBe(20);

    const id = created.json().id;
    const cleared = await app.inject({ method: 'PATCH', url: `/api/sites/${id}`, headers: h, payload: { uplinkMbps: null } });
    expect(cleared.json().uplinkMbps).toBeNull();

    const bad = await app.inject({ method: 'PATCH', url: `/api/sites/${id}`, headers: h, payload: { uplinkMbps: -5 } });
    expect(bad.statusCode).toBe(400);

    const listed = (await app.inject({ url: '/api/sites', headers: h })).json().sites.find((s: any) => s.id === id);
    expect(listed).toMatchObject({ uplinkMbps: null, bandwidthKbps: null, linkUsage: null });
  });
});
