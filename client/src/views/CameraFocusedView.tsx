import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Download,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Radio,
  Sliders,
  Volume2,
  VolumeX,
  Camera,
  Layers,
  Clock,
  Check,
} from 'lucide-react';
import { CameraRecord } from '../App.js';
import { WhepHlsPlayer } from '../components/WhepHlsPlayer.js';

export interface CameraFocusedViewProps {
  camera: CameraRecord;
  onBack: () => void;
  onOpenBookmark: (cameraId: string) => void;
  onOpenExport: (cameraId: string) => void;
}

export const CameraFocusedView: React.FC<CameraFocusedViewProps> = ({
  camera,
  onBack,
  onOpenBookmark,
  onOpenExport,
}) => {
  const [isLive, setIsLive] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [timelinePercent, setTimelinePercent] = useState<number>(85); // 0 - 100
  const [showRecordingLayer, setShowRecordingLayer] = useState<boolean>(true);
  const [showMotionLayer, setShowMotionLayer] = useState<boolean>(true);
  const [showEventsLayer, setShowEventsLayer] = useState<boolean>(true);

  // Generate current time ticks for the 1-hour window (e.g., 12:00, 12:15, 12:30, 12:45)
  const [timeTicks, setTimeTicks] = useState<string[]>(['12:00', '12:15', '12:30', '12:45']);

  useEffect(() => {
    const now = new Date();
    const roundQuarter = (d: Date, minusMinutes: number) => {
      const target = new Date(d.getTime() - minusMinutes * 60 * 1000);
      return target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    };
    setTimeTicks([
      roundQuarter(now, 45),
      roundQuarter(now, 30),
      roundQuarter(now, 15),
      now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    ]);
  }, []);

  const whepUrl = `/whep/${camera.streamPath || camera.id}`;
  const hlsUrl = `/hls/${camera.streamPath || camera.id}/index.m3u8`;

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
    setTimelinePercent(percent);
    // If clicked near the end (> 95%), jump to live edge; otherwise enter playback mode
    if (percent > 95) {
      setIsLive(true);
    } else {
      setIsLive(false);
    }
  };

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-6 md:py-8 flex flex-col font-sans select-none overflow-y-auto">
      {/* Top Navigation: ← Cameras */}
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

      {/* Screen Header: Camera Name + Live Status */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white">
            {camera.name}
          </h1>
          <span className="text-xs font-mono text-zinc-500 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.06]">
            {camera.ipAddress}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse" />
            <span>Online</span>
          </div>
        </div>
      </div>

      {/* Primary Video Container */}
      <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/[0.08] shadow-2xl flex items-center justify-center group mb-6">
        <WhepHlsPlayer
          whepUrl={whepUrl}
          hlsUrl={hlsUrl}
          cameraName={camera.name}
          className="w-full h-full object-contain"
        />

        {/* Stream Mode Pill (Live vs Playback) */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
          {isLive ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-950/70 backdrop-blur-md border border-white/10 text-emerald-400 text-xs font-medium font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-950/70 backdrop-blur-md border border-white/10 text-amber-400 text-xs font-medium font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              PLAYBACK
            </span>
          )}
        </div>
      </div>

      {/* Timeline Scrubber Container */}
      <div className="rounded-xl border border-white/[0.07] bg-zinc-950/60 p-4 mb-6">
        {/* Time Ticks */}
        <div className="flex justify-between text-[11px] font-mono text-zinc-500 mb-2 px-1">
          {timeTicks.map((tick, i) => (
            <span key={i}>{tick}</span>
          ))}
        </div>

        {/* Interactive Scrub Track */}
        <div
          onClick={handleTimelineClick}
          className="relative h-8 w-full bg-zinc-900 rounded-lg cursor-pointer overflow-hidden border border-white/10"
        >
          {/* Continuous Recording Span (Green) */}
          {showRecordingLayer && (
            <div
              className="absolute top-1.5 bottom-1.5 bg-emerald-500/40 rounded-sm"
              style={{ left: '10%', width: '85%' }}
            />
          )}

          {/* Motion Event Blocks (Amber) */}
          {showMotionLayer && (
            <>
              <div
                className="absolute top-1 bottom-1 bg-amber-400 rounded-sm shadow-[0_0_6px_rgba(251,191,36,0.6)]"
                style={{ left: '35%', width: '4%' }}
                title="Motion event 12:15"
              />
              <div
                className="absolute top-1 bottom-1 bg-amber-400 rounded-sm shadow-[0_0_6px_rgba(251,191,36,0.6)]"
                style={{ left: '60%', width: '6%' }}
                title="Motion event 12:28"
              />
            </>
          )}

          {/* Playhead Marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white z-20 pointer-events-none transition-all shadow-[0_0_8px_white]"
            style={{ left: `${timelinePercent}%` }}
          >
            <div className="w-2.5 h-2.5 bg-white rounded-full -ml-1 -mt-0.5 shadow-md" />
          </div>
        </div>

        {/* Timeline Bottom: Layers & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-white/[0.06]">
          {/* Layer Filters */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRecordingLayer(!showRecordingLayer)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                showRecordingLayer
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'text-zinc-500 hover:text-zinc-300 bg-white/[0.02]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Recording</span>
            </button>

            <button
              type="button"
              onClick={() => setShowMotionLayer(!showMotionLayer)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                showMotionLayer
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'text-zinc-500 hover:text-zinc-300 bg-white/[0.02]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>Motion</span>
            </button>

            <button
              type="button"
              onClick={() => setShowEventsLayer(!showEventsLayer)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                showEventsLayer
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                  : 'text-zinc-500 hover:text-zinc-300 bg-white/[0.02]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span>Events</span>
            </button>
          </div>

          {/* Action CTAs: Live, Bookmark, Export */}
          <div className="flex items-center gap-2">
            {!isLive && (
              <button
                type="button"
                onClick={() => {
                  setTimelinePercent(98);
                  setIsLive(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Jump to Live</span>
              </button>
            )}

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
      </div>
    </div>
  );
};
