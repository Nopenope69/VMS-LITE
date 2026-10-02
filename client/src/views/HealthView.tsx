import React, { useState, useEffect } from 'react';
import {
  HeartPulse,
  HardDrive,
  Wifi,
  Video,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Server,
  ArrowRight,
  Shield,
  Activity,
  Layers,
} from 'lucide-react';
import { CameraRecord } from '../App.js';
import { CameraHealthTelemetry } from '../hooks/useCameraHealth.js';
import { formatBandwidth, LINK_USAGE_STYLE, linkUsageLevel, SiteSummary } from '../types/sites.js';
import { codecLabel, codecNotes } from '../utils/codec.js';

export interface HealthViewProps {
  cameras: CameraRecord[];
  healthMap: Record<string, CameraHealthTelemetry>;
  onlineCount: number;
  offlineCount: number;
  onRefreshHealth: () => Promise<void>;
  onSelectCamera: (cameraId: string) => void;
  /** Sites in the current filter, for the link usage table */
  sites?: SiteSummary[];
}

interface SystemDashboardData {
  storage?: {
    usedPercent?: number;
    usedBytes?: number;
    totalBytes?: number;
    freeBytes?: number;
  };
  recording?: {
    healthy?: boolean;
    mode?: string;
  };
  ntp?: {
    synchronized?: boolean;
  };
}

export const HealthView: React.FC<HealthViewProps> = ({
  cameras,
  healthMap,
  onlineCount,
  offlineCount,
  onRefreshHealth,
  onSelectCamera,
  sites = [],
}) => {
  const [dashboardData, setDashboardData] = useState<SystemDashboardData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Fetch /api/system/dashboard for system metrics
  useEffect(() => {
    let isMounted = true;
    const fetchSysData = async () => {
      try {
        const token = localStorage.getItem('vms_token') || localStorage.getItem('token');
        const res = await fetch('/api/system/dashboard', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          setDashboardData(data);
        }
      } catch {
        // Fallback gracefully
      }
    };
    fetchSysData();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshHealth();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // Storage metric calculation
  // null until the dashboard has reported real usage (never show a placeholder number)
  const storagePercent: number | null = dashboardData?.storage?.usedPercent ?? null;

  // Recording status
  const isRecordingHealthy = offlineCount === 0 || onlineCount > 0;

  // Network status
  const degradedCount = Object.values(healthMap).filter(
    (h) => h.status === 'DEGRADED' || (h.latencyMs && h.latencyMs > 250)
  ).length;
  const isNetworkHealthy = degradedCount === 0;

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 md:py-10 flex flex-col font-sans select-none overflow-y-auto">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white">Health</h1>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            System & Fleet Telemetry · Monitored in real-time
          </p>
        </div>

        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-zinc-300 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Top 4 Core Health Indicators (Linear / Raycast Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {/* 1. Camera Fleet */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.07] flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
          <div>
            <div className="text-xs font-semibold text-zinc-100">
              {onlineCount} {onlineCount === 1 ? 'camera' : 'cameras'} online
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
              {offlineCount > 0 ? `${offlineCount} offline` : 'Fleet 100% active'}
            </div>
          </div>
        </div>

        {/* 2. Recording Status */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.07] flex items-center gap-3">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isRecordingHealthy
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
            }`}
          />
          <div>
            <div className="text-xs font-semibold text-zinc-100">
              {isRecordingHealthy ? 'Recording healthy' : 'Recording warning'}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
              Continuous & Motion
            </div>
          </div>
        </div>

        {/* 3. Storage */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.07] flex items-center gap-3">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              storagePercent === null
                ? 'bg-zinc-500'
                : storagePercent > 90
                ? 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]'
                : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
            }`}
          />
          <div>
            <div className="text-xs font-semibold text-zinc-100">
              Storage {storagePercent === null ? '—' : `${Math.round(storagePercent)}%`}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
              Auto-pruning enabled
            </div>
          </div>
        </div>

        {/* 4. Network */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.07] flex items-center gap-3">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isNetworkHealthy
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
            }`}
          />
          <div>
            <div className="text-xs font-semibold text-zinc-100">
              {isNetworkHealthy ? 'Network healthy' : 'Network jitter detected'}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
              {degradedCount > 0 ? `${degradedCount} degraded` : 'RTSP & WebRTC low latency'}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px w-full bg-white/[0.07] mb-8" />

      {/* Site links: video each site sends to this server, against its uplink */}
      {sites.some((s) => s.id && s.cameraCount > 0) && (
        <div className="space-y-4 mb-8">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Site Links</h2>
          <div className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.04]" data-testid="site-links">
            {sites
              .filter((s) => s.id && s.cameraCount > 0)
              .map((site) => {
                const level = linkUsageLevel(site.linkUsage);
                const style = level ? LINK_USAGE_STYLE[level] : LINK_USAGE_STYLE.ok;
                return (
                  <div key={site.id} className="px-4 py-3 flex items-center gap-4 text-xs">
                    <div className="w-40 truncate text-white font-medium">{site.name}</div>
                    <div className="w-24 font-mono text-zinc-300 tabular-nums">
                      {site.bandwidthKbps !== null && site.bandwidthKbps !== undefined
                        ? formatBandwidth(site.bandwidthKbps)
                        : '—'}
                    </div>
                    <div className="flex-1">
                      {site.uplinkMbps ? (
                        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className={`h-full ${style.bar}`}
                            style={{ width: `${Math.min(100, (site.linkUsage ?? 0) * 100)}%` }}
                          />
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-600">Set the uplink in Settings → Sites to see usage</span>
                      )}
                    </div>
                    <div className={`w-36 text-right font-mono text-[11px] ${style.text}`}>
                      {site.uplinkMbps
                        ? `${Math.round((site.linkUsage ?? 0) * 100)}% of ${site.uplinkMbps} Mbps${level === 'saturated' ? ' · full' : ''}`
                        : ''}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Camera Fleet Connectivity Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Camera Connectivity
          </h2>
          <span className="text-[11px] font-mono text-zinc-500">
            {cameras.length} registered
          </span>
        </div>

        <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
          {cameras.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 font-medium">
              No cameras registered yet.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {cameras.map((camera) => {
                const telemetry = healthMap[camera.id];
                const isOnline = telemetry ? telemetry.status === 'ONLINE' : camera.status === 'ONLINE';
                const isDegraded = telemetry?.status === 'DEGRADED' || (telemetry?.latencyMs && telemetry.latencyMs > 300);

                let statusBadge = (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                    <span>Online</span>
                  </div>
                );

                if (isDegraded) {
                  statusBadge = (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>High packet loss</span>
                    </div>
                  );
                } else if (!isOnline) {
                  statusBadge = (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                      <span>Offline</span>
                    </div>
                  );
                }

                return (
                  <div
                    key={camera.id}
                    onClick={() => onSelectCamera(camera.id)}
                    className="flex items-center justify-between px-4 py-3.5 hover:bg-white/[0.03] transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200 transition-colors">
                        <Video className="w-4 h-4" />
                      </div>

                      <div>
                        <div className="text-xs font-medium text-white group-hover:text-emerald-300 transition-colors">
                          {camera.name}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          {camera.ipAddress} {camera.manufacturer ? `· ${camera.manufacturer}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      {/* Stream bitrate and codec */}
                      {telemetry?.bitrateKbps !== null && telemetry?.bitrateKbps !== undefined && (
                        <div className="hidden sm:block text-right">
                          <div
                            className={`text-xs font-mono tabular-nums ${
                              codecNotes(telemetry).length ? 'text-amber-400' : 'text-zinc-400'
                            }`}
                            title={codecNotes(telemetry)[0]}
                          >
                            {formatBandwidth(telemetry.bitrateKbps + (telemetry.subBitrateKbps ?? 0))}
                          </div>
                          <div className="text-[10px] text-zinc-600 font-mono">
                            {telemetry.videoCodec ? codecLabel(telemetry.videoCodec) : 'bitrate'}
                          </div>
                        </div>
                      )}
                      {/* Latency & Bitrate if available */}
                      {telemetry?.latencyMs !== null && telemetry?.latencyMs !== undefined && (
                        <div className="hidden sm:block text-right">
                          <div className="text-xs font-mono text-zinc-400 tabular-nums">
                            {telemetry.latencyMs}ms
                          </div>
                          <div className="text-[10px] text-zinc-600 font-mono">latency</div>
                        </div>
                      )}

                      {/* Status */}
                      <div className="w-32 flex justify-start">
                        {statusBadge}
                      </div>

                      {/* Jump arrow */}
                      <div className="text-zinc-600 group-hover:text-zinc-300 transition-colors">
                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
