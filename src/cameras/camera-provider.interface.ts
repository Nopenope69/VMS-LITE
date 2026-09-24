export interface DiscoveredCamera {
  urn: string;
  name?: string;
  xaddr: string;
  ip: string;
  port: number;
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

export interface ICameraProvider {
  /**
   * Discovers ONVIF compliant cameras on the local network via WS-Discovery probe.
   */
  discover(timeoutMs?: number): Promise<DiscoveredCamera[]>;

  /**
   * Tests reachability of an IP camera port.
   */
  probe(ip: string, port: number, timeoutMs?: number): Promise<boolean>;

  /**
   * Retrieves manufacturer, model, and hardware details for a camera.
   */
  getDeviceInformation(params: CameraConnectionParams): Promise<CameraDeviceDetails>;

  /**
   * Extracts available video stream profiles, prioritizing Profile T / high-res
   * for Main Stream and lower resolution for Sub Stream.
   */
  getProfiles(params: CameraConnectionParams): Promise<CameraStreamProfile[]>;

  /**
   * Resolves direct RTSP stream URI for a given profile token.
   */
  getStreamUri(params: CameraConnectionParams, profileToken?: string): Promise<string>;
}
