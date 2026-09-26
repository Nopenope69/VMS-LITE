import { describe, it, expect, beforeEach } from 'vitest';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';

describe('MediaMtxClient', () => {
  let client: MediaMtxClient;

  beforeEach(() => {
    client = new MediaMtxClient({ mockMode: true });
  });

  describe('URL Sanitization (T-02-01 mitigation)', () => {
    it('properly encodes special characters in username and password', () => {
      const raw = 'rtsp://admin:P@ss#w:ord@192.168.1.100:554/stream1';
      const sanitized = client.sanitizeRtspUrl(raw);
      expect(sanitized).toBe('rtsp://admin:P%40ss%23w%3Aord@192.168.1.100:554/stream1');
    });

    it('preserves clean RTSP URLs without credentials or with normal credentials', () => {
      const normal = 'rtsp://admin:admin123@192.168.1.50:554/ch0_0.264';
      expect(client.sanitizeRtspUrl(normal)).toBe(normal);

      const unauthenticated = 'rtsp://192.168.1.50:554/live';
      expect(client.sanitizeRtspUrl(unauthenticated)).toBe(unauthenticated);
    });

    it('rejects invalid schemes', () => {
      expect(() => client.sanitizeRtspUrl('http://192.168.1.50/live')).toThrow(
        'Invalid RTSP scheme'
      );
      expect(() => client.sanitizeRtspUrl('')).toThrow(
        'RTSP URL must be a non-empty string'
      );
    });
  });

  describe('Path Management (v3 REST API)', () => {
    it('successfully adds and retrieves a path in mock mode', async () => {
      const added = await client.addPath('camera_front_door', 'rtsp://admin:pass@192.168.1.100/main', {
        sourceOnDemand: false,
      });
      expect(added).toBe(true);

      const path = await client.getPath('camera_front_door');
      expect(path).not.toBeNull();
      expect(path?.name).toBe('camera_front_door');
      expect(path?.conf.source).toBe('rtsp://admin:pass@192.168.1.100/main');
    });

    it('lists all active paths', async () => {
      await client.addPath('cam1', 'rtsp://192.168.1.10/live');
      await client.addPath('cam2', 'rtsp://192.168.1.20/live');

      const paths = await client.listPaths();
      expect(paths.length).toBeGreaterThanOrEqual(2);
      const names = paths.map((p) => p.name);
      expect(names).toContain('cam1');
      expect(names).toContain('cam2');
    });

    it('removes a path and returns null on subsequent get', async () => {
      await client.addPath('temp_cam', 'rtsp://192.168.1.30/live');
      const removed = await client.removePath('temp_cam');
      expect(removed).toBe(true);

      const path = await client.getPath('temp_cam');
      expect(path).toBeNull();
    });

    it('idempotently handles removal of non-existent path', async () => {
      const removed = await client.removePath('non_existent_camera');
      expect(removed).toBe(true);
    });
  });
});
