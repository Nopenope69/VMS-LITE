import net from 'node:net';
import {
  CameraConnectionParams,
  CameraDeviceDetails,
  CameraStreamProfile,
  ICameraDeviceInfo,
  ICameraStreamProvider,
  StreamDescriptor,
} from './camera-provider.interface.js';

export interface RtspAdapterOptions {
  defaultTimeoutMs?: number;
}

/**
 * Lightweight camera adapter for generic RTSP feeds, NVR channels, or unmanaged IP cameras.
 *
 * Implements discrete capabilities:
 * - ICameraStreamProvider (PRIMARY stream, optional SUB stream)
 * - ICameraDeviceInfo (TCP socket probing)
 *
 * Deliberately excludes PTZ and WS-Discovery overhead.
 */
export class RtspCameraAdapter implements ICameraStreamProvider, ICameraDeviceInfo {
  private readonly defaultTimeoutMs: number;

  constructor(opts: RtspAdapterOptions = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 3000;
  }

  /**
   * Tests socket reachability of RTSP port (default 554).
   */
  async probe(ip: string, port: number = 554, timeoutMs?: number): Promise<boolean> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    return new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);

      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, ip);
    });
  }

  /**
   * Returns generic device details for unmanaged RTSP stream.
   */
  async getDeviceInformation(params: CameraConnectionParams): Promise<CameraDeviceDetails> {
    return {
      manufacturer: 'Generic RTSP',
      model: 'Network Stream',
      firmwareVersion: '1.0.0',
      hardwareId: params.ip ? `rtsp-${params.ip}` : 'generic-rtsp',
    };
  }

  /**
   * Extracts available stream descriptors for PRIMARY and optional SUB streams.
   */
  async getStreams(params: CameraConnectionParams): Promise<StreamDescriptor[]> {
    const profiles = await this.getProfiles(params);
    return profiles.map((p) => ({
      role: p.streamRole || (p.isMainStream ? 'PRIMARY' : 'SUB'),
      rtspUri: p.rtspUri,
      token: p.token,
      name: p.name,
      encoding: p.encoding,
      resolution: p.resolution,
      fps: p.fps,
      hasAudio: p.hasAudio,
    }));
  }

  /**
   * Adapts connection params into standard CameraStreamProfile list.
   */
  async getProfiles(params: CameraConnectionParams): Promise<CameraStreamProfile[]> {
    const baseUri = params.xaddr || `rtsp://${params.ip || 'localhost'}:${params.port || 554}/live`;
    const rtspUri = params.username && params.password
      ? baseUri.replace('rtsp://', `rtsp://${encodeURIComponent(params.username)}:${encodeURIComponent(params.password)}@`)
      : baseUri;

    return [
      {
        token: 'profile_primary',
        name: 'Primary Stream',
        encoding: 'H264',
        resolution: { width: 1920, height: 1080 },
        fps: 25,
        rtspUri,
        isMainStream: true,
        streamRole: 'PRIMARY',
        hasAudio: false,
      },
    ];
  }

  /**
   * Resolves direct RTSP stream URI.
   */
  async getStreamUri(params: CameraConnectionParams, _profileToken?: string): Promise<string> {
    const profiles = await this.getProfiles(params);
    return profiles[0].rtspUri;
  }
}

export const rtspCameraAdapter = new RtspCameraAdapter();
