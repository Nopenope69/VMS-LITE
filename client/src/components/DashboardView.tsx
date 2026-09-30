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
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  token,
  isAdmin = false,
  onNavigate,
  onOpenSettingsModal,
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
    <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Top Banner: Node Health & Uptime */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: isCritical ? '#450a0a' : isDegraded ? '#451a03' : '#082f49',
          border: `1px solid ${
            isCritical ? '#b91c1c' : isDegraded ? '#d97706' : '#0284c7'
          }`,
          borderRadius: '8px',
          padding: '16px 20px',
          marginBottom: '24px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '8px',
              backgroundColor: isCritical ? '#7f1d1d' : isDegraded ? '#78350f' : '#0369a1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            {isCritical ? (
              <XCircle size={24} style={{ color: '#f87171' }} />
            ) : isDegraded ? (
              <AlertTriangle size={24} style={{ color: '#fbbf24' }} />
            ) : (
              <ShieldCheck size={24} style={{ color: '#38bdf8' }} />
            )}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: isCritical ? '#fca5a5' : isDegraded ? '#fde68a' : '#7dd3fc',
                }}
              >
                System Status
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: isCritical
                    ? '#991b1b'
                    : isDegraded
                    ? '#b45309'
                    : '#0284c7',
                  color: '#ffffff',
                }}
              >
                {status}
              </span>
            </div>
            <div style={{ fontSize: '13px', color: '#cbd5e1', marginTop: '4px' }}>
              {isCritical
                ? 'Action Required: One or more cameras or storage thresholds require immediate intervention.'
                : isDegraded
                ? 'Advisory: Hardware telemetry detects degraded latency or high storage utilization.'
                : 'All surveillance subsystems operating within nominal performance thresholds.'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {data && (
            <>
              {data.ntpSync && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: 'monospace',
                    backgroundColor: data.ntpSync.synchronized
                      ? 'rgba(34, 197, 94, 0.15)'
                      : data.ntpSync.available
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(148, 163, 184, 0.15)',
                    color: data.ntpSync.synchronized
                      ? '#4ade80'
                      : data.ntpSync.available
                      ? '#f87171'
                      : '#94a3b8',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${
                      data.ntpSync.synchronized
                        ? 'rgba(34, 197, 94, 0.3)'
                        : data.ntpSync.available
                        ? 'rgba(239, 68, 68, 0.3)'
                        : 'rgba(148, 163, 184, 0.3)'
                    }`,
                  }}
                  title={
                    data.ntpSync.synchronized
                      ? 'System clock synchronized via NTP'
                      : data.ntpSync.available
                      ? 'NTP enabled but not synchronized'
                      : 'NTP service not available on host'
                  }
                >
                  <Globe size={14} />
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
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: '#cbd5e1',
                  fontFamily: 'monospace',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <Clock size={16} style={{ color: '#38bdf8' }} />
                <span>UPTIME: {formatUptime(data.uptimeSeconds)}</span>
              </div>
            </>
          )}
          <button
            onClick={fetchDashboard}
            title="Refresh System Metrics"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '6px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              color: '#cbd5e1',
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 3 Metric Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '20px',
          marginBottom: '24px',
        }}
      >
        {/* CARD 1: CAMERA FLEET */}
        <div
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: '#94a3b8',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <span>Camera Fleet Health</span>
            <Camera size={18} style={{ color: '#0284c7' }} />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '10px',
              marginTop: '12px',
            }}
          >
            <span style={{ fontSize: '32px', fontWeight: 800, color: '#f8fafc' }}>
              {data ? data.fleet.online : 0}
            </span>
            <span style={{ fontSize: '14px', color: '#94a3b8' }}>
              / {data ? data.fleet.total : 0} Online
            </span>
          </div>

          {/* Breakdown tags */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              marginTop: '16px',
              paddingTop: '14px',
              borderTop: '1px solid #334155',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
                }}
              />
              <span style={{ color: '#cbd5e1' }}>{data ? data.fleet.online : 0} Online</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#f59e0b',
                }}
              />
              <span style={{ color: '#cbd5e1' }}>{data ? data.fleet.degraded : 0} Degraded</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                }}
              />
              <span style={{ color: '#cbd5e1' }}>{data ? data.fleet.offline : 0} Offline</span>
            </div>
          </div>
        </div>

        {/* CARD 2: RECORDING ENGINES */}
        <div
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: '#94a3b8',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <span>Recording Engines</span>
            <Film size={18} style={{ color: '#38bdf8' }} />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '10px',
              marginTop: '12px',
            }}
          >
            <span style={{ fontSize: '32px', fontWeight: 800, color: '#f8fafc' }}>
              {data ? data.recording.total : 0}
            </span>
            <span style={{ fontSize: '14px', color: '#94a3b8' }}>
              Mode: {data ? data.recording.mode : 'CONTINUOUS'}
            </span>
          </div>

          {/* Buffer diagnostics */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '16px',
              paddingTop: '14px',
              borderTop: '1px solid #334155',
              fontSize: '12px',
              color: '#cbd5e1',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Radio size={14} style={{ color: '#38bdf8' }} />
              <span>
                {data ? data.recording.motionBufferedSegments : 0} Segments Cached (Ring Buffer)
              </span>
            </div>
            <div>
              {data && data.recording.activeIncidentsCount > 0 ? (
                <span style={{ color: '#f87171', fontWeight: 700 }}>
                  ● {data.recording.activeIncidentsCount} Active Incident(s)
                </span>
              ) : (
                <span style={{ color: '#64748b' }}>Standby</span>
              )}
            </div>
          </div>
        </div>

        {/* CARD 3: STORAGE RETENTION */}
        <div
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: '#94a3b8',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <span>Storage Pool & Retention</span>
            <HardDrive size={18} style={{ color: '#22c55e' }} />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '10px',
              marginTop: '12px',
            }}
          >
            <span style={{ fontSize: '32px', fontWeight: 800, color: '#f8fafc' }}>
              {data ? data.storage.usedPercent : 0}%
            </span>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              {data ? formatBytes(data.storage.usedBytes) : '0 GB'} /{' '}
              {data ? formatBytes(data.storage.totalBytes) : '0 GB'}
            </span>
          </div>

          {/* Progress bar */}
          <div
            style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#334155',
              borderRadius: '4px',
              marginTop: '12px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${data ? Math.min(100, data.storage.usedPercent) : 0}%`,
                height: '100%',
                backgroundColor:
                  (data?.storage?.usedPercent ?? 0) >= (data?.storage?.criticalThresholdPercent ?? 90)
                    ? '#ef4444'
                    : (data?.storage?.usedPercent ?? 0) >= (data?.storage?.warningThresholdPercent ?? 80)
                    ? '#f59e0b'
                    : '#0284c7',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '12px',
              fontSize: '12px',
              color: '#94a3b8',
            }}
          >
            <span>Est. {data ? data.storage.estimatedDaysRemaining : 15} Days Retention</span>
            <span>FIFO Target: {data ? data.storage.warningThresholdPercent : 80}%</span>
          </div>
        </div>
      </div>

      {/* S.M.A.R.T. Hardware Drive Telemetry */}
      {drives.length > 0 && <DriveTelemetryCard drives={drives} />}

      {/* Quick Action Navigation Buttons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
          marginBottom: '28px',
        }}
      >
        <button
          onClick={() => onNavigate('live')}
          style={{
            padding: '14px 18px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '13px',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Video size={18} style={{ color: '#0284c7' }} />
            <span>Launch Live Grid</span>
          </div>
          <ArrowRight size={14} style={{ color: '#64748b' }} />
        </button>

        <button
          onClick={() => onNavigate('playback')}
          style={{
            padding: '14px 18px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '13px',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Film size={18} style={{ color: '#38bdf8' }} />
            <span>Search 24h Playback</span>
          </div>
          <ArrowRight size={14} style={{ color: '#64748b' }} />
        </button>

        <button
          onClick={() => onNavigate('cameras')}
          style={{
            padding: '14px 18px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '13px',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Camera size={18} style={{ color: '#22c55e' }} />
            <span>Camera Fleet Roster</span>
          </div>
          <ArrowRight size={14} style={{ color: '#64748b' }} />
        </button>

        {onOpenSettingsModal && (
          <button
            onClick={onOpenSettingsModal}
            style={{
              padding: '14px 18px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sliders size={18} style={{ color: '#f59e0b' }} />
              <span>Operational Settings</span>
            </div>
            <ArrowRight size={14} style={{ color: '#64748b' }} />
          </button>
        )}
      </div>

      {/* Recent Security Alerts Table (Last 24 Hours) */}
      <div
        style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bell size={18} style={{ color: '#f59e0b' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f8fafc' }}>
              Recent Security Events & System Alerts (24H)
            </h3>
          </div>
          <button
            onClick={() => onNavigate('events')}
            style={{
              background: 'none',
              border: 'none',
              color: '#38bdf8',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>View Full Log</span>
            <ArrowRight size={12} />
          </button>
        </div>

        {(!data?.recentEvents || data.recentEvents.length === 0) ? (
          <div
            style={{
              padding: '32px',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '13px',
            }}
          >
            <CheckCircle2 size={32} style={{ color: '#22c55e', margin: '0 auto 8px auto' }} />
            <p style={{ margin: 0 }}>No critical security alerts in the past 24 hours.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.recentEvents.map((evt) => {
              const isCrit = evt.severity === 'critical';
              const isWarn = evt.severity === 'warning';
              return (
                <div
                  key={evt.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '6px',
                    backgroundColor: '#0f172a',
                    border: '1px solid #1e293b',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {isCrit ? (
                      <XCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                    ) : isWarn ? (
                      <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    ) : (
                      <Radio size={16} style={{ color: '#38bdf8', flexShrink: 0 }} />
                    )}
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                        {evt.type}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                        Source: {evt.source} {evt.cameraId ? `| Camera: ${evt.cameraId}` : ''}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: '#64748b',
                      }}
                    >
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                    <button
                      onClick={() => onNavigate('playback')}
                      title="Inspect in 24h Timeline Playback"
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '4px',
                        color: '#38bdf8',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
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
        <div
          style={{
            marginTop: '24px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Archive size={18} style={{ color: '#38bdf8' }} />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f8fafc' }}>
                Appliance Operations & Maintenance
              </h3>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
              ADMIN PRIVILEGES ACTIVE
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '12px',
            }}
          >
            <button
              onClick={() => setIsBackupModalOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 16px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f8fafc',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
              }}
            >
              <Archive size={16} style={{ color: '#38bdf8' }} />
              <span>Backup & Restore Config</span>
            </button>

            <button
              onClick={handleShutdown}
              disabled={isShuttingDown}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 16px',
                backgroundColor: '#0f172a',
                border: '1px solid #7f1d1d',
                borderRadius: '6px',
                color: '#fca5a5',
                cursor: isShuttingDown ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '13px',
                opacity: isShuttingDown ? 0.6 : 1,
              }}
            >
              <Power size={16} style={{ color: '#ef4444' }} />
              <span>{isShuttingDown ? 'Flushing Buffers...' : 'Restart VMS Service'}</span>
            </button>
          </div>

          {shutdownMessage && (
            <div
              style={{
                marginTop: '12px',
                padding: '10px 14px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid #ef4444',
                borderRadius: '6px',
                color: '#f87171',
                fontSize: '13px',
              }}
            >
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
