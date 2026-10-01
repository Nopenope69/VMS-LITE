import http from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventBus, scrubSecrets } from '../src/events/event-bus.js';
import { OnvifEventListenerService } from '../src/events/onvif-events.service.js';

describe('EventBus hardening', () => {
  it('strips credentials from metadata before storing or broadcasting', async () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe('camera.online', (e) => received.push(e));

    await bus.emitEvent({
      type: 'camera.online',
      source: 'test',
      metadata: {
        name: 'Gate',
        password: 'hunter2',
        rtspUrl: 'rtsp://admin:hunter2@10.0.0.1:554/stream',
        nested: { apiKey: 'k', ok: 1 },
      },
    });

    const meta = received[0].metadata;
    expect(meta.password).toBeUndefined();
    expect(meta.rtspUrl).toBe('rtsp://10.0.0.1:554/stream');
    expect(meta.nested).toEqual({ ok: 1 });
    expect(JSON.stringify(meta)).not.toContain('hunter2');
  });

  it('isolates failing subscribers (no throw, no unhandled rejection)', async () => {
    const bus = new EventBus();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const delivered: string[] = [];

    bus.subscribe('x.test', () => {
      throw new Error('sync boom');
    });
    bus.subscribe('x.test', async () => {
      throw new Error('async boom');
    });
    bus.subscribe('x.test', (e) => {
      delivered.push(e.type);
    });

    await expect(bus.emitEvent({ type: 'x.test', source: 'test' })).resolves.toBeDefined();
    await new Promise((r) => setImmediate(r));
    expect(delivered).toEqual(['x.test']);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('caps event query page size', async () => {
    const bus = new EventBus();
    const prisma = (bus as any).prisma;
    const spy = vi.spyOn(prisma.event, 'findMany');
    await bus.queryEvents({ limit: 1_000_000 });
    expect((spy.mock.calls[0] as any[])[0].take).toBe(500);
    spy.mockRestore();
  });
});

describe('ONVIF pull-point lifecycle', () => {
  let server: http.Server | null = null;
  let service: OnvifEventListenerService | null = null;

  afterEach(async () => {
    service?.stop();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  it('re-creates the subscription after it lapses instead of polling a dead URL forever', async () => {
    let creates = 0;
    let pulls = 0;
    let deadSubscription = '';

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
        if (body.includes('CreatePullPointSubscription')) {
          creates++;
          res.end(
            `<Envelope><Body><CreatePullPointSubscriptionResponse><SubscriptionReference><Address>${base}/sub/${creates}</Address></SubscriptionReference></CreatePullPointSubscriptionResponse></Body></Envelope>`
          );
          return;
        }
        if (body.includes('PullMessages')) {
          pulls++;
          if (req.url === deadSubscription) {
            res.statusCode = 400; // Subscription expired on the camera
            res.end('<Fault/>');
            return;
          }
          if (pulls === 1) {
            deadSubscription = req.url!; // Expire subscription #1 right after the first pull
          }
          res.end(
            `<Envelope><Body><PullMessagesResponse><wsnt:NotificationMessage><wsnt:Topic>tns1:RuleEngine/CellMotionDetector/Motion</wsnt:Topic><wsnt:Message><tt:Message UtcTime="2026-10-01T00:00:00Z"><tt:Data><tt:SimpleItem Name="IsMotion" Value="true"/></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage></PullMessagesResponse></Body></Envelope>`
          );
          return;
        }
        res.end('<Envelope/>');
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;

    const bus = new EventBus();
    const motions: any[] = [];
    bus.subscribe('motion.detected', (e) => motions.push(e));

    service = new OnvifEventListenerService(bus, false, {
      cameraLookup: async () => undefined,
      cameraLister: async () => [],
    });
    service.setMockMode(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await service.subscribeCamera({
      id: 'cam-onvif',
      name: 'Gate',
      onvifXAddr: `http://127.0.0.1:${port}/onvif/device_service`,
      username: 'admin',
      password: 'pw<&>',
    });

    await vi.waitFor(() => expect(creates).toBeGreaterThanOrEqual(2), { timeout: 8000, interval: 50 });
    await vi.waitFor(() => expect(motions.length).toBeGreaterThanOrEqual(2), { timeout: 8000, interval: 50 });
    expect(service.getSubscription('cam-onvif')?.subscriptionUrl).not.toBe(`http://127.0.0.1:${port}/sub/1`);
  }, 15000);
});

describe('scrubSecrets', () => {
  it('leaves non-secret data intact', () => {
    expect(scrubSecrets({ a: 1, b: ['x', { c: 'http://host/path' }] })).toEqual({ a: 1, b: ['x', { c: 'http://host/path' }] });
  });
});
