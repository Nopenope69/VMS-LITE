import React, { useState, useMemo } from 'react';
import {
  Camera,
  Plus,
  Search,
  Video,
  Sliders,
  Play,
  ArrowRight,
  ExternalLink,
  Shield,
  Layers,
  Sparkles,
} from 'lucide-react';
import { CameraRecord } from '../App.js';
import { CameraHealthTelemetry } from '../hooks/useCameraHealth.js';

export interface CamerasListViewProps {
  cameras: CameraRecord[];
  healthMap: Record<string, CameraHealthTelemetry>;
  isAdmin?: boolean;
  onSelectCamera: (cameraId: string) => void;
  onOpenAddCamera: () => void;
  onOpenMotionZones: (camera: CameraRecord) => void;
}

export const CamerasListView: React.FC<CamerasListViewProps> = ({
  cameras,
  healthMap,
  isAdmin = true,
  onSelectCamera,
  onOpenAddCamera,
  onOpenMotionZones,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredCameras = useMemo(() => {
    if (!searchQuery.trim()) return cameras;
    const q = searchQuery.toLowerCase();
    return cameras.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.ipAddress || (c as any).ip || '').toLowerCase().includes(q) ||
        (c.manufacturer && c.manufacturer.toLowerCase().includes(q))
    );
  }, [cameras, searchQuery]);

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 md:py-10 flex flex-col font-sans select-none overflow-y-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white">Cameras</h1>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'} configured · Zero-transcode RTSP & WebRTC
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              type="button"
              onClick={onOpenAddCamera}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium text-xs shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add camera</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="mb-6">
        <div className="relative w-full max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by camera name, IP, or brand..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all font-sans"
          />
        </div>
      </div>

      {/* Camera Grid / Cards */}
      {filteredCameras.length === 0 ? (
        <div className="py-20 text-center border border-dashed border-white/[0.08] rounded-xl">
          <Camera className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-400">
            {searchQuery ? 'No matching cameras found' : 'No cameras added yet'}
          </p>
          <p className="text-xs text-zinc-600 mt-1 mb-4">
            {searchQuery
              ? 'Try searching with a different term.'
              : 'Onboard your first ONVIF or RTSP camera in under 2 minutes.'}
          </p>
          {isAdmin && !searchQuery && (
            <button
              type="button"
              onClick={onOpenAddCamera}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium text-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add camera</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredCameras.map((camera) => {
            const telemetry = healthMap[camera.id];
            const isOnline = telemetry ? telemetry.status === 'ONLINE' : camera.status === 'ONLINE';

            return (
              <div
                key={camera.id}
                className="group p-4 bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/15 rounded-xl transition-all flex flex-col justify-between"
              >
                {/* Top Row: Camera Info & Status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors">
                      <Camera className="w-4 h-4" />
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">
                        {camera.name}
                      </div>
                      <div className="text-xs text-zinc-500 font-mono mt-0.5">
                        {camera.ipAddress} {camera.manufacturer ? `· ${camera.manufacturer}` : ''}
                      </div>
                    </div>
                  </div>

                  {/* Online Badge */}
                  <div className="flex items-center gap-1.5 text-[11px] font-medium">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isOnline
                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                          : 'bg-zinc-600'
                      }`}
                    />
                    <span className={isOnline ? 'text-emerald-400' : 'text-zinc-500'}>
                      {isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>

                {/* Middle Info: Stream details */}
                <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs text-zinc-400">
                  <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-500">
                    <span>Path: {camera.streamPath || 'live'}</span>
                    {telemetry?.latencyMs && (
                      <span>Latency: {telemetry.latencyMs}ms</span>
                    )}
                  </div>
                </div>

                {/* Bottom Row: Actions */}
                <div className="mt-4 pt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onOpenMotionZones(camera)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <Sliders className="w-3 h-3" />
                    <span>Motion zones</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectCamera(camera.id)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/[0.04] hover:bg-white/10 border border-white/[0.08] text-xs font-medium text-white transition-all group-hover:border-emerald-500/40"
                  >
                    <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
                    <span>View camera</span>
                    <ArrowRight className="w-3 h-3 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
