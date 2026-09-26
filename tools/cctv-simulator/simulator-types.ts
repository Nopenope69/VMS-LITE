export interface VirtualCamera {
  id: string;
  channelNumber: number;
  name: string;
  ip: string;
  rtspPort: number;
  onvifPort: number;
  httpPort: number;
  username: string;
  password: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  mediaSource: string; // filename or procedural type
  mediaTitle: string;
  mainResolution: string; // e.g. 1920x1080
  subResolution: string;  // e.g. 640x360
  fps: number;
  bitrateKbps: number;
  rtspUrlMain: string;
  rtspUrlSub: string;
  mediaMtxPathMain: string;
  mediaMtxPathSub: string;
  status: 'streaming' | 'standby' | 'alarm';
  lastMotionAt?: string;
  ptz: {
    pan: number;  // -180 to 180
    tilt: number; // -90 to 90
    zoom: number; // 1 to 10
  };
}

export interface VideoClipInfo {
  id: string;
  title: string;
  category: 'gate' | 'warehouse' | 'production' | 'perimeter' | 'office' | 'procedural' | 'custom';
  filename: string;
  durationSeconds: number;
  resolution: string;
  fps: number;
  description: string;
  hasAudio: boolean;
}

export interface SimulatorStateData {
  cameraCount: number;
  cameras: VirtualCamera[];
  globalFps: number;
  mediaMtxHost: string;
  mediaMtxRtspPort: number;
  mediaMtxWhepPort: number;
  mediaMtxHlsPort: number;
  onvifDiscoveryEnabled: boolean;
  vmsApiUrl: string;
}
