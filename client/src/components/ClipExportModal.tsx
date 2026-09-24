import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Film,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Copy,
  Check,
  Loader2,
  Layers,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';

export type ExportMode = 'STREAM_COPY' | 'TRANSCODED_OSD';

export interface ClipExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraId: string;
  cameraName: string;
  initialStartTime?: Date;
  initialEndTime?: Date;
  apiBaseUrl?: string;
  authToken?: string;
}

interface ExportJobState {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  exportMode: ExportMode;
  filePath?: string | null;
  fileSize?: number | null;
  sha256?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export const ClipExportModal: React.FC<ClipExportModalProps> = ({
  isOpen,
  onClose,
  cameraId,
  cameraName,
  initialStartTime,
  initialEndTime,
  apiBaseUrl = '',
  authToken = '',
}) => {
  // Helpers for formatting datetime-local
  const toLocalISO = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const defaultEnd = initialEndTime || new Date();
  const defaultStart = initialStartTime || new Date(defaultEnd.getTime() - 5 * 60 * 1000);

  const [startTimeStr, setStartTimeStr] = useState<string>(toLocalISO(defaultStart));
  const [endTimeStr, setEndTimeStr] = useState<string>(toLocalISO(defaultEnd));
  const [exportMode, setExportMode] = useState<ExportMode>('STREAM_COPY');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeJob, setActiveJob] = useState<ExportJobState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);

  // Sync initial dates on open
  useEffect(() => {
    if (isOpen) {
      const end = initialEndTime || new Date();
      const start = initialStartTime || new Date(end.getTime() - 5 * 60 * 1000);
      setStartTimeStr(toLocalISO(start));
      setEndTimeStr(toLocalISO(end));
      setActiveJob(null);
      setErrorMsg(null);
      setCopiedHash(false);
    }
  }, [isOpen, initialStartTime, initialEndTime]);

  // Polling for active job status
  useEffect(() => {
    if (!activeJob || activeJob.status === 'COMPLETED' || activeJob.status === 'FAILED') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

        const res = await fetch(`${apiBaseUrl}/api/recordings/export/${activeJob.id}`, {
          headers,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.job) {
            setActiveJob(data.job);
            if (data.job.status === 'FAILED') {
              setErrorMsg(data.job.errorMessage || 'Export failed on server');
            }
          }
        }
      } catch (err) {
        console.error('Failed to poll export job status:', err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [activeJob, apiBaseUrl, authToken]);

  if (!isOpen) return null;

  const handleQuickPreset = (minutes: number) => {
    const now = new Date();
    const start = new Date(now.getTime() - minutes * 60 * 1000);
    setStartTimeStr(toLocalISO(start));
    setEndTimeStr(toLocalISO(now));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    const start = new Date(startTimeStr);
    const end = new Date(endTimeStr);

    if (start >= end) {
      setErrorMsg('Start time must be before end time');
      setIsSubmitting(false);
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(`${apiBaseUrl}/api/recordings/export`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          cameraId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          exportMode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'INCOMPATIBLE_SEGMENTS') {
          setErrorMsg(
            'Cannot perform Stream Copy: recording segments have mismatched video formats or codecs. Try selecting a narrower time window or use Rendered Export (Transcoded OSD).'
          );
        } else {
          setErrorMsg(data.message || 'Export request failed');
        }
        setIsSubmitting(false);
        return;
      }

      if (data.job) {
        setActiveJob(data.job);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error initiating export');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyChecksum = () => {
    if (activeJob?.sha256) {
      navigator.clipboard.writeText(activeJob.sha256);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return 'Unknown size';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[#090d16] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2937] bg-[#111827]">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-[#4fc3f7]" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">Export Video Clip</h2>
              <p className="text-xs text-slate-400 font-mono">{cameraName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-md hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="flex items-start gap-3 p-3.5 bg-red-950/40 border border-red-800/80 rounded-lg text-red-200 text-xs leading-relaxed">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!activeJob ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Quick Range Presets */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Quick Duration
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleQuickPreset(5)}
                    className="py-1.5 px-3 rounded-lg bg-[#111827] border border-[#1f2937] text-xs text-slate-300 hover:border-[#4fc3f7] hover:text-[#4fc3f7] transition-colors"
                  >
                    Last 5 Min
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickPreset(15)}
                    className="py-1.5 px-3 rounded-lg bg-[#111827] border border-[#1f2937] text-xs text-slate-300 hover:border-[#4fc3f7] hover:text-[#4fc3f7] transition-colors"
                  >
                    Last 15 Min
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickPreset(60)}
                    className="py-1.5 px-3 rounded-lg bg-[#111827] border border-[#1f2937] text-xs text-slate-300 hover:border-[#4fc3f7] hover:text-[#4fc3f7] transition-colors"
                  >
                    Last 1 Hour
                  </button>
                </div>
              </div>

              {/* Start & End DateTime Controls */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" /> Start Time
                  </label>
                  <input
                    type="datetime-local"
                    value={startTimeStr}
                    onChange={(e) => setStartTimeStr(e.target.value)}
                    required
                    className="w-full bg-[#111827] border border-[#1f2937] rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-[#4fc3f7]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" /> End Time
                  </label>
                  <input
                    type="datetime-local"
                    value={endTimeStr}
                    onChange={(e) => setEndTimeStr(e.target.value)}
                    required
                    className="w-full bg-[#111827] border border-[#1f2937] rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-[#4fc3f7]"
                  />
                </div>
              </div>

              {/* Export Mode Selection */}
              <div className="space-y-2 pt-2 border-t border-[#1f2937]">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Export Pipeline Mode
                </label>
                <div className="grid grid-cols-1 gap-2.5">
                  {/* Stream Copy */}
                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      exportMode === 'STREAM_COPY'
                        ? 'bg-[#111827] border-[#4fc3f7] shadow-[0_0_8px_rgba(79,195,247,0.2)]'
                        : 'bg-[#111827]/50 border-[#1f2937] hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="exportMode"
                      checked={exportMode === 'STREAM_COPY'}
                      onChange={() => setExportMode('STREAM_COPY')}
                      className="mt-1 text-[#4fc3f7] focus:ring-0"
                    />
                    <div>
                      <div className="text-xs font-medium text-slate-100 flex items-center gap-1.5">
                        <span>Original / Stream Copy</span>
                        <span className="px-1.5 py-0.2 bg-[#4fc3f7]/10 text-[#4fc3f7] text-[10px] font-bold rounded">
                          FAST
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Zero decoding/re-encoding. Preserves exact camera bitstream packets without CPU overhead.
                      </p>
                    </div>
                  </label>

                  {/* Transcoded Derivative with OSD */}
                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      exportMode === 'TRANSCODED_OSD'
                        ? 'bg-[#111827] border-[#fb923c] shadow-[0_0_8px_rgba(251,146,60,0.2)]'
                        : 'bg-[#111827]/50 border-[#1f2937] hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="exportMode"
                      checked={exportMode === 'TRANSCODED_OSD'}
                      onChange={() => setExportMode('TRANSCODED_OSD')}
                      className="mt-1 text-[#fb923c] focus:ring-0"
                    />
                    <div>
                      <div className="text-xs font-medium text-slate-100 flex items-center gap-1.5">
                        <span>Rendered Export / Transcoded Derivative (OSD)</span>
                        <span className="px-1.5 py-0.2 bg-[#fb923c]/10 text-[#fb923c] text-[10px] font-bold rounded">
                          RENDERED
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Burns camera name and timestamp onto video. Transcodes media, requiring additional processing time.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-[#4fc3f7] text-[#090d16] font-semibold rounded-lg text-xs hover:bg-[#38bdf8] disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting Export...
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" /> Start Export
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Active Job Progress & Completed Download Surface */
            <div className="space-y-4">
              {activeJob.status === 'QUEUED' || activeJob.status === 'RUNNING' ? (
                <div className="py-8 text-center space-y-3 bg-[#111827] rounded-xl border border-[#1f2937]">
                  <Loader2 className="w-8 h-8 text-[#4fc3f7] animate-spin mx-auto" />
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      {activeJob.status === 'QUEUED' ? 'Job Queued...' : 'Stitching Video Clip...'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      {activeJob.exportMode === 'STREAM_COPY'
                        ? 'Executing zero-transcode packet copy concat.'
                        : 'Rendering timestamp OSD derivative.'}
                    </p>
                  </div>
                </div>
              ) : activeJob.status === 'COMPLETED' ? (
                <div className="space-y-4 bg-[#111827] p-5 rounded-xl border border-emerald-900/60">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 className="w-5 h-5" />
                    <h3 className="text-sm font-semibold text-slate-100">Export Ready</h3>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-[#1f2937] text-slate-400">
                      <span>Export Mode:</span>
                      <span className="font-mono text-slate-200">
                        {activeJob.exportMode === 'STREAM_COPY'
                          ? 'Original / Stream Copy'
                          : 'Transcoded Derivative (OSD)'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-[#1f2937] text-slate-400">
                      <span>File Size:</span>
                      <span className="font-mono text-slate-200">
                        {formatFileSize(activeJob.fileSize)}
                      </span>
                    </div>

                    {/* SHA-256 Integrity Checksum Badge */}
                    <div className="pt-2">
                      <div className="flex items-center justify-between text-slate-300 font-medium mb-1">
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                          <ShieldCheck className="w-3.5 h-3.5" /> SHA-256 integrity checksum
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyChecksum}
                          className="text-[11px] text-[#4fc3f7] hover:underline flex items-center gap-1"
                        >
                          {copiedHash ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> Copy Hash
                            </>
                          )}
                        </button>
                      </div>
                      <div className="p-2 bg-[#090d16] rounded border border-[#1f2937] font-mono text-[10px] text-slate-300 break-all select-all">
                        {activeJob.sha256 || 'Generating...'}
                      </div>
                    </div>
                  </div>

                  {/* Download Action */}
                  <div className="pt-3 flex gap-2">
                    <a
                      href={`${apiBaseUrl}/api/recordings/export/${activeJob.id}/download`}
                      download
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg text-center flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Download className="w-4 h-4" /> Download MP4 Clip
                    </a>
                    <button
                      type="button"
                      onClick={() => setActiveJob(null)}
                      className="px-4 py-2.5 bg-[#090d16] border border-[#1f2937] text-xs text-slate-300 hover:text-slate-100 rounded-lg"
                    >
                      New Export
                    </button>
                  </div>
                </div>
              ) : (
                /* Failed State */
                <div className="space-y-3 p-4 bg-red-950/30 border border-red-900 rounded-xl text-center">
                  <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
                  <p className="text-xs text-red-200">
                    {activeJob.errorMessage || 'Export job failed.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveJob(null)}
                    className="px-4 py-1.5 bg-[#111827] border border-[#1f2937] text-xs text-slate-200 rounded-lg"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
