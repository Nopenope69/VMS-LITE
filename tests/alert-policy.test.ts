import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { alertFor, alertLink, channelWantsEvent, cooldownKey } from '../src/notifications/alert-policy.js';

describe('Alert Policy', () => {
  const previousBase = process.env.PUBLIC_BASE_URL;
  beforeEach(() => { process.env.PUBLIC_BASE_URL = 'https://vms.example.in/'; });
  afterEach(() => {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
  });

  it('drops camera alerts covered by a site outage, for every channel alike', () => {
    expect(alertFor({ type: 'camera.offline', cameraId: 'c1', metadata: { siteOutage: 's1' } })).toBeNull();
    expect(alertFor({ type: 'camera.offline', cameraId: 'c1', metadata: {} })).not.toBeNull();
  });

  it('describes camera and site alerts with one model', () => {
    const camera = alertFor({ type: 'motion.detected', cameraId: 'cam-12345678', timestamp: '2026-10-07T10:00:00Z', metadata: { cameraName: 'Gate' } })!;
    expect(camera).toMatchObject({ cameraId: 'cam-12345678', subjectName: 'Gate', site: null });
    expect(alertLink(camera)).toBe('https://vms.example.in/playback?cameraId=cam-12345678&t=2026-10-07T10%3A00%3A00.000Z');

    const site = alertFor({ type: 'site.offline', siteId: 's1', metadata: { siteName: 'Pune DC', cameraCount: 4 } })!;
    expect(site).toMatchObject({ cameraId: null, subjectName: 'Pune DC' });
    expect(site.site).toMatchObject({ title: 'Site Unreachable', cameraCount: 4 });
    expect(alertLink(site)).toBe('https://vms.example.in/');
  });

  it('gives each channel its own cooldown per subject and event type', () => {
    const a = alertFor({ type: 'camera.offline', cameraId: 'c1' })!;
    const s = alertFor({ type: 'site.offline', siteId: 's1' })!;
    expect(cooldownKey('whatsapp', a)).toBe('whatsapp:c1:camera.offline');
    expect(cooldownKey('smtp', a)).toBe('smtp:c1:camera.offline');
    expect(cooldownKey('smtp', s)).toBe('smtp:site:s1:site.offline');
  });

  it('sends site alerts to channels that subscribed to camera.offline', () => {
    expect(channelWantsEvent(['camera.offline'], 'site.offline')).toBe(true);
    expect(channelWantsEvent(['motion.detected'], 'site.offline')).toBe(false);
  });
});
