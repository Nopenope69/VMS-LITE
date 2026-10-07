import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../api/client.js';

export type CameraHealthStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';

export type NetworkCheckResult = 'PASSED' | 'FAILED' | 'NOT_APPLICABLE';

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
  /** Codec of the main stream as received, e.g. H264 / H265 */
  videoCodec?: string | null;
  /** The camera has a sub-stream (live grids play it) */
  hasSubStream?: boolean;
  /** Codec of the sub-stream; null until it has been pulled (it starts on demand) */
  subVideoCodec?: string | null;
  subBitrateKbps?: number | null;
}

export interface CameraHealthSummaryResponse {
  totalCameras: number;
  onlineCount: number;
  degradedCount: number;
  offlineCount: number;
  unknownCount?: number;
  cameras: Record<string, CameraHealthTelemetry>;
  checkedAt: string;
}

export interface UseCameraHealthOptions {
  intervalMs?: number;
  enabled?: boolean;
}

export interface UseCameraHealthResult {
  healthMap: Record<string, CameraHealthTelemetry>;
  summary: CameraHealthSummaryResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Centralized polling hook for camera health diagnostics (EXT-06).
 * Polls GET /api/cameras/health once per interval to supply telemetry to all grid tiles.
 */
export function useCameraHealth(options: UseCameraHealthOptions = {}): UseCameraHealthResult {
  const { intervalMs = 15000, enabled = true } = options;

  const [healthMap, setHealthMap] = useState<Record<string, CameraHealthTelemetry>>({});
  const [summary, setSummary] = useState<CameraHealthSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  const fetchHealth = useCallback(async () => {
    try {
      const token = localStorage.getItem('vms_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await apiFetch('/api/cameras/health', {
        method: 'GET',
        headers,
      });

      if (!res.ok) {
        if (res.status === 403) {
          // Capability missing or non-operator/admin role - silently disable or set error
          setError('Camera health capability unavailable or insufficient permissions');
          return;
        }
        throw new Error(`Failed to fetch camera health (${res.status})`);
      }

      const data: CameraHealthSummaryResponse = await res.json();
      if (isMountedRef.current) {
        setSummary(data);
        setHealthMap(data.cameras || {});
        setError(null);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Error fetching camera health');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) return;

    fetchHealth();

    const timer = setInterval(() => {
      fetchHealth();
    }, intervalMs);

    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [enabled, intervalMs, fetchHealth]);

  return {
    healthMap,
    summary,
    loading,
    error,
    refresh: fetchHealth,
  };
}

export default useCameraHealth;
