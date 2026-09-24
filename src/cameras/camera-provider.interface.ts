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

  /**
   * Commands camera to continuously move Pan, Tilt, or Zoom.
   */
  ptzMove(params: CameraConnectionParams, move: PtzMoveParams, profileToken?: string): Promise<void>;

  /**
   * Immediately halts active PTZ movement.
   */
  ptzStop(params: CameraConnectionParams, profileToken?: string): Promise<void>;

  /**
   * Retrieves saved presets from the camera.
   */
  getPresets(params: CameraConnectionParams, profileToken?: string): Promise<CameraPreset[]>;

  /**
   * Moves camera to target preset position.
   */
  gotoPreset(params: CameraConnectionParams, presetToken: string, profileToken?: string): Promise<void>;

  /**
   * Saves current position as a named preset and returns preset token.
   */
  setPreset(params: CameraConnectionParams, presetName: string, profileToken?: string): Promise<string>;

  /**
   * Deletes a saved preset from the camera.
   */
  removePreset(params: CameraConnectionParams, presetToken: string, profileToken?: string): Promise<void>;
}

