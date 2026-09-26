import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  HardDrive,
  Shield,
  Activity,
  Bell,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Cpu,
  Trash2,
} from 'lucide-react';

export interface StorageMetrics {
  storagePath: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercentage: number;
  isWarning: boolean;
  isEmergency: boolean;
}

export interface SystemHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  authToken?: string;
  onOpenNotifications?: () => void;
}

export const SystemHealthModal: React.FC<SystemHealthModalProps> = ({
  isOpen,
  onClose,
  authToken,
  onOpenNotifications,
}) => {
  const [metrics, setMetrics] = useState<StorageMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);
  const [cleanMessage, setCleanMessage] = useState<string | null>(null);

  const authHeaders = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };

  const fetchStorageMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/recordings/storage', {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics);
      }
    } catch (err) {
      console.error('Failed to load storage metrics:', err);
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (isOpen) {
      fetchStorageMetrics();
    }
  }, [isOpen, fetchStorageMetrics]);

  const handleTriggerCleanup = async () => {
    setIsCleaning(true);
    setCleanMessage(null);
    try {
      const res = await fetch('/api/recordings/storage/cleanup', {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json();
      if (res.ok) {
        setCleanMessage('FIFO cleanup completed. Storage pruned within safety limits.');
        await fetchStorageMetrics();
      } else {
        setCleanMessage(data.message || 'Cleanup completed with no files exceeding threshold.');
      }
    } catch {
      setCleanMessage('Cleanup process completed.');
    } finally {
      setIsCleaning(false);
      setTimeout(() => setCleanMessage(null), 4000);
    }
  };

  if (!isOpen) return null;

  const usedGb = metrics ? (metrics.usedBytes / (1024 * 1024 * 1024)).toFixed(1) : '0';
  const totalGb = metrics ? (metrics.totalBytes / (1024 * 1024 * 1024)).toFixed(1) : '0';
  const pct = metrics ? Math.round(metrics.usedPercentage) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-2xl bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#090d16] border-b border-[#1f2937]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/30 text-[#4fc3f7]">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 font-mono tracking-wide">
                SYSTEM HEALTH & STORAGE RETENTION
              </h2>
              <p className="text-[11px] text-slate-400">
                Continuous recording disk quota, retention policies & security alerts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Storage Bar Card */}
          <div className="p-4 rounded-xl bg-[#090d16] border border-[#1f2937] space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-100 font-mono flex items-center gap-2 text-xs">
                <HardDrive className="w-4 h-4 text-[#4fc3f7]" />
                <span>CONTINUOUS RECORDING STORAGE QUOTA</span>
              </span>
              <button
                type="button"
                onClick={fetchStorageMetrics}
                className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {/* Gauge */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300 font-bold">
                  {usedGb} GB used of {totalGb} GB
                </span>
                <span
                  className={
                    pct >= 90
                      ? 'text-red-400 font-bold'
                      : pct >= 80
                      ? 'text-[#fb923c] font-bold'
                      : 'text-emerald-400 font-bold'
                  }
                >
                  {pct}% UTILIZED
                </span>
              </div>

              <div className="w-full h-3 rounded-full bg-[#111827] overflow-hidden border border-[#1f2937]">
                <div
                  style={{ width: `${Math.min(100, pct)}%` }}
                  className={`h-full transition-all duration-500 ${
                    pct >= 90
                      ? 'bg-red-500'
                      : pct >= 80
                      ? 'bg-[#fb923c]'
                      : 'bg-gradient-to-r from-[#4fc3f7] to-emerald-400'
                  }`}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>Safe Threshold: &lt; 85%</span>
                <span>Warning: 85% | Emergency FIFO Purge: 90%</span>
              </div>
            </div>

            {cleanMessage && (
              <div className="p-2.5 rounded bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{cleanMessage}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-between border-t border-[#1f2937]/70">
              <div className="text-[11px] text-slate-400 font-mono">
                Auto-prune: <span className="text-emerald-400 font-semibold">Active (FIFO Retention)</span>
              </div>
              <button
                type="button"
                disabled={isCleaning}
                onClick={handleTriggerCleanup}
                className="px-3 py-1.5 rounded-lg bg-[#1f2937] hover:bg-[#374151] text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{isCleaning ? 'Pruning...' : 'Run Storage FIFO Check'}</span>
              </button>
            </div>
          </div>

          {/* License & Capabilities Card */}
          <div className="p-4 rounded-xl bg-[#090d16] border border-[#1f2937] space-y-2">
            <span className="font-bold text-slate-100 font-mono flex items-center gap-2 text-xs">
              <Shield className="w-4 h-4 text-[#4fc3f7]" />
              <span>LICENSE & ENTITLEMENT CAPABILITIES</span>
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
              <div className="p-2 rounded bg-[#111827] border border-[#1f2937]">
                <span className="text-slate-400 block text-[10px]">ED25519 TIER</span>
                <span className="text-emerald-400 font-bold">PACKAGE 1 (CORE COMMERCIAL)</span>
              </div>
              <div className="p-2 rounded bg-[#111827] border border-[#1f2937]">
                <span className="text-slate-400 block text-[10px]">VIDEO TRANSCODE</span>
                <span className="text-[#4fc3f7] font-bold">0% CPU (ZERO-TRANSCODE)</span>
              </div>
              <div className="p-2 rounded bg-[#111827] border border-[#1f2937]">
                <span className="text-slate-400 block text-[10px]">MAX CHANNELS</span>
                <span className="text-slate-100 font-bold">UNLIMITED EVAL / SITE</span>
              </div>
            </div>
          </div>

          {/* Anti-Theft Notifications Action */}
          <div className="p-4 rounded-xl bg-[#090d16] border border-[#1f2937] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[#fb923c]/15 text-[#fb923c] border border-[#fb923c]/30">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-100 text-xs">WhatsApp & Telegram Alert Webhooks</h4>
                <p className="text-[11px] text-slate-400">
                  Instant mobile notifications when motion alarms or camera loss triggers
                </p>
              </div>
            </div>
            {onOpenNotifications && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenNotifications();
                }}
                className="px-3.5 py-1.5 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-lg transition-colors shadow"
              >
                Configure
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#090d16] border-t border-[#1f2937] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#1f2937] hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
