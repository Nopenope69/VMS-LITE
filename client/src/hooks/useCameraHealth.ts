import { useState, useEffect, useCallback, useRef } from 'react';

export type CameraHealthStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE';

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
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/cameras/health', {
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
