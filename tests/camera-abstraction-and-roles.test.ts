import { describe, it, expect } from 'vitest';
import { RtspCameraAdapter } from '../src/cameras/rtsp.adapter.js';
import { ICameraStreamProvider, ICameraDeviceInfo } from '../src/cameras/camera-provider.interface.js';

describe('Phase 3: Camera & Device Abstraction (Capability Interfaces & Stream Roles)', () => {
  const adapter = new RtspCameraAdapter();

  it('implements discrete ICameraStreamProvider capability for generic RTSP feeds', async () => {
    const streamProvider: ICameraStreamProvider = adapter;
    const profiles = await streamProvider.getProfiles({
      ip: '192.168.1.100',
      port: 554,
      username: 'admin',
      password: 'password123',
    });

    expect(profiles.length).toBe(1);
    expect(profiles[0].streamRole).toBe('PRIMARY');
    expect(profiles[0].isMainStream).toBe(true);
    expect(profiles[0].rtspUri).toContain('rtsp://admin:password123@192.168.1.100:554/live');
  });

  it('resolves stream descriptors with formal role', async () => {
    const streams = await adapter.getStreams({
      xaddr: 'rtsp://10.0.0.50:8554/live/sub',
    });

    expect(streams.length).toBe(1);
    expect(streams[0].role).toBe('PRIMARY');
    expect(streams[0].rtspUri).toBe('rtsp://10.0.0.50:8554/live/sub');
    expect(streams[0].encoding).toBe('H264');
  });

  it('implements discrete ICameraDeviceInfo capability', async () => {
    const deviceInfo: ICameraDeviceInfo = adapter;
    const info = await deviceInfo.getDeviceInformation({ ip: '10.0.0.50' });

    expect(info.manufacturer).toBe('Generic RTSP');
    expect(info.model).toBe('Network Stream');
    expect(info.hardwareId).toBe('rtsp-10.0.0.50');
  });

  it('probes socket reachability with timeout handling', async () => {
    // Unreachable local test port with 50ms timeout
    const reachable = await adapter.probe('127.0.0.1', 65534, 50);
    expect(reachable).toBe(false);
  });
});
