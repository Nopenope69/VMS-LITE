import React from 'react';
import { ArrowLeft, Bookmark, Download, History } from 'lucide-react';
import { CameraRecord } from '../App.js';
import { WhepHlsPlayer } from '../components/WhepHlsPlayer.js';
import { CameraHealthTelemetry } from '../hooks/useCameraHealth.js';

export interface CameraFocusedViewProps {
  camera: CameraRecord;
  iceServers?: RTCIceServer[];
  health?: CameraHealthTelemetry | null;
  onBack: () => void;
  onOpenPlayback: (cameraId: string) => void;
  onOpenBookmark: (cameraId: string) => void;
  onOpenExport: (cameraId: string) => void;
}

const STATUS_STYLE: Record<string, { label: string; dot: string; text: string }> = {
  ONLINE: { label: 'Online', dot: 'bg-emerald-400 animate-pulse', text: 'text-emerald-400' },
  DEGRADED: { label: 'Degraded', dot: 'bg-amber-400', text: 'text-amber-400' },
  OFFLINE: { label: 'Offline', dot: 'bg-red-500', text: 'text-red-400' },
  UNKNOWN: { label: 'Checking…', dot: 'bg-zinc-500', text: 'text-zinc-400' },
};

/**
 * Single-camera live view. Recorded footage is reviewed on the Recordings page,
 * which renders the real recording timeline for this camera.
 */
export const CameraFocusedView: React.FC<CameraFocusedViewProps> = ({
  camera,
  iceServers,
  health,
  onBack,
  onOpenPlayback,
  onOpenBookmark,
  onOpenExport,
}) => {
  const status = STATUS_STYLE[health?.status ?? 'UNKNOWN'] ?? STATUS_STYLE.UNKNOWN;
  const hasStream = Boolean(camera.whepUrl || camera.hlsUrl);

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-6 md:py-8 flex flex-col font-sans select-none overflow-y-auto">
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors group"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Cameras</span>
        </button>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white">{camera.name}</h1>
          {camera.ipAddress && (
            <span className="text-xs font-mono text-zinc-500 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.06]">
              {camera.ipAddress}
            </span>
          )}
        </div>

        <div
          className={`flex items-center gap-1.5 text-xs font-medium font-mono ${status.text}`}
          title={health?.reason ?? undefined}
        >
          <span className={`w-2 h-2 rounded-full ${status.dot}`} />
          <span>{status.label}</span>
        </div>
      </div>

      <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/[0.08] shadow-2xl flex items-center justify-center mb-6">
        {hasStream ? (
          <WhepHlsPlayer
            whepUrl={camera.whepUrl || ''}
            hlsUrl={camera.hlsUrl || ''}
            iceServers={iceServers}
            cameraName={camera.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <p className="text-sm text-zinc-500">No live stream is available for this camera.</p>
        )}

        <div className="absolute top-4 left-4 z-20">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-950/70 backdrop-blur-md border border-white/10 text-emerald-400 text-xs font-medium font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onOpenPlayback(camera.id)}
          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <History className="w-3.5 h-3.5" />
          <span>View recordings</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenBookmark(camera.id)}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <Bookmark className="w-3.5 h-3.5 text-zinc-400" />
          <span>Bookmark</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenExport(camera.id)}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/10 text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5 text-zinc-400" />
          <span>Export</span>
        </button>
      </div>
    </div>
  );
};
