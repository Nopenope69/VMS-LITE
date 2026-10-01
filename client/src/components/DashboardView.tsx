import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Clock,
  Video,
  Film,
  Camera,
  HardDrive,
  RefreshCw,
  Bell,
  ArrowRight,
  Sliders,
  Radio,
  CheckCircle2,
  Power,
  Archive,
  Globe,
  FileText,
  Shield,
} from 'lucide-react';
import { BackupRestoreModal } from './BackupRestoreModal.js';
import { DriveTelemetryCard, DriveItem } from './DriveTelemetryCard.js';

export interface DashboardData {
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  uptimeSeconds: number;
  ntpSync?: {
    synchronized: boolean;
    available: boolean;
  };
  drives?: {
    totalDrives: number;
    healthyCount: number;
    warningCount: number;
    criticalCount: number;
    maxTemperatureCelsius: number | null;
  };
  fleet: {
    total: number;
    online: number;
    degraded: number;
    offline: number;
    unknown: number;
  };
  recording: {
    total: number;
    mode: string;
    motionBufferedSegments: number;
    activeIncidentsCount: number;
  };
  storage: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
    warningThresholdPercent: number;
    criticalThresholdPercent: number;
    retentionDays: number;
    estimatedDaysRemaining: number;
  };
  licensing: {
    edition: string;
    cameraLimit: number;
    isExpired: boolean;
  };
  recentEvents: Array<{
    id: string;
    cameraId?: string | null;
    timestamp: string;
    type: string;
    source: string;
    severity: string;
    metadata?: any;
  }>;
}

export interface DashboardViewProps {
  token: string;
  isAdmin?: boolean;
  onNavigate: (view: 'live' | 'playback' | 'cameras' | 'events' | 'settings') => void;
  onOpenSettingsModal?: () => void;
  onOpenAuditModal?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  token,
  isAdmin = false,
  onNavigate,
  onOpenSettingsModal,
  onOpenAuditModal,
}) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [shutdownMessage, setShutdownMessage] = useState<string | null>(null);

  const handleShutdown = async () => {
    if (!window.confirm('Restart VMS service? All in-progress recording segments will be flushed safely.')) {
      return;
    }
    setIsShuttingDown(true);
    try {
      const res = await fetch('/api/system/shutdown', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setShutdownMessage(json.message || 'Shutdown initiated. Service will restart shortly.');
    } catch (err: any) {
      setError(err.message || 'Failed to initiate shutdown');
      setIsShuttingDown(false);
    }
  };

  const fetchDashboard = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [dashRes, drivesRes] = await Promise.all([
        fetch('/api/system/dashboard', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/system/storage/drives', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (!dashRes.ok) {
        throw new Error(`Failed to load system dashboard (${dashRes.status})`);
      }
      const json = await dashRes.json();
      setData(json);

      if (drivesRes.ok) {
        const drivesData = await drivesRes.json();
        if (Array.isArray(drivesData.drives)) {
          setDrives(drivesData.drives);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error connecting to system monitor');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 15000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // Format bytes to GB / TB
  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  // Format seconds to human uptime "Xd Xh Xm"
  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m ${seconds % 60}s`;
  };

  const status = data?.status || 'HEALTHY';
  const isHealthy = status === 'HEALTHY';
  const isDegraded = status === 'DEGRADED';
  const isCritical = status === 'CRITICAL';

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full font-sans">
      {/* Top Banner: Node Health & Uptime */}
      <div
        className={`glass-bar border rounded-xl p-4 md:p-5 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xl ${
          isCritical
            ? 'border-rose-500/40 bg-rose-950/20'
            : isDegraded
            ? 'border-amber-500/40 bg-amber-950/20'
            : 'border-white/10'
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md shrink-0 border ${
              isCritical
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                : isDegraded
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
            }`}
          >
            {isCritical ? (
              <XCircle size={22} />
            ) : isDegraded ? (
              <AlertTriangle size={22} />
            ) : (
              <ShieldCheck size={22} />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-wider uppercase text-zinc-400">
                System Status
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${
                  isCritical
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : isDegraded
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                }`}
              >
                {status}
              </span>
            </div>
            <div className="text-xs text-zinc-300 mt-1">
              {isCritical
                ? 'Action Required: One or more cameras or storage thresholds require immediate intervention.'
                : isDegraded
                ? 'Advisory: Hardware telemetry detects degraded latency or high storage utilization.'
                : 'All surveillance subsystems operating within nominal performance thresholds.'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          {data && (
            <>
              {data.ntpSync && (
                <div
                  className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg border ${
                    data.ntpSync.synchronized
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : data.ntpSync.available
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : 'bg-zinc-800 text-zinc-400 border-white/5'
                  }`}
                  title={
                    data.ntpSync.synchronized
                      ? 'System clock synchronized via NTP'
                      : data.ntpSync.available
                      ? 'NTP enabled but not synchronized'
                      : 'NTP service not available on host'
                  }
                >
                  <Globe size={13} />
                  <span>
                    NTP:{' '}
                    {data.ntpSync.synchronized
                      ? 'SYNCED'
                      : data.ntpSync.available
                      ? 'DRIFT'
                      : 'N/A'}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-zinc-300 font-mono hud-chip px-3 py-1 rounded-lg">
                <Clock size={14} className="text-emerald-400" />
                <span>UPTIME: {formatUptime(data.uptimeSeconds)}</span>
              </div>
            </>
          )}
          <button
            onClick={fetchDashboard}
            title="Refresh System Metrics"
            className="w-8 h-8 rounded-lg hud-chip hover:bg-white/10 text-zinc-300 flex items-center justify-center transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 3 Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* CARD 1: CAMERA FLEET */}
        <div className="hud-chip rounded-xl p-5 hover:border-white/20 transition-all shadow-md">
          <div className="flex justify-between items-center text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Camera Fleet Health</span>
            <Camera size={16} className="text-emerald-400" />
          </div>

          <div className="flex items-baseline gap-2.5 mt-3">
            <span className="text-3xl font-extrabold text-white font-mono tabular-nums">
              {data ? data.fleet.online : 0}
            </span>
            <span className="text-xs text-zinc-400 font-mono">
              / {data ? data.fleet.total : 0} Online
            </span>
          </div>

          {/* Breakdown tags */}
          <div className="flex gap-3 mt-4 pt-3 border-t border-white/5 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-zinc-300">{data ? data.fleet.online : 0} Online</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-zinc-300">{data ? data.fleet.degraded : 0} Degraded</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span className="text-zinc-300">{data ? data.fleet.offline : 0} Offline</span>
            </div>
          </div>
        </div>

        {/* CARD 2: RECORDING ENGINES */}
        <div className="hud-chip rounded-xl p-5 hover:border-white/20 transition-all shadow-md">
          <div className="flex justify-between items-center text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Recording Engines</span>
            <Film size={16} className="text-cyan-400" />
          </div>

          <div className="flex items-baseline gap-2.5 mt-3">
            <span className="text-3xl font-extrabold text-white font-mono tabular-nums">
              {data ? data.recording.total : 0}
            </span>
            <span className="text-xs text-zinc-400 font-mono">
              Mode: {data ? data.recording.mode : 'CONTINUOUS'}
            </span>
          </div>

          {/* Buffer diagnostics */}
          <div className="flex justify-between items-center mt-4 pt-3 border-t border-white/5 text-xs text-zinc-300">
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <Radio size={13} className="text-cyan-400" />
              <span>
                {data ? data.recording.motionBufferedSegments : 0} Segments Cached (Ring)
              </span>
            </div>
            <div>
              {data && data.recording.activeIncidentsCount > 0 ? (
                <span className="text-rose-400 font-semibold font-mono text-[11px] animate-pulse">
                  ● {data.recording.activeIncidentsCount} Active
                </span>
              ) : (
                <span className="text-zinc-500 font-mono text-[11px]">Standby</span>
              )}
            </div>
          </div>
        </div>

        {/* CARD 3: STORAGE RETENTION */}
        <div className="hud-chip rounded-xl p-5 hover:border-white/20 transition-all shadow-md">
          <div className="flex justify-between items-center text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Storage Pool & Retention</span>
            <HardDrive size={16} className="text-emerald-400" />
          </div>

          <div className="flex items-baseline gap-2.5 mt-3">
            <span className="text-3xl font-extrabold text-white font-mono tabular-nums">
              {data ? data.storage.usedPercent : 0}%
            </span>
            <span className="text-xs text-zinc-400 font-mono">
              {data ? formatBytes(data.storage.usedBytes) : '0 GB'} /{' '}
              {data ? formatBytes(data.storage.totalBytes) : '0 GB'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                (data?.storage?.usedPercent ?? 0) >= (data?.storage?.criticalThresholdPercent ?? 90)
                  ? 'bg-rose-500'
                  : (data?.storage?.usedPercent ?? 0) >= (data?.storage?.warningThresholdPercent ?? 80)
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
              }`}
              style={{
                width: `${data ? Math.min(100, data.storage.usedPercent) : 0}%`,
              }}
            />
          </div>

          <div className="flex justify-between mt-3 text-xs text-zinc-400 font-mono text-[11px]">
            <span>Est. {data ? data.storage.estimatedDaysRemaining : 15} Days Retention</span>
            <span>FIFO Target: {data ? data.storage.warningThresholdPercent : 80}%</span>
          </div>
        </div>
      </div>

      {/* S.M.A.R.T. Hardware Drive Telemetry */}
      {drives.length > 0 && <DriveTelemetryCard drives={drives} />}

      {/* Quick Action Navigation Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
        <button
          onClick={() => onNavigate('live')}
          className="hud-chip hover:bg-white/5 p-4 rounded-xl flex items-center justify-between text-left transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
              <Video size={16} />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Live Grid</div>
              <div className="text-[11px] text-zinc-400">Multi-feed surveillance</div>
            </div>
          </div>
          <ArrowRight size={14} className="text-zinc-500 group-hover:text-zinc-200 group-hover:translate-x-0.5 transition-all" />
        </button>

        <button
          onClick={() => onNavigate('playback')}
          className="hud-chip hover:bg-white/5 p-4 rounded-xl flex items-center justify-between text-left transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
              <Film size={16} />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">24h Playback</div>
              <div className="text-[11px] text-zinc-400">Synchronized matrix</div>
            </div>
          </div>
          <ArrowRight size={14} className="text-zinc-500 group-hover:text-zinc-200 group-hover:translate-x-0.5 transition-all" />
        </button>

        <button
          onClick={() => onNavigate('cameras')}
          className="hud-chip hover:bg-white/5 p-4 rounded-xl flex items-center justify-between text-left transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
              <Camera size={16} />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Camera Roster</div>
              <div className="text-[11px] text-zinc-400">Stream diagnostics</div>
            </div>
          </div>
          <ArrowRight size={14} className="text-zinc-500 group-hover:text-zinc-200 group-hover:translate-x-0.5 transition-all" />
        </button>

        {onOpenSettingsModal && (
          <button
            onClick={onOpenSettingsModal}
            className="hud-chip hover:bg-white/5 p-4 rounded-xl flex items-center justify-between text-left transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform">
                <Sliders size={16} />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Settings</div>
                <div className="text-[11px] text-zinc-400">Policies & schedules</div>
              </div>
            </div>
            <ArrowRight size={14} className="text-zinc-500 group-hover:text-zinc-200 group-hover:translate-x-0.5 transition-all" />
          </button>
        )}
      </div>

      {/* Recent Security Alerts Table (Last 24 Hours) */}
      <div className="alert-glass border border-white/10 rounded-xl p-5 shadow-xl mb-6">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              Recent Security Events & System Alerts (24H)
            </h3>
          </div>
          <button
            onClick={() => onNavigate('events')}
            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
          >
            <span>View Full Log</span>
            <ArrowRight size={12} />
          </button>
        </div>

        {(!data?.recentEvents || data.recentEvents.length === 0) ? (
          <div className="py-8 text-center text-zinc-500 text-xs">
            <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
            <p>No critical security alerts in the past 24 hours.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {data.recentEvents.map((evt) => {
              const isCrit = evt.severity === 'critical';
              const isWarn = evt.severity === 'warning';
              return (
                <div
                  key={evt.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-zinc-950/60 border border-white/5 text-xs hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isCrit ? (
                      <XCircle size={16} className="text-rose-400 shrink-0" />
                    ) : isWarn ? (
                      <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                    ) : (
                      <Radio size={16} className="text-emerald-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-semibold text-zinc-100">
                        {evt.type}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5 font-mono">
                        Source: {evt.source} {evt.cameraId ? `| Camera: ${evt.cameraId}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-mono text-zinc-500">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                    <button
                      onClick={() => onNavigate('playback')}
                      title="Inspect in 24h Timeline Playback"
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs font-medium transition-colors"
                    >
                      Playback
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Appliance Operations & Maintenance Section (Admin-only) */}
      {isAdmin && (
        <div className="alert-glass border border-white/10 rounded-xl p-5 shadow-xl">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <Archive size={16} className="text-cyan-400" />
              <h3 className="text-sm font-semibold text-zinc-100">
                Appliance Operations & Maintenance
              </h3>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 font-semibold uppercase tracking-wider">
              Admin Privileges Active
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              onClick={() => setIsBackupModalOpen(true)}
              className="flex items-center gap-2.5 p-3 rounded-lg bg-zinc-950/60 hover:bg-white/5 border border-white/5 text-zinc-200 text-xs font-semibold transition-colors"
            >
              <Archive size={15} className="text-cyan-400" />
              <span>Backup & Restore Config</span>
            </button>

            {onOpenAuditModal && (
              <button
                onClick={onOpenAuditModal}
                className="flex items-center gap-2.5 p-3 rounded-lg bg-zinc-950/60 hover:bg-white/5 border border-white/5 text-zinc-200 text-xs font-semibold transition-colors"
              >
                <Shield size={15} className="text-emerald-400" />
                <span>Security Audit Trail</span>
              </button>
            )}

            <button
              onClick={() => {
                window.open('/api/system/handoff-report', '_blank');
              }}
              className="flex items-center gap-2.5 p-3 rounded-lg bg-zinc-950/60 hover:bg-white/5 border border-white/5 text-zinc-200 text-xs font-semibold transition-colors"
            >
              <FileText size={15} className="text-amber-400" />
              <span>Handoff Certificate</span>
            </button>

            <button
              onClick={handleShutdown}
              disabled={isShuttingDown}
              className="flex items-center gap-2.5 p-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-300 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Power size={15} className="text-rose-400" />
              <span>{isShuttingDown ? 'Flushing Buffers...' : 'Restart VMS Service'}</span>
            </button>
          </div>

          {shutdownMessage && (
            <div className="mt-3 p-3 bg-rose-500/15 border border-rose-500/30 rounded-lg text-rose-300 text-xs font-mono">
              {shutdownMessage}
            </div>
          )}
        </div>
      )}

      {/* Backup & Restore Modal */}
      <BackupRestoreModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        token={token}
      />
    </div>
  );
};

export default DashboardView;
