import React, { useState, useEffect } from 'react';
import {
  X,
  HardDrive,
  Calendar,
  Film,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Zap,
  Info,
  Clock,
  Save,
  Trash2,
} from 'lucide-react';

export interface OperationalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  token?: string | null;
  isAdmin?: boolean;
  cameras?: Array<{ id: string; name: string }>;
  onSettingsSaved?: () => void;
}

type TabType = 'recording' | 'schedule' | 'storage' | 'license';

const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const OperationalSettingsModal: React.FC<OperationalSettingsModalProps> = ({
  isOpen,
  onClose,
  token,
  isAdmin = false,
  cameras = [],
  onSettingsSaved,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('recording');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const [recordingMode, setRecordingMode] = useState<
    'CONTINUOUS' | 'MOTION_ONLY' | 'SCHEDULED' | 'MANUAL_OFF'
  >('CONTINUOUS');
  const [retentionDays, setRetentionDays] = useState<number>(15);
  const [warningThreshold, setWarningThreshold] = useState<number>(80);
  const [criticalThreshold, setCriticalThreshold] = useState<number>(90);
  const [preBufferSeconds, setPreBufferSeconds] = useState<number>(10);
  const [postBufferSeconds, setPostBufferSeconds] = useState<number>(30);
  const [motionBufferStatus, setMotionBufferStatus] = useState<{
    totalBufferedSegments: number;
    activeIncidentsCount: number;
  }>({ totalBufferedSegments: 0, activeIncidentsCount: 0 });

  // 7x24 grid: scheduleGrid[day][hour] = boolean
  const [scheduleGrid, setScheduleGrid] = useState<boolean[][]>(
    Array.from({ length: 7 }, () => Array(24).fill(true))
  );

  // Camera selector for schedule ('all' or specific cameraId)
  const [selectedCameraId, setSelectedCameraId] = useState<string>('all');

  // Storage metrics
  const [storageMetrics, setStorageMetrics] = useState<{
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
    estimatedDaysRemaining?: number;
  }>({
    totalBytes: 100 * 1024 * 1024 * 1024,
    usedBytes: 15 * 1024 * 1024 * 1024,
    freeBytes: 85 * 1024 * 1024 * 1024,
    usedPercent: 15,
    estimatedDaysRemaining: 28,
  });

  // Licensing details
  const [licensingInfo, setLicensingInfo] = useState<{
    edition: string;
    cameraLimit: number;
    activeCapabilities: string[];
    isExpired: boolean;
  }>({
    edition: 'core',
    cameraLimit: 16,
    activeCapabilities: [
      'core.live',
      'core.record',
      'core.playback',
      'core.events',
      'core.onvif',
      'core.camera_health',
      'extended.camera_health',
    ],
    isExpired: false,
  });

  // Drag-to-paint state for schedule grid
  const [isPainting, setIsPainting] = useState(false);
  const [paintValue, setPaintValue] = useState(true);

  // Fetch operational settings on mount
  useEffect(() => {
    if (!isOpen) return;
    loadOperationalSettings();
  }, [isOpen, token]);

  const loadOperationalSettings = async () => {
    if (!token) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/settings/operational', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setRecordingMode(data.settings.recordingMode || 'CONTINUOUS');
          setRetentionDays(data.settings.retentionDays ?? 15);
          setWarningThreshold(data.settings.warningThresholdPercent ?? 80);
          setCriticalThreshold(data.settings.criticalThresholdPercent ?? 90);
          setPreBufferSeconds(data.settings.preBufferSeconds ?? 10);
          setPostBufferSeconds(data.settings.postBufferSeconds ?? 30);
        }
        if (data.motionBuffer) {
          setMotionBufferStatus({
            totalBufferedSegments: data.motionBuffer.totalBufferedSegments ?? 0,
            activeIncidentsCount: data.motionBuffer.activeIncidentsCount ?? 0,
          });
        }
        if (data.grid && Array.isArray(data.grid) && data.grid.length === 7) {
          setScheduleGrid(data.grid);
        }
        if (data.storage) {
          setStorageMetrics(data.storage);
        }
        if (data.licensing) {
          setLicensingInfo(data.licensing);
        }
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  // When changing camera selector, load camera-specific schedule if not 'all'
  const handleCameraChange = async (camId: string) => {
    setSelectedCameraId(camId);
    if (camId === 'all') {
      loadOperationalSettings();
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`/api/settings/schedule/${camId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.schedule) {
          setRecordingMode(data.schedule.mode);
          if (data.schedule.grid) {
            setScheduleGrid(data.schedule.grid);
          }
        }
      }
    } catch {
      // Ignore error
    } finally {
      setLoading(false);
    }
  };

  // Schedule grid cell toggle
  const toggleCell = (day: number, hour: number) => {
    setScheduleGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[day][hour] = !next[day][hour];
      return next;
    });
  };

  const handleMouseDown = (day: number, hour: number) => {
    const newVal = !scheduleGrid[day][hour];
    setIsPainting(true);
    setPaintValue(newVal);
    setScheduleGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[day][hour] = newVal;
      return next;
    });
  };

  const handleMouseEnter = (day: number, hour: number) => {
    if (!isPainting) return;
    setScheduleGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[day][hour] = paintValue;
      return next;
    });
  };

  const handleMouseUp = () => {
    setIsPainting(false);
  };

  // Schedule presets
  const applyPreset = (preset: 'all' | 'business' | 'nights' | 'clear') => {
    let nextGrid: boolean[][];
    if (preset === 'all') {
      nextGrid = Array.from({ length: 7 }, () => Array(24).fill(true));
    } else if (preset === 'business') {
      nextGrid = Array.from({ length: 7 }, (_, d) => {
        if (d >= 1 && d <= 5) {
          return Array.from({ length: 24 }, (_, h) => h >= 9 && h < 18);
        }
        return Array(24).fill(false);
      });
    } else if (preset === 'nights') {
      nextGrid = Array.from({ length: 7 }, (_, d) => {
        if (d === 0 || d === 6) {
          return Array(24).fill(true);
        }
        return Array.from({ length: 24 }, (_, h) => h < 8 || h >= 18);
      });
    } else {
      nextGrid = Array.from({ length: 7 }, () => Array(24).fill(false));
    }
    setScheduleGrid(nextGrid);
  };

  // Convert grid to windows helper
  const convertGridToWindows = (grid: boolean[][]) => {
    const windows: Array<{
      dayOfWeek: number;
      startHour: number;
      startMin: number;
      endHour: number;
      endMin: number;
    }> = [];

    for (let day = 0; day < 7; day++) {
      let startH: number | null = null;
      for (let h = 0; h < 24; h++) {
        if (grid[day][h] && startH === null) {
          startH = h;
        } else if (!grid[day][h] && startH !== null) {
          windows.push({
            dayOfWeek: day,
            startHour: startH,
            startMin: 0,
            endHour: h,
            endMin: 0,
          });
          startH = null;
        }
      }
      if (startH !== null) {
        windows.push({
          dayOfWeek: day,
          startHour: startH,
          startMin: 0,
          endHour: 23,
          endMin: 59,
        });
      }
    }
    return windows;
  };

  // Save Settings
  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setFeedback(null);

    try {
      const windows = convertGridToWindows(scheduleGrid);

      if (selectedCameraId === 'all') {
        // Save global operational settings
        const res = await fetch('/api/settings/operational', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recordingMode,
            retentionDays,
            warningThresholdPercent: warningThreshold,
            criticalThresholdPercent: criticalThreshold,
            preBufferSeconds,
            postBufferSeconds,
            weeklySchedule: windows,
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.message || 'Failed to save operational settings');
        }
      } else {
        // Save camera-specific schedule
        const res = await fetch(`/api/settings/schedule/${selectedCameraId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mode: recordingMode,
            windows,
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.message || 'Failed to save camera schedule');
        }
      }

      setFeedback({ type: 'success', message: 'Operational settings saved successfully.' });
      if (onSettingsSaved) onSettingsSaved();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error saving settings' });
    } finally {
      setSaving(false);
    }
  };

  // Trigger Storage Purge
  const handleStoragePurge = async () => {
    if (!token) return;
    if (
      !confirm(
        `Are you sure you want to run storage cleanup? Non-bookmarked segments older than ${retentionDays} days or exceeding disk quota will be permanently deleted.`
      )
    ) {
      return;
    }

    setPurging(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/settings/storage/purge?retentionDays=${retentionDays}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const deleted =
          (data.retentionPurge?.deletedSegmentsCount || 0) +
          (data.quotaCleanup?.deletedSegmentsCount || 0);
        const freedMb = Math.round(
          ((data.retentionPurge?.freedBytes || 0) + (data.quotaCleanup?.freedBytes || 0)) /
            (1024 * 1024)
        );
        setFeedback({
          type: 'success',
          message: `Storage cleanup complete: ${deleted} segments purged, ${freedMb} MB freed. Bookmarked incident evidence was preserved intact.`,
        });
        if (data.metricsAfter) {
          setStorageMetrics(data.metricsAfter);
        }
      } else {
        throw new Error(data.message || 'Storage purge failed');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to execute storage purge' });
    } finally {
      setPurging(false);
    }
  };

  // Total scheduled hours
  const totalScheduledHours = scheduleGrid.reduce(
    (acc, row) => acc + row.filter(Boolean).length,
    0
  );
  const totalWeeklyHours = 7 * 24;
  const coveragePercent = Math.round((totalScheduledHours / totalWeeklyHours) * 100);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        backdropFilter: 'blur(4px)',
      }}
      onMouseUp={handleMouseUp}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '12px',
          width: '95%',
          maxWidth: '1000px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#1e293b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <HardDrive size={22} style={{ color: '#0284c7' }} />
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f8fafc' }}>
                Operational Recording & Storage Settings
              </h2>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                Continuous, motion-triggered & scheduled recording policies, 7-day grid & storage
                retention
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #1e293b',
            backgroundColor: '#0f172a',
            padding: '0 24px',
          }}
        >
          <button
            onClick={() => setActiveTab('recording')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'recording' ? '2px solid #0284c7' : '2px solid transparent',
              color: activeTab === 'recording' ? '#38bdf8' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Film size={16} />
            Recording Mode
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'schedule' ? '2px solid #0284c7' : '2px solid transparent',
              color: activeTab === 'schedule' ? '#38bdf8' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Calendar size={16} />
            7-Day Schedule Grid
          </button>
          <button
            onClick={() => setActiveTab('storage')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'storage' ? '2px solid #0284c7' : '2px solid transparent',
              color: activeTab === 'storage' ? '#38bdf8' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <HardDrive size={16} />
            Storage & Retention
          </button>
          <button
            onClick={() => setActiveTab('license')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'license' ? '2px solid #0284c7' : '2px solid transparent',
              color: activeTab === 'license' ? '#38bdf8' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <ShieldCheck size={16} />
            Commercial Licensing
          </button>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            style={{
              margin: '16px 24px 0 24px',
              padding: '10px 14px',
              borderRadius: '6px',
              backgroundColor: feedback.type === 'success' ? '#064e3b' : '#7f1d1d',
              border: `1px solid ${feedback.type === 'success' ? '#059669' : '#b91c1c'}`,
              color: '#f8fafc',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 size={16} style={{ color: '#34d399' }} />
            ) : (
              <AlertTriangle size={16} style={{ color: '#f87171' }} />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Content Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Target Camera Selector Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px',
              padding: '12px 16px',
              backgroundColor: '#1e293b',
              borderRadius: '8px',
              border: '1px solid #334155',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} style={{ color: '#0284c7' }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                Target Scope:
              </span>
            </div>
            <select
              value={selectedCameraId}
              onChange={(e) => handleCameraChange(e.target.value)}
              style={{
                backgroundColor: '#0f172a',
                border: '1px solid #475569',
                borderRadius: '6px',
                color: '#f8fafc',
                padding: '6px 12px',
                fontSize: '13px',
              }}
            >
              <option value="all">System Default (All Cameras)</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>

          {/* TAB 1: RECORDING MODE */}
          {activeTab === 'recording' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                {/* Continuous 24/7 */}
                <div
                  onClick={() => setRecordingMode('CONTINUOUS')}
                  style={{
                    padding: '18px',
                    borderRadius: '8px',
                    border: `2px solid ${
                      recordingMode === 'CONTINUOUS' ? '#0284c7' : '#334155'
                    }`,
                    backgroundColor: recordingMode === 'CONTINUOUS' ? '#082f49' : '#1e293b',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '15px' }}>
                      24/7 Continuous Recording
                    </span>
                    <Film
                      size={18}
                      style={{ color: recordingMode === 'CONTINUOUS' ? '#38bdf8' : '#64748b' }}
                    />
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                    Non-stop fMP4 segmenting (60s chunks) directly off camera RTSP without CPU
                    re-encoding. Essential for banks, retail cash points & perimeter gates.
                  </p>
                </div>

                {/* Motion Only */}
                <div
                  onClick={() => setRecordingMode('MOTION_ONLY')}
                  style={{
                    padding: '18px',
                    borderRadius: '8px',
                    border: `2px solid ${
                      recordingMode === 'MOTION_ONLY' ? '#0284c7' : '#334155'
                    }`,
                    backgroundColor: recordingMode === 'MOTION_ONLY' ? '#082f49' : '#1e293b',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '15px' }}>
                      Motion Only (Ring Buffer)
                    </span>
                    <Zap
                      size={18}
                      style={{ color: recordingMode === 'MOTION_ONLY' ? '#38bdf8' : '#64748b' }}
                    />
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                    Rolling 2s fMP4 ring-buffer promoted to permanent storage on native ONVIF motion
                    triggers. Captures pre-event buffer and post-event cooldown without transcoding.
                  </p>

                  {/* Configurable Ring Buffer Inputs */}
                  {recordingMode === 'MOTION_ONLY' && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        marginTop: '16px',
                        padding: '14px',
                        backgroundColor: '#0f172a',
                        borderRadius: '6px',
                        border: '1px solid #1e293b',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '16px',
                          marginBottom: '12px',
                        }}
                      >
                        <div>
                          <label
                            style={{
                              display: 'block',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#94a3b8',
                              marginBottom: '6px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            Pre-Event Buffer (Seconds)
                          </label>
                          <input
                            type="number"
                            min={2}
                            max={60}
                            value={preBufferSeconds}
                            onChange={(e) => setPreBufferSeconds(Number(e.target.value))}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              backgroundColor: '#1e293b',
                              border: '1px solid #334155',
                              borderRadius: '4px',
                              color: '#f8fafc',
                              fontSize: '13px',
                              fontFamily: 'monospace',
                            }}
                          />
                          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                            Preceding footage saved on trigger (2 - 60s)
                          </span>
                        </div>
                        <div>
                          <label
                            style={{
                              display: 'block',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#94a3b8',
                              marginBottom: '6px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            Post-Event Cooldown (Seconds)
                          </label>
                          <input
                            type="number"
                            min={5}
                            max={300}
                            value={postBufferSeconds}
                            onChange={(e) => setPostBufferSeconds(Number(e.target.value))}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              backgroundColor: '#1e293b',
                              border: '1px solid #334155',
                              borderRadius: '4px',
                              color: '#f8fafc',
                              fontSize: '13px',
                              fontFamily: 'monospace',
                            }}
                          />
                          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                            Recording extends after motion ceases (5 - 300s)
                          </span>
                        </div>
                      </div>

                      {/* Live Status Diagnostics */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px 12px',
                          backgroundColor: '#1e293b',
                          borderRadius: '4px',
                          fontSize: '12px',
                          color: '#38bdf8',
                        }}
                      >
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: motionBufferStatus.activeIncidentsCount > 0 ? '#ef4444' : '#22c55e',
                            boxShadow: motionBufferStatus.activeIncidentsCount > 0
                              ? '0 0 6px #ef4444'
                              : '0 0 6px #22c55e',
                          }}
                        />
                        <span>
                          Motion Ring Buffer Live: {motionBufferStatus.totalBufferedSegments} rolling segment(s) |{' '}
                          {motionBufferStatus.activeIncidentsCount} active incident(s)
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Scheduled Grid */}
                <div
                  onClick={() => setRecordingMode('SCHEDULED')}
                  style={{
                    padding: '18px',
                    borderRadius: '8px',
                    border: `2px solid ${
                      recordingMode === 'SCHEDULED' ? '#0284c7' : '#334155'
                    }`,
                    backgroundColor: recordingMode === 'SCHEDULED' ? '#082f49' : '#1e293b',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '15px' }}>
                      Scheduled (Custom Grid)
                    </span>
                    <Calendar
                      size={18}
                      style={{ color: recordingMode === 'SCHEDULED' ? '#38bdf8' : '#64748b' }}
                    />
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                    Follows the weekly 7-day schedule grid configured in the next tab (e.g.,
                    record overnight and weekends only).
                  </p>
                </div>

                {/* Manual Off */}
                <div
                  onClick={() => setRecordingMode('MANUAL_OFF')}
                  style={{
                    padding: '18px',
                    borderRadius: '8px',
                    border: `2px solid ${
                      recordingMode === 'MANUAL_OFF' ? '#0284c7' : '#334155'
                    }`,
                    backgroundColor: recordingMode === 'MANUAL_OFF' ? '#082f49' : '#1e293b',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '15px' }}>
                      Manual Off
                    </span>
                    <X
                      size={18}
                      style={{ color: recordingMode === 'MANUAL_OFF' ? '#38bdf8' : '#64748b' }}
                    />
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                    Suspends automatic recording. Live WebRTC monitoring and instant snapshot
                    capture remain fully operational.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 7-DAY SCHEDULE GRID */}
          {activeTab === 'schedule' && (
            <div>
              {/* Presets Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => applyPreset('all')}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    24/7 (All Hours)
                  </button>
                  <button
                    onClick={() => applyPreset('business')}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    Business Hours (Mon-Fri 9-6)
                  </button>
                  <button
                    onClick={() => applyPreset('nights')}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    Nights & Weekends
                  </button>
                  <button
                    onClick={() => applyPreset('clear')}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#ef4444',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    Clear All
                  </button>
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                  Coverage:{' '}
                  <strong style={{ color: '#22c55e' }}>
                    {totalScheduledHours} / {totalWeeklyHours} hrs ({coveragePercent}%)
                  </strong>
                </div>
              </div>

              {/* Grid Canvas */}
              <div
                style={{
                  backgroundColor: '#0b1120',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '16px',
                  overflowX: 'auto',
                  userSelect: 'none',
                }}
              >
                {/* Hours Header (00 to 23) */}
                <div style={{ display: 'grid', gridTemplateColumns: '90px repeat(24, 1fr)', gap: '2px', marginBottom: '6px' }}>
                  <div />
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      style={{
                        textAlign: 'center',
                        fontSize: '10px',
                        color: '#64748b',
                        fontFamily: 'monospace',
                      }}
                    >
                      {String(h).padStart(2, '0')}
                    </div>
                  ))}
                </div>

                {/* Day Rows */}
                {DAYS_OF_WEEK.map((dayName, dayIndex) => (
                  <div
                    key={dayName}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '90px repeat(24, 1fr)',
                      gap: '2px',
                      marginBottom: '4px',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 500 }}>
                      {dayName.slice(0, 3)}
                    </div>
                    {HOURS.map((hour) => {
                      const isActive = scheduleGrid[dayIndex]?.[hour];
                      return (
                        <div
                          key={hour}
                          onMouseDown={() => handleMouseDown(dayIndex, hour)}
                          onMouseEnter={() => handleMouseEnter(dayIndex, hour)}
                          onClick={() => toggleCell(dayIndex, hour)}
                          title={`${dayName} ${String(hour).padStart(2, '0')}:00 - ${
                            isActive ? 'Recording Active' : 'Idle'
                          }`}
                          style={{
                            height: '24px',
                            backgroundColor: isActive ? '#16a34a' : '#1e293b',
                            borderRadius: '2px',
                            cursor: 'pointer',
                            border: isActive ? '1px solid #22c55e' : '1px solid #334155',
                            transition: 'background-color 0.1s',
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: '#64748b' }}>
                Tip: Click or click-and-drag across hour slots to paint recording schedule windows.
                Green indicates active recording.
              </p>
            </div>
          )}

          {/* TAB 3: STORAGE & RETENTION */}
          {activeTab === 'storage' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Storage Meter Bar */}
              <div
                style={{
                  backgroundColor: '#1e293b',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  padding: '20px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '10px',
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                    Storage Pool Utilization
                  </span>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                    {Math.round(storageMetrics.usedBytes / (1024 * 1024 * 1024))} GB used of{' '}
                    {Math.round(storageMetrics.totalBytes / (1024 * 1024 * 1024))} GB total (
                    <strong style={{ color: storageMetrics.usedPercent > 80 ? '#f59e0b' : '#38bdf8' }}>
                      {storageMetrics.usedPercent}%
                    </strong>
                    )
                  </span>
                </div>

                {/* Progress bar */}
                <div
                  style={{
                    height: '14px',
                    backgroundColor: '#0f172a',
                    borderRadius: '7px',
                    overflow: 'hidden',
                    display: 'flex',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: `${storageMetrics.usedPercent}%`,
                      backgroundColor:
                        storageMetrics.usedPercent >= criticalThreshold
                          ? '#ef4444'
                          : storageMetrics.usedPercent >= warningThreshold
                          ? '#f59e0b'
                          : '#0284c7',
                      transition: 'width 0.3s ease',
                    }}
                  />
                  {/* Warning line marker */}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${warningThreshold}%`,
                      top: 0,
                      bottom: 0,
                      width: '2px',
                      backgroundColor: '#f59e0b',
                    }}
                    title={`Warning Threshold (${warningThreshold}%)`}
                  />
                  {/* Critical line marker */}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${criticalThreshold}%`,
                      top: 0,
                      bottom: 0,
                      width: '2px',
                      backgroundColor: '#ef4444',
                    }}
                    title={`Critical Threshold (${criticalThreshold}%)`}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '8px',
                    fontSize: '12px',
                    color: '#64748b',
                  }}
                >
                  <span>0%</span>
                  <span>Warning: {warningThreshold}%</span>
                  <span>Critical Purge: {criticalThreshold}%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Retention Policy Controls */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    backgroundColor: '#1e293b',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                    padding: '20px',
                  }}
                >
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#f8fafc' }}>
                    Target Retention Period
                  </h4>
                  <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#94a3b8' }}>
                    Recordings exceeding this window will be purged during scheduled maintenance.
                  </p>
                  <select
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    style={{
                      width: '100%',
                      backgroundColor: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      padding: '8px 12px',
                      fontSize: '13px',
                    }}
                  >
                    <option value={7}>7 Days (Residential / Light SMB)</option>
                    <option value={15}>15 Days (Standard Retail SMB)</option>
                    <option value={30}>30 Days (Commercial Standard)</option>
                    <option value={60}>60 Days (Extended Archive)</option>
                    <option value={0}>0 Days (Full Disk FIFO Rollover Only)</option>
                  </select>

                  <div style={{ marginTop: '16px', fontSize: '13px', color: '#cbd5e1' }}>
                    Estimated Runway:{' '}
                    <strong style={{ color: '#22c55e' }}>
                      {storageMetrics.estimatedDaysRemaining != null ? `~${storageMetrics.estimatedDaysRemaining} Days` : '—'}
                    </strong>{' '}
                    at current bitrate
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#1e293b',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                    padding: '20px',
                  }}
                >
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#f8fafc' }}>
                    FIFO Auto-Purge & Evidence Protection
                  </h4>
                  <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#94a3b8' }}>
                    When storage reaches the {criticalThreshold}% critical threshold, the oldest
                    segments are automatically pruned to prevent disk saturation.
                  </p>

                  <div
                    style={{
                      padding: '10px 12px',
                      backgroundColor: '#0f172a',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      fontSize: '12px',
                      color: '#38bdf8',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <ShieldCheck size={16} />
                    <span>
                      <strong>Bookmark Protection:</strong> Segments tagged with incident bookmarks
                      are strictly exempt from automated deletion.
                    </span>
                  </div>

                  <button
                    onClick={handleStoragePurge}
                    disabled={purging || !isAdmin}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: isAdmin ? '#dc2626' : '#475569',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: isAdmin ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Trash2 size={15} />
                    {purging ? 'Purging Storage...' : 'Run Storage Cleanup Now'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: COMMERCIAL LICENSING */}
          {activeTab === 'license' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  backgroundColor: '#1e293b',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  padding: '20px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ShieldCheck size={22} style={{ color: '#22c55e' }} />
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>
                      Cryptographic Offline Entitlement (Ed25519)
                    </h3>
                  </div>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: '12px',
                      backgroundColor: '#065f46',
                      color: '#6ee7b7',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    {licensingInfo.edition.toUpperCase()} EDITION
                  </span>
                </div>

                <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 16px 0' }}>
                  Offline Ed25519 digital signature verified at node startup. Zero external cloud
                  telemetry dependencies or outbound licensing calls.
                </p>

                {/* Realignment Highlight Badge */}
                <div
                  style={{
                    padding: '12px 16px',
                    backgroundColor: '#064e3b',
                    border: '1px solid #059669',
                    borderRadius: '8px',
                    color: '#d1fae5',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '16px',
                  }}
                >
                  <CheckCircle2 size={18} style={{ color: '#34d399' }} />
                  <div>
                    <strong>Commercial Realignment: Camera Health Telemetry is Included in Core!</strong>
                    <div style={{ fontSize: '12px', color: '#a7f3d0' }}>
                      Network TCP socket ping probes, MediaMTX stream status, and anti-flapping
                      telemetry are active by default for all installations without Pro tier.
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: '#0f172a',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Camera Entitlement</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                      Up to {licensingInfo.cameraLimit} Cameras
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: '#0f172a',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Cryptographic State</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#22c55e' }}>
                      Signature Verified
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: '#0f172a',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Expiration</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                      {licensingInfo.isExpired ? 'Expired' : 'Active (Perpetual)'}
                    </div>
                  </div>
                </div>

                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#f8fafc' }}>
                  Active Capabilities Registry:
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {licensingInfo.activeCapabilities.map((cap) => (
                    <span
                      key={cap}
                      style={{
                        padding: '3px 8px',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: '#38bdf8',
                      }}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '12px',
            backgroundColor: '#1e293b',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: 'transparent',
              border: '1px solid #475569',
              borderRadius: '6px',
              color: '#cbd5e1',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isAdmin}
            style={{
              padding: '8px 20px',
              backgroundColor: isAdmin ? '#0284c7' : '#475569',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isAdmin ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
