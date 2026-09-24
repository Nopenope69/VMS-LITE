import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Calendar,
  Clock,
  Gauge,
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
}) => {
  const formatDateTimeDisplay = (d: Date): string => {
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-zinc-900 border-t border-zinc-800 text-zinc-100 select-none">
      {/* Left: Date Picker & Current Playhead Time */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-800 text-xs">
          <Calendar className="w-3.5 h-3.5 text-zinc-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onChangeDate(e.target.value)}
            className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5 font-mono text-sm font-semibold text-emerald-400 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800">
          <Clock className="w-3.5 h-3.5 text-emerald-500" />
          <span>{formatDateTimeDisplay(currentTime)}</span>
        </div>
      </div>

      {/* Center: Play, Pause, Step Buttons (PLAY-04) */}
      <div className="flex items-center gap-2">
        {/* Step Backward -5s */}
        <button
          type="button"
          onClick={() => onStep(-5)}
          title="Step Backward 5s"
          className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded text-xs text-zinc-200 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>-5s</span>
        </button>

        {/* Play / Pause Toggle */}
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={isLoading}
          title={isPlaying ? 'Pause' : 'Play'}
          className="p-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white rounded-full transition-colors shadow-md flex items-center justify-center"
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
          className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded text-xs text-zinc-200 transition-colors"
        >
          <span>+5s</span>
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right: Variable Playback Speed (0.5x to 8x) */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 text-xs text-zinc-400 mr-1">
          <Gauge className="w-3.5 h-3.5" />
          <span>Speed:</span>
        </div>
        <div className="flex items-center bg-zinc-950 p-0.5 rounded border border-zinc-800">
          {PLAYBACK_RATES.map((rate) => {
            const isSelected = playbackRate === rate;
            return (
              <button
                key={`rate-${rate}`}
                type="button"
                onClick={() => onChangePlaybackRate(rate)}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                  isSelected
                    ? 'bg-zinc-700 text-white font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {rate}x
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PlaybackControls;
