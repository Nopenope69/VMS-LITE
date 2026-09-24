import { describe, it, expect, beforeEach } from 'vitest';
import { CameraService, LicenseLimitExceededError } from '../src/cameras/camera.service.js';
import { OnvifCameraProvider } from '../src/cameras/onvif.provider.js';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';
import { EventBus } from '../src/events/event-bus.js';
import {
  MOCK_DEVICE_INFO,
  MOCK_DISCOVERED_CAMERAS,
  MOCK_PROFILES_DUAL,
} from './fixtures/onvif-mock.js';

describe('CameraService (CAM-01, CAM-02, CAM-03, CAM-05)', () => {
  let service: CameraService;
  let provider: OnvifCameraProvider;
  let mediaMtx: MediaMtxClient;
  let eventBus: EventBus;

  beforeEach(() => {
    provider = new OnvifCameraProvider({
      mockMode: true,
      mockCameras: MOCK_DISCOVERED_CAMERAS,
      mockProfiles: MOCK_PROFILES_DUAL,
      mockDetails: MOCK_DEVICE_INFO,
    });
    mediaMtx = new MediaMtxClient({ mockMode: true });
    eventBus = new EventBus();

    service = new CameraService({
      provider,
      mediaMtx,
      eventBus,
    });
  });

  describe('Discovery', () => {
    it('discovers cameras via WS-Discovery', async () => {
      const devices = await service.discover(1000);
      expect(devices).toHaveLength(2);
      expect(devices[0].ip).toBe('192.168.1.108');
    });
  });

  describe('ONVIF Camera Onboarding & MediaMTX Sync', () => {
    it('successfully onboards an ONVIF camera and configures MediaMTX path', async () => {
      const camera = await service.onboardOnvifCamera(
        {
          name: 'Front Gate Camera',
          ip: '192.168.1.108',
          port: 80,
          username: 'admin',
          password: 'SecretPassword123!',
        },
        5 // license limit
      );

      expect(camera.id).toBeDefined();
      expect(camera.name).toBe('Front Gate Camera');
      expect(camera.rtspUrl).toContain('subtype=0');
      expect(camera.subStreamUrl).toContain('subtype=1');
      expect(camera.status).toBe('online');
      expect(camera.mediaMtxPath).toBeDefined();

      // Ensure password is not leaked in DTO (T-02-06)
      expect((camera as any).password).toBeUndefined();

      // Check MediaMTX path exists
      const path = await mediaMtx.getPath(camera.mediaMtxPath);
      expect(path).not.toBeNull();
      expect(path?.name).toBe(camera.mediaMtxPath);
    });

    it('emits camera.online event upon onboarding', async () => {
      let eventReceived: any = null;
      eventBus.subscribe('camera.online', (evt) => {
        eventReceived = evt;
      });

      const camera = await service.onboardOnvifCamera(
        {
          name: 'Backyard Camera',
          ip: '192.168.1.108',
          port: 80,
        },
        5
      );

      expect(eventReceived).not.toBeNull();
      expect(eventReceived.cameraId).toBe(camera.id);
      expect(eventReceived.type).toBe('camera.online');
    });
  });

  describe('Manual Camera Onboarding', () => {
    it('onboards manual RTSP stream and provisions MediaMTX', async () => {
      const camera = await service.onboardManualCamera(
        {
          name: 'Warehouse Stream',
          rtspUrl: 'rtsp://admin:pass@10.0.0.50:554/live',
        },
        5
      );

      expect(camera.name).toBe('Warehouse Stream');
      expect(camera.rtspUrl).toBe('rtsp://admin:pass@10.0.0.50:554/live');

      const path = await mediaMtx.getPath(camera.mediaMtxPath);
      expect(path).not.toBeNull();
    });
  });

  describe('License Limit Enforcement (T-02-04)', () => {
    it('throws LicenseLimitExceededError when camera limit is reached', async () => {
      const cameraLimit = 2;

      // Onboard 2 cameras
      await service.onboardManualCamera(
        { name: 'Cam 1', rtspUrl: 'rtsp://10.0.0.1/live' },
        cameraLimit
      );
      await service.onboardManualCamera(
        { name: 'Cam 2', rtspUrl: 'rtsp://10.0.0.2/live' },
        cameraLimit
      );

      // Attempt 3rd camera
      await expect(
        service.onboardManualCamera(
          { name: 'Cam 3', rtspUrl: 'rtsp://10.0.0.3/live' },
          cameraLimit
        )
      ).rejects.toThrow(LicenseLimitExceededError);
    });
  });

  describe('Camera Deletion & Teardown', () => {
    it('removes camera, tears down MediaMTX path, and emits camera.offline event', async () => {
      const camera = await service.onboardManualCamera(
        { name: 'Temporary Cam', rtspUrl: 'rtsp://10.0.0.10/live' },
        5
      );

      let offlineEvent: any = null;
      eventBus.subscribe('camera.offline', (evt) => {
        offlineEvent = evt;
      });

      const deleted = await service.removeCamera(camera.id);
      expect(deleted).toBe(true);

      const path = await mediaMtx.getPath(camera.mediaMtxPath);
      expect(path).toBeNull();

      expect(offlineEvent).not.toBeNull();
      expect(offlineEvent.cameraId).toBe(camera.id);
    });
  });
});
