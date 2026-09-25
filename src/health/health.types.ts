/**
 * Camera Health Types & DTOs (EXT-06)
 */

export type CameraHealthStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE';

export interface MediaMtxRuntimeInfo {
  ready: boolean;
  bytesReceived: number;
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
  lastChecked: string;
  consecutiveFailures: number;
  unhealthySince: string | null;
  reason?: string;
}

export interface CameraHealthSummaryResponse {
  totalCameras: number;
  onlineCount: number;
  degradedCount: number;
  offlineCount: number;
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
  timestamp: string; // ISO-8601
}
