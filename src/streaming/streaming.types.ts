export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CameraStreamInfo {
  cameraId: string;
  name: string;
  mediaMtxPath: string;
  subStreamPath?: string | null;
  whepUrl: string;
  subStreamWhepUrl?: string | null;
  hlsUrl: string;
  subStreamHlsUrl?: string | null;
}

export interface StreamingConfigDto {
  whepBaseUrl: string;
  hlsBaseUrl: string;
  iceServers: IceServerConfig[];
  cameras: CameraStreamInfo[];
}
