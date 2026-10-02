/**
 * Camera Health Types & DTOs (EXT-06)
 */

export type CameraHealthStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';

export type NetworkCheckResult = 'PASSED' | 'FAILED' | 'NOT_APPLICABLE';

export interface MediaMtxRuntimeInfo {
  ready: boolean;
  bytesReceived: number;
  /** Codec names as MediaMTX reports them, e.g. ["H265", "MPEG-4 Audio"] */
  tracks?: string[];
}

export interface IMediaMtxRuntimeAdapter {
  getPathRuntime(path: string): Promise<MediaMtxRuntimeInfo | null>;
}

export interface CameraHealthTelemetry {
  cameraId: string;
  status: CameraHealthStatus;
  latencyMs: number | null;
  bitrateKbps: number | null;
  bytesReceived: number;
  lastChecked: string | null;
  consecutiveFailures: number;
  unhealthySince: string | null;
  networkCheck?: NetworkCheckResult;
  reason?: string;
  /** Video codec of the main stream as received ("H264", "H265", ...), null until known */
  videoCodec?: string | null;
  /** The camera has a sub-stream (multi-camera grids play it) */
  hasSubStream?: boolean;
  /** Sub-stream codec; null until the sub-stream has been pulled (it starts on demand) */
  subVideoCodec?: string | null;
  subBitrateKbps?: number | null;
}

export interface CameraHealthSummaryResponse {
  totalCameras: number;
  onlineCount: number;
  degradedCount: number;
  offlineCount: number;
  unknownCount: number;
  cameras: Record<string, CameraHealthTelemetry>;
  checkedAt: string;
}

export interface CameraHealthEventMetadata {
  cameraId: string;
  cameraName: string;
  status: CameraHealthStatus;
  previousStatus?: CameraHealthStatus;
  reason?: string;
  latencyMs?: number | null;
  bitrateKbps?: number | null;
  consecutiveFailures: number;
  outageDurationMs?: number | null;
  networkCheck?: NetworkCheckResult;
  timestamp: string; // ISO-8601
  /** Set when the transition is part of a site link outage (site id); alert channels send the site alert instead */
  siteOutage?: string;
}
