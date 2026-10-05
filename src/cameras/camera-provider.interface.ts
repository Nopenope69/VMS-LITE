export interface DiscoveredCamera {
  urn: string;
  name?: string;
  xaddr: string;
  ip: string;
  port: number;
}

export type StreamRole = 'PRIMARY' | 'SUB';

export interface StreamDescriptor {
  role: StreamRole;
  rtspUri: string;
  token?: string;
  name?: string;
  encoding: 'H264' | 'H265' | 'JPEG' | string;
  resolution?: {
    width: number;
    height: number;
  };
  fps?: number;
  hasAudio?: boolean;
}

export interface CameraStreamProfile {
  token: string;
  name: string;
  encoding: 'H264' | 'H265' | 'JPEG' | string;
  resolution: {
    width: number;
    height: number;
  };
  fps?: number;
  rtspUri: string;
  isMainStream?: boolean;
  streamRole?: StreamRole;
  hasAudio?: boolean;
}

export interface CameraDeviceDetails {
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  serialNumber?: string;
  hardwareId?: string;
}

export interface CameraConnectionParams {
  xaddr?: string;
  ip?: string;
  port?: number;
  username?: string;
  password?: string;
  timeoutMs?: number;
}

export interface PtzMoveParams {
  speed: {
    x?: number; // Pan: -1.0 (left) to 1.0 (right)
    y?: number; // Tilt: -1.0 (down) to 1.0 (up)
    z?: number; // Zoom: -1.0 (out) to 1.0 (in)
  };
  timeout?: number; // ONVIF hardware timeout in seconds
}

export interface CameraPreset {
  token: string;
  name: string;
}

/**
 * Capability: Network discovery of cameras (WS-Discovery probe, multicast).
 */
export interface ICameraDiscovery {
  discover(timeoutMs?: number): Promise<DiscoveredCamera[]>;
}

/**
 * Capability: Hardware & model information inspection and socket reachability probing.
 */
export interface ICameraDeviceInfo {
  probe(ip: string, port: number, timeoutMs?: number): Promise<boolean>;
  getDeviceInformation(params: CameraConnectionParams): Promise<CameraDeviceDetails>;
}

/**
 * Capability: Stream role negotiation (PRIMARY high-res vs SUB low-res) and RTSP URL resolution.
 */
export interface ICameraStreamProvider {
  getStreams?(params: CameraConnectionParams): Promise<StreamDescriptor[]>;
  getProfiles(params: CameraConnectionParams): Promise<CameraStreamProfile[]>;
  getStreamUri(params: CameraConnectionParams, profileToken?: string): Promise<string>;
}

/**
 * Capability: Pan-Tilt-Zoom continuous moves, stops, and named presets.
 */
export interface ICameraPtzController {
  ptzMove(params: CameraConnectionParams, move: PtzMoveParams, profileToken?: string): Promise<void>;
  ptzStop(params: CameraConnectionParams, profileToken?: string): Promise<void>;
  getPresets(params: CameraConnectionParams, profileToken?: string): Promise<CameraPreset[]>;
  gotoPreset(params: CameraConnectionParams, presetToken: string, profileToken?: string): Promise<void>;
  setPreset(params: CameraConnectionParams, presetName: string, profileToken?: string): Promise<string>;
  removePreset(params: CameraConnectionParams, presetToken: string, profileToken?: string): Promise<void>;
}

/**
 * Capability: In-camera event subscriptions (e.g. ONVIF Pull-Point motion / tampering).
 */
export interface ICameraEventProvider {
  subscribeEvents?(params: CameraConnectionParams, onEvent: (evt: unknown) => void): Promise<() => Promise<void>>;
}

/**
 * Unified camera provider interface (combines discovery, device info, streams, and PTZ).
 * Implemented by full-featured ONVIF Profile T/S adapters.
 */
export interface ICameraProvider
  extends ICameraDiscovery,
    ICameraDeviceInfo,
    ICameraStreamProvider,
    ICameraPtzController {}
