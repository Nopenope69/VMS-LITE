import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { CameraHealthService } from '../src/health/camera-health.service.js';
import { SiteOutageDetector, SiteCameraSample } from '../src/health/site-outage.js';
import { EventBus, eventBus } from '../src/events/event-bus.js';
import { EventRecord } from '../src/events/event.types.js';
import { SiteService } from '../src/sites/site.service.js';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { TokenBucketRateLimiter } from '../src/notifications/token-bucket-rate-limiter.js';
import { MockSmtpTransport } from '../src/notifications/smtp-client.js';
import { SmtpDispatcherService } from '../src/notifications/smtp-dispatcher.service.js';
import { channelWantsEvent } from '../src/notifications/alert-policy.js';
import { signAs } from './helpers/auth.js';
import { extendedLicense } from './helpers/license.js';

const sample = (cameraId: string, siteId: string, status: SiteCameraSample['status'], unreachable: boolean): SiteCameraSample => ({
  cameraId,
  siteId,
  status,
  networkChecked: true,
  unreachable,
});

describe('SiteOutageDetector', () => {
  it('suspects, confirms and clears a site outage', () => {
    const detector = new SiteOutageDetector();
    expect(detector.evaluate([sample('a', 's', 'ONLINE', false), sample('b', 's', 'ONLINE', false)], 0)).toEqual([]);

    // Every camera unreachable, not yet OFFLINE: suspected, nothing announced
    expect(detector.evaluate([sample('a', 's', 'DEGRADED', true), sample('b', 's', 'DEGRADED', true)], 15_000)).toEqual([]);
    expect(detector.getState('s')).toBe('SUSPECTED');

    const down = detector.evaluate([sample('a', 's', 'OFFLINE', true), sample('b', 's', 'OFFLINE', true)], 30_000);
    expect(down).toEqual([{ siteId: 's', type: 'site.offline', cameraIds: ['a', 'b'], outageDurationMs: null }]);
    expect(detector.getDownSites()).toHaveLength(1);

    // Still down: no repeat
    expect(detector.evaluate([sample('a', 's', 'OFFLINE', true), sample('b', 's', 'OFFLINE', true)], 45_000)).toEqual([]);

    // One camera answers: link is back
    const up = detector.evaluate([sample('a', 's', 'ONLINE', false), sample('b', 's', 'OFFLINE', true)], 90_000);
    expect(up).toEqual([{ siteId: 's', type: 'site.online', cameraIds: ['a', 'b'], outageDurationMs: 60_000 }]);
    expect(detector.getState('s')).toBe('UP');
  });

  it('never declares single-camera sites or cameras without a network check down', () => {
    const detector = new SiteOutageDetector();
    expect(detector.evaluate([sample('a', 'one', 'OFFLINE', true)])).toEqual([]);
    expect(
      detector.evaluate([
        sample('a', 'mixed', 'OFFLINE', true),
        { cameraId: 'b', siteId: 'mixed', status: 'ONLINE', networkChecked: false, unreachable: false },
      ])
    ).toEqual([]);
    expect(detector.getState('one')).toBe('UP');
  });

  it('does not call a site down while one camera still answers', () => {
    const detector = new SiteOutageDetector();
    expect(
      detector.evaluate([sample('a', 's', 'OFFLINE', true), sample('b', 's', 'OFFLINE', true), sample('c', 's', 'ONLINE', false)])
    ).toEqual([]);
    expect(detector.getState('s')).toBe('UP');
  });
});

describe('Camera health service: site outages', () => {
  const cameras = [
    { id: 'n1', name: 'North Gate', siteId: 'north', ip: '10.1.0.1', mediaMtxPath: 'n1' },
    { id: 'n2', name: 'North Dock', siteId: 'north', ip: '10.1.0.2', mediaMtxPath: 'n2' },
    { id: 's1', name: 'South Gate', siteId: 'south', ip: '10.2.0.1', mediaMtxPath: 's1' },
    { id: 's2', name: 'South Yard', siteId: 'south', ip: '10.2.0.2', mediaMtxPath: 's2' },
  ];
  let unreachable = new Set<string>();
  let bytes = 0;

  const setup = () => {
    const bus = new EventBus(createMockPrisma() as any);
    const events: EventRecord[] = [];
    bus.subscribe('*', (e) => {
      events.push(e);
    });
    const service = new CameraHealthService({
      cameraService: { listCameras: async () => cameras } as any,
      mediaMtxClient: {
        getPathRuntime: async (p: string) => {
          const cam = cameras.find((c) => c.mediaMtxPath === p)!;
          return unreachable.has(cam.ip) ? { ready: false, bytesReceived: 0 } : { ready: true, bytesReceived: bytes };
        },
      },
      eventBus: bus,
      resolveSiteNames: async (ids) => new Map(ids.map((id) => [id, id === 'north' ? 'North <Branch>' : 'South'])),
    });
    vi.spyOn(service, 'pingTcp').mockImplementation(async (host: string) =>
      unreachable.has(host) ? { reachable: false, latencyMs: null, error: 'timeout' } : { reachable: true, latencyMs: 5 }
    );
    let now = Date.parse('2026-10-02T00:00:00Z');
    const cycle = async () => {
      now += 15_000;
      bytes += 500_000; // ~266 kbps over 15s
      vi.setSystemTime(now);
      await service.pollAllCameras();
    };
    return { service, events, cycle };
  };

  afterEach(() => {
    vi.useRealTimers();
    unreachable = new Set();
    bytes = 0;
  });

  it('sends one site alert for a dropped site link and tags the camera alerts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { service, events, cycle } = setup();
    await cycle();
    await cycle(); // everything ONLINE

    unreachable = new Set(['10.1.0.1', '10.1.0.2']); // North's VPN drops
    for (let i = 0; i < 4; i++) await cycle();

    const siteOffline = events.filter((e) => e.type === 'site.offline');
    expect(siteOffline).toHaveLength(1);
    expect(siteOffline[0]).toMatchObject({ siteId: 'north', cameraId: null, severity: 'critical' });
    expect(siteOffline[0].metadata).toMatchObject({ siteName: 'North <Branch>', cameraIds: ['n1', 'n2'], cameraCount: 2 });

    const cameraAlerts = events.filter((e) => e.type === 'camera.offline' || e.type === 'camera.degraded');
    expect(cameraAlerts.length).toBeGreaterThan(0);
    expect(cameraAlerts.every((e) => (e.metadata as any).siteOutage === 'north')).toBe(true);
    expect(service.getSiteLinkState('north')).toBe('DOWN');
    expect(service.getSiteLinkState('south')).toBe('UP');

    unreachable = new Set();
    await cycle();
    const siteOnline = events.filter((e) => e.type === 'site.online');
    expect(siteOnline).toHaveLength(1);
    expect((siteOnline[0].metadata as any).outageDurationMs).toBeGreaterThan(0);
    // Recovered cameras are not re-announced as offline
    expect(events.filter((e) => e.type === 'camera.offline' && !(e.metadata as any).siteOutage)).toHaveLength(0);
  });

  it('alerts per camera when only one camera of a site fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { events, cycle } = setup();
    await cycle();
    unreachable = new Set(['10.2.0.1']);
    for (let i = 0; i < 4; i++) await cycle();

    expect(events.filter((e) => e.type.startsWith('site.'))).toHaveLength(0);
    const offline = events.filter((e) => e.type === 'camera.offline');
    expect(offline).toHaveLength(1);
    expect(offline[0].cameraId).toBe('s1');
    expect((offline[0].metadata as any).siteOutage).toBeUndefined();
  });

  it('sends the held-back camera alert when a suspected outage turns out to be one camera', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { events, cycle } = setup();
    await cycle();
    unreachable = new Set(['10.1.0.1', '10.1.0.2']);
    await cycle();
    await cycle(); // both DEGRADED, site suspected: alerts tagged
    expect(events.filter((e) => e.type === 'camera.degraded').every((e) => (e.metadata as any).siteOutage)).toBe(true);

    unreachable = new Set(['10.1.0.1']); // North Dock answers again; North Gate really is down
    await cycle();
    const untagged = events.filter(
      (e) => e.cameraId === 'n1' && (e.type === 'camera.degraded' || e.type === 'camera.offline') && !(e.metadata as any).siteOutage
    );
    expect(untagged).toHaveLength(1);
    expect(events.filter((e) => e.type.startsWith('site.'))).toHaveLength(0);
  });
});

describe('Site alerts in notification channels', () => {
  it('lets channels that send camera-offline alerts also send site alerts', () => {
    expect(channelWantsEvent(['camera.offline'], 'site.offline')).toBe(true);
    expect(channelWantsEvent(['camera.offline'], 'site.online')).toBe(true);
    expect(channelWantsEvent(['motion.detected'], 'site.offline')).toBe(false);
  });

  it('emails one site alert and skips the camera alerts it covers', async () => {
    const bus = new EventBus(createMockPrisma() as any);
    const transport = new MockSmtpTransport();
    const service = new SmtpDispatcherService({
      eventBus: bus,
      rateLimiter: new TokenBucketRateLimiter(),
      transport,
      configFilePath: path.join(os.tmpdir(), `smtp-site-${process.pid}-${Date.now()}.json`),
    });
    service.updateConfig({ recipients: ['ops@example.com'], events: ['camera.offline'], enabled: true, cooldownSeconds: 60 });
    await service.start();

    await bus.emitEvent({ type: 'camera.offline', source: 't', cameraId: 'n1', metadata: { cameraName: 'North Gate', siteOutage: 'north' } });
    await bus.emitEvent({
      type: 'site.offline',
      source: 't',
      siteId: 'north',
      metadata: { siteName: 'North <Branch>', cameraCount: 2, cameraIds: ['n1', 'n2'] },
    });
    await bus.emitEvent({ type: 'camera.offline', source: 't', cameraId: 's1', metadata: { cameraName: 'South Gate' } });
    await new Promise((r) => setTimeout(r, 10));
    service.stop();

    expect(transport.sentMails.map((m) => m.subject)).toEqual([
      expect.stringContaining('Site Unreachable: North <Branch>'),
      expect.stringContaining('Camera Offline: South Gate'),
    ]);
    expect(transport.sentMails[0].html).toContain('North &lt;Branch&gt;');
    expect(transport.sentMails[0].html).not.toContain('North <Branch>');
  });
});

describe('Site events in the API', () => {
  let app: FastifyInstance;
  let admin: string;
  let operator: string;
  let northId: string;
  let southId: string;

  const api = (url: string, token: string, method: any = 'GET', payload?: any) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    app = await createServer({ logger: false, licensing: await extendedLicense() });
    await app.ready();
    admin = await signAs(app, { id: 'so-admin', username: 'so-admin', role: 'ADMIN' });
    operator = await signAs(app, { id: 'so-operator', username: 'so-operator', role: 'OPERATOR' });
    northId = (await api('/api/sites', admin, 'POST', { name: 'SO North' })).json().id;
    southId = (await api('/api/sites', admin, 'POST', { name: 'SO South' })).json().id;
    const cam = await api('/api/cameras', admin, 'POST', { name: 'SO North Cam', rtspUrl: 'rtsp://10.9.0.1/s', siteId: northId });
    await api('/api/cameras', admin, 'POST', { name: 'SO South Cam', rtspUrl: 'rtsp://10.9.0.2/s', siteId: southId });
    await api('/api/auth/users/so-operator/permissions', admin, 'PUT', {
      permissions: [{ cameraId: cam.json().id, canViewLive: true }],
    });
    for (const siteId of [northId, southId]) {
      await eventBus.emitEvent({ type: 'site.offline', source: 'test', siteId, severity: 'critical', metadata: { siteName: siteId } });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('filters site events by site and by operator access', async () => {
    const north = (await api(`/api/events?type=site.offline&siteId=${northId}`, admin)).json().events;
    expect(north.map((e: any) => e.siteId)).toEqual([northId]);

    const all = (await api('/api/events?type=site.offline', admin)).json().events.map((e: any) => e.siteId);
    expect(all).toEqual(expect.arrayContaining([northId, southId]));

    const mine = (await api('/api/events?type=site.offline', operator)).json().events.map((e: any) => e.siteId);
    expect(mine).toEqual([northId]);
  });

  it('reports a site with a dropped link as OFFLINE', async () => {
    const prisma = createMockPrisma();
    await prisma.site.create({ data: { id: 's', name: 'S' } });
    await prisma.camera.create({ data: { id: 'c', name: 'c', rtspUrl: 'rtsp://x/1', mediaMtxPath: 'c', siteId: 's' } });
    const service = new SiteService(prisma, {
      getTelemetry: () => ({ status: 'OFFLINE' }) as any,
      getSiteLinkState: () => 'DOWN',
    });
    const [site] = await service.listSummaries();
    expect(site.status).toBe('OFFLINE');
  });
});
