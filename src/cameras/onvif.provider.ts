import onvif from 'node-onvif';
import {
  CameraConnectionParams,
  CameraDeviceDetails,
  CameraPreset,
  CameraStreamProfile,
  DiscoveredCamera,
  ICameraProvider,
  PtzMoveParams,
} from './camera-provider.interface.js';

export interface OnvifProviderOptions {
  mockMode?: boolean;
  mockCameras?: DiscoveredCamera[];
  mockProfiles?: CameraStreamProfile[];
  mockDetails?: CameraDeviceDetails;
  mockPresets?: CameraPreset[];
}

export class OnvifCameraProvider implements ICameraProvider {
  private readonly mockMode: boolean;
  private readonly mockCameras: DiscoveredCamera[];
  private readonly mockProfiles: CameraStreamProfile[];
  private readonly mockDetails: CameraDeviceDetails;
  private readonly mockPresets: CameraPreset[];
  private mockPresetState: Map<string, CameraPreset[]> = new Map();
  public lastPtzCommand?: { type: 'move' | 'stop' | 'goto' | 'set' | 'remove'; speed?: any; presetToken?: string; presetName?: string };

  constructor(opts: OnvifProviderOptions = {}) {
    this.mockMode = opts.mockMode ?? (process.env.NODE_ENV === 'test');
    this.mockCameras = opts.mockCameras || [];
    this.mockProfiles = opts.mockProfiles || [];
    this.mockDetails = opts.mockDetails || {
      manufacturer: 'Generic ONVIF',
      model: 'IPC',
      firmwareVersion: '1.0.0',
    };
    this.mockPresets = opts.mockPresets || [
      { token: 'preset-1', name: 'Main Gate' },
      { token: 'preset-2', name: 'Loading Bay' },
    ];
  }

  /**
   * Discovers ONVIF compliant cameras on the local subnet via WS-Discovery UDP multicast.
   */
  async discover(timeoutMs = 3000): Promise<DiscoveredCamera[]> {
    if (this.mockMode && this.mockCameras.length > 0) {
      return this.mockCameras;
    }

    try {
      const devices = await onvif.startProbe({ timeout: timeoutMs });
      if (!Array.isArray(devices)) {
        return [];
      }

      return devices.map((dev: any) => {
        const xaddr = dev.xaddrs && dev.xaddrs[0] ? dev.xaddrs[0] : '';
        let ip = '';
        let port = 80;

        try {
          if (xaddr) {
            const parsed = new URL(xaddr);
            ip = parsed.hostname;
            port = parseInt(parsed.port || '80', 10);
          }
        } catch {
          // Keep defaults
        }

        return {
          urn: dev.urn || `urn:uuid:${Math.random().toString(36).substring(2)}`,
          name: dev.name || 'ONVIF Camera',
          xaddr,
          ip,
          port,
        };
      });
    } catch (err) {
      // Return empty array on network failure or if multicast interface unavailable
      return [];
    }
  }

  /**
   * Tests reachability of an IP camera port.
   */
  async probe(ip: string, port: number, timeoutMs = 2000): Promise<boolean> {
    if (this.mockMode) {
      return true;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`http://${ip}:${port}/onvif/device_service`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.status < 500;
    } catch {
      clearTimeout(timeout);
      return false;
    }
  }

  /**
   * Retrieves camera device information (Manufacturer, Model, Serial, Firmware).
   */
  async getDeviceInformation(params: CameraConnectionParams): Promise<CameraDeviceDetails> {
    if (this.mockMode && this.mockDetails) {
      return this.mockDetails;
    }

    const device = new onvif.OnvifDevice({
      xaddr: params.xaddr || `http://${params.ip}:${params.port || 80}/onvif/device_service`,
      user: params.username || '',
      pass: params.password || '',
    });

    try {
      await device.init();
      const info = device.getInformation();
      return {
        manufacturer: info.Manufacturer,
        model: info.Model,
        firmwareVersion: info.FirmwareVersion,
        serialNumber: info.SerialNumber,
        hardwareId: info.HardwareId,
      };
    } catch (err) {
      throw new Error(`Failed to fetch ONVIF device information: ${(err as Error).message}`);
    }
  }

  /**
   * Extracts available video stream profiles with Profile T priority and Profile S fallback.
   * Highest resolution profile is marked isMainStream: true; lower resolution is marked SubStream.
   */
  async getProfiles(params: CameraConnectionParams): Promise<CameraStreamProfile[]> {
    if (this.mockMode && this.mockProfiles.length > 0) {
      return this.mockProfiles;
    }

    const device = new onvif.OnvifDevice({
      xaddr: params.xaddr || `http://${params.ip}:${params.port || 80}/onvif/device_service`,
      user: params.username || '',
      pass: params.password || '',
    });

    try {
      await device.init();
      const profiles = device.getProfileList();

      if (!profiles || profiles.length === 0) {
        throw new Error('No ONVIF streaming profiles found on device');
      }

      const streamProfiles: CameraStreamProfile[] = [];

      for (const p of profiles) {
        const streamUri = device.getUdpStreamUrl(p.token);
        const video = p.video || {};
        const resolution = video.resolution || { width: 1920, height: 1080 };
        const encoding = video.encoder || 'H264';
        const fps = video.framerate;

        // Embed credentials in RTSP URL if provided and not already present
        const rtspWithAuth = this.injectCredentials(streamUri, params.username, params.password);

        streamProfiles.push({
          token: p.token,
          name: p.name || `Profile_${p.token}`,
          encoding,
          resolution: {
            width: resolution.width,
            height: resolution.height,
          },
          fps,
          rtspUri: rtspWithAuth,
        });
      }

      // Sort profiles by total pixel count descending: highest resolution first (Main Stream)
      streamProfiles.sort((a, b) => {
        const areaA = a.resolution.width * a.resolution.height;
        const areaB = b.resolution.width * b.resolution.height;
        return areaB - areaA;
      });

      // Mark main stream
      if (streamProfiles.length > 0) {
        streamProfiles[0].isMainStream = true;
      }
      for (let i = 1; i < streamProfiles.length; i++) {
        streamProfiles[i].isMainStream = false;
      }

      return streamProfiles;
    } catch (err) {
      throw new Error(`Failed to extract ONVIF stream profiles: ${(err as Error).message}`);
    }
  }

  /**
   * Resolves direct RTSP stream URI for a given profile token.
   */
  async getStreamUri(params: CameraConnectionParams, profileToken?: string): Promise<string> {
    const profiles = await this.getProfiles(params);
    if (profileToken) {
      const matched = profiles.find((p) => p.token === profileToken);
      if (matched) return matched.rtspUri;
    }

    // Default to main stream (first sorted profile)
    if (profiles.length > 0) {
      return profiles[0].rtspUri;
    }

    throw new Error('No valid stream profile found');
  }

  /**
   * Injects username and password into an RTSP URL if credentials were provided
   */
  private injectCredentials(url: string, user?: string, pass?: string): string {
    if (!user) {
      return url;
    }

    try {
      const match = url.match(/^(rtsps?:\/\/)(.*)$/);
      if (!match) return url;

      const [, proto, rest] = match;
      if (rest.includes('@')) {
        return url; // Credentials already present
      }

      const encodedUser = encodeURIComponent(user);
      const encodedPass = pass !== undefined ? `:${encodeURIComponent(pass)}` : '';
      return `${proto}${encodedUser}${encodedPass}@${rest}`;
    } catch {
      return url;
    }
  }

  /**
   * Helper to instantiate an OnvifDevice
   */
  private createDevice(params: CameraConnectionParams): any {
    return new onvif.OnvifDevice({
      xaddr: params.xaddr || `http://${params.ip}:${params.port || 80}/onvif/device_service`,
      user: params.username || '',
      pass: params.password || '',
    });
  }

  /**
   * Commands camera to continuously move Pan, Tilt, or Zoom.
   */
  async ptzMove(params: CameraConnectionParams, move: PtzMoveParams, profileToken?: string): Promise<void> {
    this.lastPtzCommand = { type: 'move', speed: move.speed };
    if (this.mockMode) {
      return;
    }

    const device = this.createDevice(params);
    await device.init();
    if (profileToken) {
      device.changeProfile(profileToken);
    }

    const timeout = typeof move.timeout === 'number' ? move.timeout : 1;
    await device.ptzMove({
      speed: {
        x: move.speed.x || 0,
        y: move.speed.y || 0,
        z: move.speed.z || 0,
      },
      timeout,
    });
  }

  /**
   * Immediately halts active PTZ movement.
   */
  async ptzStop(params: CameraConnectionParams, profileToken?: string): Promise<void> {
    this.lastPtzCommand = { type: 'stop' };
    if (this.mockMode) {
      return;
    }

    const device = this.createDevice(params);
    await device.init();
    if (profileToken) {
      device.changeProfile(profileToken);
    }

    await device.ptzStop();
  }

  /**
   * Retrieves saved presets from the camera.
   */
  async getPresets(params: CameraConnectionParams, profileToken?: string): Promise<CameraPreset[]> {
    const key = params.ip || params.xaddr || 'default';
    if (this.mockMode) {
      if (!this.mockPresetState.has(key)) {
        this.mockPresetState.set(key, [...this.mockPresets]);
      }
      return this.mockPresetState.get(key) || [];
    }

    const device = this.createDevice(params);
    await device.init();
    if (profileToken) {
      device.changeProfile(profileToken);
    }

    if (!device.services?.ptz) {
      throw new Error('Camera does not support PTZ service');
    }

    const targetProfile = device.current_profile?.token || profileToken;
    const res = await device.services.ptz.getPresets({ ProfileToken: targetProfile });
    const rawPresets = res?.data?.GetPresetsResponse?.Preset || res?.Body?.GetPresetsResponse?.Preset;
    const list = Array.isArray(rawPresets) ? rawPresets : rawPresets ? [rawPresets] : [];

    return list.map((p: any) => ({
      token: p.$?.token || p.token || '',
      name: p.Name || p.name || (p.$?.token ? `Preset ${p.$?.token}` : 'Preset'),
    }));
  }

  /**
   * Moves camera to target preset position.
   */
  async gotoPreset(params: CameraConnectionParams, presetToken: string, profileToken?: string): Promise<void> {
    this.lastPtzCommand = { type: 'goto', presetToken };
    if (this.mockMode) {
      return;
    }

    const device = this.createDevice(params);
    await device.init();
    if (profileToken) {
      device.changeProfile(profileToken);
    }

    if (!device.services?.ptz) {
      throw new Error('Camera does not support PTZ service');
    }

    const targetProfile = device.current_profile?.token || profileToken;
    await device.services.ptz.gotoPreset({
      ProfileToken: targetProfile,
      PresetToken: presetToken,
    });
  }

  /**
   * Saves current position as a named preset and returns preset token.
   */
  async setPreset(params: CameraConnectionParams, presetName: string, profileToken?: string): Promise<string> {
    this.lastPtzCommand = { type: 'set', presetName };
    const key = params.ip || params.xaddr || 'default';
    if (this.mockMode) {
      if (!this.mockPresetState.has(key)) {
        this.mockPresetState.set(key, [...this.mockPresets]);
      }
      const presets = this.mockPresetState.get(key)!;
      const token = `preset-${Date.now()}`;
      presets.push({ token, name: presetName });
      return token;
    }

    const device = this.createDevice(params);
    await device.init();
    if (profileToken) {
      device.changeProfile(profileToken);
    }

    if (!device.services?.ptz) {
      throw new Error('Camera does not support PTZ service');
    }

    const targetProfile = device.current_profile?.token || profileToken;
    const res = await device.services.ptz.setPreset({
      ProfileToken: targetProfile,
      PresetName: presetName,
    });

    const token = res?.data?.SetPresetResponse?.PresetToken || res?.Body?.SetPresetResponse?.PresetToken || `preset-${Date.now()}`;
    return token;
  }

  /**
   * Deletes a saved preset from the camera.
   */
  async removePreset(params: CameraConnectionParams, presetToken: string, profileToken?: string): Promise<void> {
    this.lastPtzCommand = { type: 'remove', presetToken };
    const key = params.ip || params.xaddr || 'default';
    if (this.mockMode) {
      if (!this.mockPresetState.has(key)) {
        this.mockPresetState.set(key, [...this.mockPresets]);
      }
      const presets = this.mockPresetState.get(key)!;
      this.mockPresetState.set(key, presets.filter((p) => p.token !== presetToken));
      return;
    }

    const device = this.createDevice(params);
    await device.init();
    if (profileToken) {
      device.changeProfile(profileToken);
    }

    if (!device.services?.ptz) {
      throw new Error('Camera does not support PTZ service');
    }

    const targetProfile = device.current_profile?.token || profileToken;
    await device.services.ptz.removePreset({
      ProfileToken: targetProfile,
      PresetToken: presetToken,
    });
  }
}

export const onvifCameraProvider = new OnvifCameraProvider();
export default onvifCameraProvider;
