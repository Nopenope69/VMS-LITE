import React, { useState } from 'react';
import {
  Grid2X2,
  Square,
  Grid3X3,
  Maximize,
  ChevronDown,
  Video,
  Radio,
  ExternalLink,
} from 'lucide-react';
import { CameraStreamInfo } from '../components/LiveCameraTile.js';
import { WhepHlsPlayer } from '../components/WhepHlsPlayer.js';
import { CameraHealthTelemetry } from '../hooks/useCameraHealth.js';

export type LiveLayout = '1x1' | '2x2' | '3x3';

export interface LiveViewProps {
  cameras: CameraStreamInfo[];
  iceServers?: RTCIceServer[];
  healthMap?: Record<string, CameraHealthTelemetry>;
  onlineCount: number;
  onSelectCamera: (cameraId: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  ONLINE: 'bg-emerald-400',
  DEGRADED: 'bg-amber-400',
  OFFLINE: 'bg-red-500',
};

export const LiveView: React.FC<LiveViewProps> = ({
  cameras,
  iceServers,
  healthMap = {},
  onlineCount,
  onSelectCamera,
}) => {
  const [layout, setLayout] = useState<LiveLayout>('2x2');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Compute number of slots based on layout
  const slotCount = layout === '1x1' ? 1 : layout === '2x2' ? 4 : 9;
  const visibleCameras = cameras.slice(0, slotCount);

  // Grid styling
  const gridClasses =
    layout === '1x1'
      ? 'grid-cols-1 grid-rows-1'
      : layout === '2x2'
      ? 'grid-cols-1 md:grid-cols-2 grid-rows-2'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 grid-rows-3';

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] font-sans select-none overflow-hidden">
      {/* Top Bar: Minimal Chrome */}
      <div className="h-14 px-6 border-b border-white/[0.06] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight text-white">Live</h1>
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        </div>

        {/* Right Layout Selector & Fullscreen */}
        <div className="flex items-center gap-2">
          {/* Layout Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900/80 border border-white/[0.08] hover:border-white/20 text-xs font-medium text-zinc-300 transition-colors"
            >
              <span>{layout === '1x1' ? '1 × 1' : layout === '2x2' ? '2 × 2' : '3 × 3'}</span>
              <span className="text-zinc-500">Layout</span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-36 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={() => {
                    setLayout('1x1');
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    layout === '1x1' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>1 × 1 Focus</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLayout('2x2');
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    layout === '2x2' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Grid2X2 className="w-3.5 h-3.5" />
                  <span>2 × 2 Quad</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLayout('3x3');
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    layout === '3x3' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                  <span>3 × 3 Matrix</span>
                </button>
              </div>
            )}
          </div>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="p-1.5 rounded-lg bg-zinc-900/80 border border-white/[0.08] hover:border-white/20 text-zinc-400 hover:text-white transition-colors"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Surveillance Canvas */}
      <div className="flex-1 p-3 md:p-4 overflow-hidden flex flex-col">
        {cameras.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-zinc-500">
            <Video className="w-10 h-10 mb-3 opacity-40" />
            <h2 className="text-sm font-semibold text-zinc-300">No cameras configured</h2>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm">
              Onboard ONVIF cameras or start RTSP streams to view live feeds.
            </p>
          </div>
        ) : (
          <div className={`grid ${gridClasses} gap-3 flex-1 h-full w-full`}>
            {visibleCameras.map((cam) => (
              <div
                key={cam.cameraId}
                onClick={() => onSelectCamera(cam.cameraId)}
                className="group relative rounded-xl overflow-hidden bg-zinc-950 border border-white/[0.08] hover:border-white/25 transition-all cursor-pointer shadow-lg flex flex-col justify-between"
              >
                {/* Video Player Surface */}
                <div className="absolute inset-0">
                  {/* Multi-tile layouts use the sub-stream when the camera has one:
                      a 3x3 grid of main streams can saturate a remote site's uplink */}
                  <WhepHlsPlayer
                    whepUrl={(layout !== '1x1' && cam.subStreamWhepUrl) || cam.whepUrl}
                    hlsUrl={(layout !== '1x1' && cam.subStreamHlsUrl) || cam.hlsUrl}
                    iceServers={iceServers}
                    cameraName={cam.name}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Subtle top overlay with camera name */}
                <div className="relative z-10 p-3 flex items-center justify-between pointer-events-none bg-gradient-to-b from-black/60 to-transparent">
                  <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-zinc-950/70 backdrop-blur-md border border-white/10 text-xs">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[healthMap[cam.cameraId]?.status ?? ''] ?? 'bg-zinc-500'}`}
                      title={healthMap[cam.cameraId]?.status ?? 'UNKNOWN'}
                    />
                    <span className="font-medium text-zinc-200 tracking-tight">{cam.name}</span>
                  </div>
                </div>

                {/* Hover Click Target Hint */}
                <div className="relative z-10 p-3 flex justify-end pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="px-2 py-1 rounded-md bg-zinc-950/80 backdrop-blur-md border border-white/15 text-[11px] font-medium text-white flex items-center gap-1.5 shadow-md">
                    <span>Focus Camera</span>
                    <ExternalLink className="w-3 h-3 text-zinc-400" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Minimal Footer Status Line */}
      <div className="h-9 px-6 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-zinc-500 shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-zinc-400">{onlineCount} cameras online</span>
        </div>
        <span>Zero-latency WebRTC</span>
      </div>
    </div>
  );
};
