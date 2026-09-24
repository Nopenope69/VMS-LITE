import { describe, it, expect } from 'vitest';
import { OnvifCameraProvider } from '../src/cameras/onvif.provider.js';
import {
  MOCK_DEVICE_INFO,
  MOCK_DISCOVERED_CAMERAS,
  MOCK_PROFILES_DUAL,
  MOCK_PROFILES_SINGLE_PROFILE_S,
} from './fixtures/onvif-mock.js';

describe('OnvifCameraProvider (CAM-02, CAM-04)', () => {
  it('implements ICameraProvider interface correctly', () => {
    const provider = new OnvifCameraProvider({ mockMode: true });
    expect(typeof provider.discover).toBe('function');
    expect(typeof provider.probe).toBe('function');
    expect(typeof provider.getDeviceInformation).toBe('function');
    expect(typeof provider.getProfiles).toBe('function');
    expect(typeof provider.getStreamUri).toBe('function');
  });

  describe('WS-Discovery (CAM-01)', () => {
    it('discovers ONVIF cameras on the local network', async () => {
      const provider = new OnvifCameraProvider({
        mockMode: true,
        mockCameras: MOCK_DISCOVERED_CAMERAS,
      });

      const discovered = await provider.discover(1000);
      expect(discovered).toHaveLength(2);
      expect(discovered[0].ip).toBe('192.168.1.108');
      expect(discovered[0].name).toContain('CP-PLUS');
      expect(discovered[1].ip).toBe('192.168.1.109');
      expect(discovered[1].port).toBe(8000);
    });

    it('gracefully handles network errors returning an empty list', async () => {
      const provider = new OnvifCameraProvider({
        mockMode: false, // will fail in headless sandbox without UDP multicast
      });

      const discovered = await provider.discover(500);
      expect(Array.isArray(discovered)).toBe(true);
    });
  });

  describe('Profile T / S Resolution and Fallback (CAM-02)', () => {
    it('sorts dual-stream profiles into Main Stream (high-res) and Sub Stream (low-res)', async () => {
      const provider = new OnvifCameraProvider({
        mockMode: true,
        mockProfiles: MOCK_PROFILES_DUAL,
      });

      const profiles = await provider.getProfiles({ ip: '192.168.1.108', port: 80 });
      expect(profiles).toHaveLength(2);

      const main = profiles.find((p) => p.isMainStream);
      expect(main).toBeDefined();
      expect(main?.token).toBe('Profile_T_Main');
      expect(main?.resolution.width).toBe(2560);
      expect(main?.encoding).toBe('H265');

      const sub = profiles.find((p) => !p.isMainStream);
      expect(sub).toBeDefined();
      expect(sub?.token).toBe('Profile_S_Sub');
      expect(sub?.resolution.width).toBe(640);
    });

    it('falls back to single Profile S stream when only one profile is exposed', async () => {
      const provider = new OnvifCameraProvider({
        mockMode: true,
        mockProfiles: MOCK_PROFILES_SINGLE_PROFILE_S,
      });

      const profiles = await provider.getProfiles({ ip: '192.168.1.109', port: 8000 });
      expect(profiles).toHaveLength(1);
      expect(profiles[0].isMainStream).toBe(true);
      expect(profiles[0].encoding).toBe('H264');
      expect(profiles[0].resolution.width).toBe(1920);
    });

    it('resolves stream URI default to main stream', async () => {
      const provider = new OnvifCameraProvider({
        mockMode: true,
        mockProfiles: MOCK_PROFILES_DUAL,
      });

      const uri = await provider.getStreamUri({ ip: '192.168.1.108' });
      expect(uri).toContain('subtype=0');
    });

    it('resolves stream URI for specific requested sub-profile token', async () => {
      const provider = new OnvifCameraProvider({
        mockMode: true,
        mockProfiles: MOCK_PROFILES_DUAL,
      });

      const uri = await provider.getStreamUri({ ip: '192.168.1.108' }, 'Profile_S_Sub');
      expect(uri).toContain('subtype=1');
    });
  });

  describe('Device Information Extraction', () => {
    it('retrieves hardware metadata without exposing ONVIF client internals', async () => {
      const provider = new OnvifCameraProvider({
        mockMode: true,
        mockDetails: MOCK_DEVICE_INFO,
      });

      const details = await provider.getDeviceInformation({ ip: '192.168.1.108' });
      expect(details.manufacturer).toBe('CP PLUS');
      expect(details.model).toBe('CP-UNC-TA41PL3');
      expect(details.serialNumber).toBe('ABC1234567890');
    });
  });
});
