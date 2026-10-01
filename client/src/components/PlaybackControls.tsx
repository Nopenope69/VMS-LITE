import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Calendar,
  Clock,
  Gauge,
  Download,
} from 'lucide-react';

export interface PlaybackControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStep: (seconds: number) => void; // e.g. -5 or +5
  playbackRate: number;
  onChangePlaybackRate: (rate: number) => void;
  selectedDate: string; // YYYY-MM-DD
  onChangeDate: (date: string) => void;
  currentTime: Date;
  isLoading?: boolean;
  onExportClip?: () => void;
}

const PLAYBACK_RATES = [0.5, 1, 2, 4, 8];

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  onTogglePlay,
  onStep,
  playbackRate,
  onChangePlaybackRate,
  selectedDate,
  onChangeDate,
  currentTime,
  isLoading = false,
  onExportClip,
}) => {
  const formatDateTimeDisplay = (d: Date): string => {
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="glass-bar px-4 py-2.5 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-zinc-100 select-none">
      {/* Left: Date Picker & Current Playhead Time */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2 hud-chip px-3 py-1.5 rounded-lg text-xs">
          <Calendar className="w-3.5 h-3.5 text-zinc-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onChangeDate(e.target.value)}
            className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer text-xs font-medium"
          />
        </div>

        <div className="flex items-center gap-2 font-mono text-xs font-semibold text-emerald-400 hud-chip px-3 py-1.5 rounded-lg tabular-nums">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span>{formatDateTimeDisplay(currentTime)}</span>
        </div>
      </div>

      {/* Center: Play, Pause, Step Buttons */}
      <div className="flex items-center gap-2">
        {/* Step Backward -5s */}
        <button
          type="button"
          onClick={() => onStep(-5)}
          title="Step Backward 5s"
          className="flex items-center gap-1 px-3 py-1.5 hud-chip hover:bg-zinc-800 active:scale-95 rounded-lg text-xs font-mono text-zinc-300 transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
          <span>-5s</span>
        </button>

        {/* Play / Pause Toggle */}
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={isLoading}
          title={isPlaying ? 'Pause Footage (Space)' : 'Play Footage (Space)'}
          className="w-10 h-10 bg-emerald-500 hover:bg-emerald-400 active:scale-95 disabled:opacity-50 text-zinc-950 rounded-full transition-all shadow-[0_0_16px_rgba(16,185,129,0.3)] flex items-center justify-center font-bold"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        {/* Step Forward +5s */}
        <button
          type="button"
          onClick={() => onStep(5)}
          title="Step Forward 5s"
          className="flex items-center gap-1 px-3 py-1.5 hud-chip hover:bg-zinc-800 active:scale-95 rounded-lg text-xs font-mono text-zinc-300 transition-all"
        >
          <span>+5s</span>
          <RotateCw className="w-3.5 h-3.5 text-zinc-400" />
        </button>
      </div>

      {/* Right: Variable Playback Speed & Clip Download */}
      <div className="flex items-center gap-2.5">
        {/* Speed Controls */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
            <Gauge className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden lg:inline">Speed:</span>
          </div>
          <div className="flex items-center bg-zinc-950/60 p-0.5 rounded-lg border border-white/[0.07]">
            {PLAYBACK_RATES.map((rate) => {
              const isSelected = playbackRate === rate;
              return (
                <button
                  key={`rate-${rate}`}
                  type="button"
                  onClick={() => onChangePlaybackRate(rate)}
                  className={`px-2 py-0.5 text-xs font-mono font-medium rounded-md transition-all ${
                    isSelected
                      ? 'bg-zinc-800 text-emerald-400 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {rate}x
                </button>
              );
            })}
          </div>
        </div>

        {/* Amber Export Clip Button */}
        {onExportClip && (
          <button
            type="button"
            onClick={onExportClip}
            title="Download this recording segment"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 font-medium text-xs rounded-lg transition-all active:scale-95 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save Clip</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default PlaybackControls;
