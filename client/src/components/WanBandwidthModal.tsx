import React, { useState, useEffect } from 'react';
import {
  X,
  Network,
  Activity,
  ShieldCheck,
  Moon,
  Zap,
  HardDrive,
  RefreshCw,
  Clock,
  ArrowDownUp,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
} from 'lucide-react';
import { NetworkBandwidthState } from '../hooks/useNetworkBandwidth.js';

export interface WanBandwidthModalProps {
  isOpen: boolean;
  onClose: () => void;
  networkState: NetworkBandwidthState;
  authToken?: string;
}

export const WanBandwidthModal: React.FC<WanBandwidthModalProps> = ({
  isOpen,
  onClose,
  networkState,
  authToken = '',
}) => {
  const [activeTab, setActiveTab] = useState<
    'dual-stream' | 'wan-archival' | 'adaptive-throttling' | 'nightly-sync'
  >('dual-stream');

  // Dual Stream stats
  const [proxyStats, setProxyStats] = useState<any>(null);
  const [proxyLoading, setProxyLoading] = useState<boolean>(false);

  // Archival queue & metrics
  const [archivalQueue, setArchivalQueue] = useState<any[]>([]);
  const [archivalMetrics, setArchivalMetrics] = useState<any>(null);
  const [archivalLoading, setArchivalLoading] = useState<boolean>(false);

  // Nightly sync config & status
  const [nightlyConfig, setNightlyConfig] = useState<any>({
    enabled: true,
    startHour: 2,
    endHour: 5,
    maxBandwidthMbps: 10,
    syncTarget: 'all_flagged',
  });
  const [nightlyStatus, setNightlyStatus] = useState<any>(null);
  const [syncActionToast, setSyncActionToast] = useState<string | null>(null);

  const fetchProxyStats = async () => {
    setProxyLoading(true);
    try {
      const res = await fetch('/api/streaming/bandwidth-stats', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setProxyStats(data);
      }
    } catch {}
    setProxyLoading(false);
  };

  const fetchArchivalData = async () => {
    setArchivalLoading(true);
    try {
      const [qRes, mRes] = await Promise.all([
        fetch('/api/v1/wan-archival/queue', {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        }),
        fetch('/api/v1/wan-archival/metrics', {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        }),
      ]);
      if (qRes.ok) {
        const qData = await qRes.json();
        setArchivalQueue(qData.items || []);
      }
      if (mRes.ok) {
        const mData = await mRes.json();
        setArchivalMetrics(mData.metrics);
      }
    } catch {}
    setArchivalLoading(false);
  };

  const fetchNightlyData = async () => {
    try {
      const [cRes, sRes] = await Promise.all([
        fetch('/api/v1/nightly-sync/config', {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        }),
        fetch('/api/v1/nightly-sync/status', {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        }),
      ]);
      if (cRes.ok) {
        const cData = await cRes.json();
        if (cData.config) setNightlyConfig(cData.config);
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.status) setNightlyStatus(sData.status);
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      fetchProxyStats();
      fetchArchivalData();
      fetchNightlyData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveNightlyConfig = async () => {
    try {
      const res = await fetch('/api/v1/nightly-sync/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(nightlyConfig),
      });
      if (res.ok) {
        setSyncActionToast('Nightly sync schedule saved successfully');
        setTimeout(() => setSyncActionToast(null), 3000);
        fetchNightlyData();
      }
    } catch {}
  };

  const handleTriggerManualSync = async () => {
    try {
      const res = await fetch('/api/v1/nightly-sync/trigger', {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setSyncActionToast(data.message || 'Manual batch sync completed');
        setTimeout(() => setSyncActionToast(null), 4000);
        fetchNightlyData();
      }
    } catch {}
  };

  const handleTestIncidentSync = async () => {
    try {
      const res = await fetch('/api/v1/wan-archival/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          cameraId: 'cam-branch-gate',
          cameraName: 'Gate Dispatch West',
          eventType: 'perimeter.intrusion',
          clipDurationSeconds: 45,
        }),
      });
      if (res.ok) {
        setSyncActionToast('Simulated 45s incident clip queued for WAN upload');
        setTimeout(() => setSyncActionToast(null), 3000);
        fetchArchivalData();
      }
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-sans">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[90vh] bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2937] bg-[#090d16]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 text-[#4fc3f7]">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100 tracking-tight">
                  WAN Bandwidth Optimization & Sync Hub
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/40">
                  ENTERPRISE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Industry practices to prevent branch WAN broadband choking (Verkada & Milestone parity)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toast */}
        {syncActionToast && (
          <div className="bg-[#4fc3f7]/20 border-b border-[#4fc3f7]/40 px-6 py-2 flex items-center gap-2 text-xs font-semibold text-[#4fc3f7]">
            <CheckCircle2 className="w-4 h-4" />
            <span>{syncActionToast}</span>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-[#1f2937] bg-[#0d1424] px-6 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('dual-stream')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'dual-stream'
                ? 'border-[#4fc3f7] text-[#4fc3f7]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowDownUp className="w-4 h-4" />
            <span>1. Dual-Stream Cloud Proxy</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('wan-archival')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'wan-archival'
                ? 'border-[#4fc3f7] text-[#4fc3f7]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>2. Event-Only WAN Archival</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('adaptive-throttling')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'adaptive-throttling'
                ? 'border-[#4fc3f7] text-[#4fc3f7]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>3. Adaptive Throttling</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('nightly-sync')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'nightly-sync'
                ? 'border-[#4fc3f7] text-[#4fc3f7]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Moon className="w-4 h-4" />
            <span>4. Off-Peak Nightly Sync</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {/* TAB 1: DUAL-STREAM PROXY */}
          {activeTab === 'dual-stream' && (
            <div className="space-y-6">
              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1f2937]">
                <h3 className="text-sm font-bold text-slate-100 mb-1 flex items-center gap-2">
                  <ArrowDownUp className="w-4 h-4 text-[#4fc3f7]" />
                  Dual-Stream Dynamic Resolution Handover
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  When viewing multi-camera grids (2x2, 3x3) over remote branch WAN, the system automatically pulls lightweight Sub-Streams (360p @ 150-200 kbps). Only when the operator maximizes or selects a single camera does it dynamically elevate to the 1080p Main HD stream (4000 kbps).
                </p>

                {proxyStats && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[11px] text-slate-400">Baseline (All Full HD)</span>
                      <div className="text-lg font-bold font-mono text-rose-400">
                        {(proxyStats.baselineFullHdKbps / 1000).toFixed(1)} Mbps
                      </div>
                      <span className="text-[10px] text-slate-500">Without Dual-Stream Proxy</span>
                    </div>

                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[11px] text-slate-400">Active Dual-Stream Egress</span>
                      <div className="text-lg font-bold font-mono text-emerald-400">
                        {(proxyStats.activeDualStreamKbps / 1000).toFixed(1)} Mbps
                      </div>
                      <span className="text-[10px] text-slate-500">1 Main HD + Sub Grid feeds</span>
                    </div>

                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[11px] text-slate-400">WAN Bandwidth Savings</span>
                      <div className="text-lg font-bold font-mono text-[#4fc3f7]">
                        {proxyStats.savingsPercent}% Saved
                      </div>
                      <span className="text-[10px] text-slate-500">Zero WAN broadband choke</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1f2937] flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Cloud Proxy Mode Policy</h4>
                  <p className="text-[11px] text-slate-400">
                    Automatic dynamic handover between 360p Sub and 1080p Main HD.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded bg-[#4fc3f7]/20 text-[#4fc3f7] font-bold text-xs border border-[#4fc3f7]/50">
                    AUTO-PROXY ACTIVE
                  </span>
                  <button
                    type="button"
                    onClick={fetchProxyStats}
                    className="p-2 text-slate-400 hover:text-white rounded bg-[#111827] border border-[#1f2937]"
                    title="Refresh Bandwidth Stats"
                  >
                    <RefreshCw className={`w-4 h-4 ${proxyLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: EVENT-ONLY WAN ARCHIVAL */}
          {activeTab === 'wan-archival' && (
            <div className="space-y-6">
              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1f2937]">
                <h3 className="text-sm font-bold text-slate-100 mb-1 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-[#4fc3f7]" />
                  Edge Ring Buffer + Incident WAN Archival
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  100% of continuous 24/7 video stays on the branch local storage drive. Only flagged 45-second incident clips (15s pre-alarm + 30s post-alarm buffer) are transmitted over the WAN link to Central HQ.
                </p>

                {archivalMetrics && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[10px] text-slate-400">Total Incident Clips</span>
                      <div className="text-base font-bold font-mono text-slate-100">
                        {archivalMetrics.totalIncidentClips}
                      </div>
                    </div>
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[10px] text-slate-400">Synced to Central HQ</span>
                      <div className="text-base font-bold font-mono text-emerald-400">
                        {archivalMetrics.syncedClips}
                      </div>
                    </div>
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[10px] text-slate-400">Uploaded Data</span>
                      <div className="text-base font-bold font-mono text-[#4fc3f7]">
                        {(archivalMetrics.totalUploadedBytes / (1024 * 1024)).toFixed(1)} MB
                      </div>
                    </div>
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[10px] text-slate-400">WAN Bandwidth Saved</span>
                      <div className="text-base font-bold font-mono text-[#fb923c]">
                        {archivalMetrics.savingsPercentage}%
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Queue Table */}
              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1f2937]">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-slate-200">Recent Incident Clips Archival Queue</h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTestIncidentSync}
                      className="px-3 py-1 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded transition-colors"
                    >
                      + Simulate Incident Sync
                    </button>
                    <button
                      type="button"
                      onClick={fetchArchivalData}
                      className="p-1.5 text-slate-400 hover:text-white rounded bg-[#111827] border border-[#1f2937]"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${archivalLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {archivalQueue.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    No incident clips currently in transit. All edge recordings are safe on local disk.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-[#111827] text-slate-400 uppercase text-[10px] font-mono">
                        <tr>
                          <th className="px-3 py-2">Camera</th>
                          <th className="px-3 py-2">Event</th>
                          <th className="px-3 py-2">Duration</th>
                          <th className="px-3 py-2">Size</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1f2937]">
                        {archivalQueue.map((item) => (
                          <tr key={item.id} className="hover:bg-[#111827]/50">
                            <td className="px-3 py-2 font-semibold text-slate-100">{item.cameraName}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-[#4fc3f7]">{item.eventType}</td>
                            <td className="px-3 py-2">{item.clipDurationSeconds}s</td>
                            <td className="px-3 py-2">{(item.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB</td>
                            <td className="px-3 py-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  item.status === 'SYNCED'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : item.status === 'UPLOADING'
                                    ? 'bg-[#4fc3f7]/20 text-[#4fc3f7] animate-pulse'
                                    : 'bg-amber-500/20 text-amber-400'
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-400 text-[11px]">
                              {new Date(item.timestamp).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: ADAPTIVE THROTTLING */}
          {activeTab === 'adaptive-throttling' && (
            <div className="space-y-6">
              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1f2937]">
                <h3 className="text-sm font-bold text-slate-100 mb-1 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#4fc3f7]" />
                  Adaptive Bandwidth Throttling & Quality Scaling
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  If branch internet drops below the safety threshold (default: 5 Mbps) or packet loss exceeds 5%, the system automatically throttles video frame rate from 25 FPS down to 10 FPS and locks feeds to Sub-Stream to prevent camera connection drops.
                </p>

                {/* Real-time Link Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
                  <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                    <span className="text-[10px] text-slate-400">Current Bandwidth</span>
                    <div className="text-lg font-bold font-mono text-[#4fc3f7]">
                      {networkState.bandwidthMbps} Mbps
                    </div>
                  </div>
                  <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                    <span className="text-[10px] text-slate-400">Ping RTT Latency</span>
                    <div className="text-lg font-bold font-mono text-slate-200">
                      {networkState.latencyMs} ms
                    </div>
                  </div>
                  <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                    <span className="text-[10px] text-slate-400">Packet Loss</span>
                    <div className="text-lg font-bold font-mono text-emerald-400">
                      {networkState.packetLossPercent}%
                    </div>
                  </div>
                  <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                    <span className="text-[10px] text-slate-400">Active Framerate</span>
                    <div className="text-lg font-bold font-mono text-[#fb923c]">
                      {networkState.targetFps} FPS
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="space-y-4 pt-4 border-t border-[#1f2937]">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">Auto-Throttling Engine</h4>
                      <p className="text-[11px] text-slate-400">
                        Automatically reduce frame rate and quality when connection degrades
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={networkState.autoThrottleEnabled}
                        onChange={(e) => networkState.setAutoThrottleEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-[#1f2937] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#4fc3f7]"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">
                        Throttling Trigger Threshold ({networkState.thresholdMbps} Mbps)
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Trigger low-bandwidth 10 FPS mode if bandwidth drops below this value
                      </p>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={15}
                      step={1}
                      value={networkState.thresholdMbps}
                      onChange={(e) => networkState.setThresholdMbps(Number(e.target.value))}
                      className="w-40 accent-[#4fc3f7] cursor-pointer"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => networkState.measureNow()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1f2937] hover:bg-[#374151] text-xs font-semibold rounded text-slate-200 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Re-test Link Speed Now</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: NIGHTLY SYNC */}
          {activeTab === 'nightly-sync' && (
            <div className="space-y-6">
              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1f2937]">
                <h3 className="text-sm font-bold text-slate-100 mb-1 flex items-center gap-2">
                  <Moon className="w-4 h-4 text-[#4fc3f7]" />
                  Off-Peak Nightly Batch Sync Engine
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  Routine daily video summaries, high-priority flagged recordings, and audit certificates are automatically scheduled for upload during off-peak night hours (02:00 AM – 05:00 AM) when company broadband is completely idle.
                </p>

                {nightlyStatus && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[10px] text-slate-400">Current Window</span>
                      <div className="text-base font-bold font-mono text-slate-100">
                        {nightlyStatus.windowSchedule}
                      </div>
                    </div>
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[10px] text-slate-400">Sync Status</span>
                      <div className="text-base font-bold font-mono text-emerald-400">
                        {nightlyStatus.currentStatus}
                      </div>
                    </div>
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[10px] text-slate-400">Items Synced Today</span>
                      <div className="text-base font-bold font-mono text-[#4fc3f7]">
                        {nightlyStatus.itemsSyncedToday} items
                      </div>
                    </div>
                    <div className="p-3 bg-[#111827] rounded-md border border-[#1f2937]">
                      <span className="text-[10px] text-slate-400">Bandwidth Ceiling</span>
                      <div className="text-base font-bold font-mono text-[#fb923c]">
                        {nightlyStatus.maxBandwidthMbps} Mbps
                      </div>
                    </div>
                  </div>
                )}

                {/* Configuration form */}
                <div className="space-y-4 pt-4 border-t border-[#1f2937]">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Window Start Hour (IST)
                      </label>
                      <select
                        value={nightlyConfig.startHour}
                        onChange={(e) =>
                          setNightlyConfig({ ...nightlyConfig, startHour: Number(e.target.value) })
                        }
                        className="w-full bg-[#111827] border border-[#1f2937] rounded px-3 py-1.5 text-xs text-slate-200"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={`start-${i}`} value={i}>
                            {String(i).padStart(2, '0')}:00
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Window End Hour (IST)
                      </label>
                      <select
                        value={nightlyConfig.endHour}
                        onChange={(e) =>
                          setNightlyConfig({ ...nightlyConfig, endHour: Number(e.target.value) })
                        }
                        className="w-full bg-[#111827] border border-[#1f2937] rounded px-3 py-1.5 text-xs text-slate-200"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={`end-${i}`} value={i}>
                            {String(i).padStart(2, '0')}:00
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Max WAN Cap (Mbps)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={nightlyConfig.maxBandwidthMbps}
                        onChange={(e) =>
                          setNightlyConfig({
                            ...nightlyConfig,
                            maxBandwidthMbps: Number(e.target.value),
                          })
                        }
                        className="w-full bg-[#111827] border border-[#1f2937] rounded px-3 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleTriggerManualSync}
                      className="flex items-center gap-1.5 px-3 py-2 bg-[#1f2937] hover:bg-[#374151] text-xs font-semibold rounded text-[#4fc3f7] transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Test Immediate Batch Sync</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveNightlyConfig}
                      className="px-4 py-2 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded transition-colors shadow-md"
                    >
                      Save Nightly Schedule
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WanBandwidthModal;
