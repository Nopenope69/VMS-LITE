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
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#111827] border-t border-[#1f2937] text-slate-100 select-none">
      {/* Left: Date Picker & Current Playhead Time */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-[#090d16] px-3 py-2 rounded-md border border-[#1f2937] text-xs">
          <Calendar className="w-4 h-4 text-[#4fc3f7]" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onChangeDate(e.target.value)}
            className="bg-transparent text-slate-200 focus:outline-none cursor-pointer text-xs font-semibold"
          />
        </div>

        <div className="flex items-center gap-2 font-mono text-sm font-bold text-[#4fc3f7] bg-[#090d16] px-3 py-2 rounded-md border border-[#1f2937] shadow-inner">
          <Clock className="w-4 h-4 text-[#4fc3f7]" />
          <span>{formatDateTimeDisplay(currentTime)}</span>
        </div>
      </div>

      {/* Center: Play, Pause, Step Buttons (PLAY-04 with Giant Touch Targets) */}
      <div className="flex items-center gap-3">
        {/* Step Backward -5s */}
        <button
          type="button"
          onClick={() => onStep(-5)}
          title="Step Backward 5s"
          className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] bg-[#090d16] hover:bg-[#1f2937] active:scale-95 border border-[#1f2937] hover:border-[#4fc3f7]/50 rounded-md text-xs font-semibold text-slate-200 transition-all shadow-sm"
        >
          <RotateCcw className="w-4 h-4 text-[#4fc3f7]" />
          <span>-5s</span>
        </button>

        {/* Play / Pause Toggle (Giant 48x48 Ion Blue Button) */}
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={isLoading}
          title={isPlaying ? 'Pause Footage' : 'Play Footage'}
          className="w-12 h-12 bg-[#4fc3f7] hover:bg-[#38bdf8] active:scale-95 disabled:opacity-50 text-[#090d16] rounded-full transition-all shadow-[0_0_15px_rgba(79,195,247,0.4)] flex items-center justify-center font-bold"
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" />
          )}
        </button>

        {/* Step Forward +5s */}
        <button
          type="button"
          onClick={() => onStep(5)}
          title="Step Forward 5s"
          className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] bg-[#090d16] hover:bg-[#1f2937] active:scale-95 border border-[#1f2937] hover:border-[#4fc3f7]/50 rounded-md text-xs font-semibold text-slate-200 transition-all shadow-sm"
        >
          <span>+5s</span>
          <RotateCw className="w-4 h-4 text-[#4fc3f7]" />
        </button>
      </div>

      {/* Right: Variable Playback Speed & Clip Download */}
      <div className="flex items-center gap-3">
        {/* Speed Controls */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 text-xs text-slate-400 mr-1 font-medium">
            <Gauge className="w-4 h-4 text-[#4fc3f7]" />
            <span className="hidden lg:inline">Speed:</span>
          </div>
          <div className="flex items-center bg-[#090d16] p-1 rounded-md border border-[#1f2937]">
            {PLAYBACK_RATES.map((rate) => {
              const isSelected = playbackRate === rate;
              return (
                <button
                  key={`rate-${rate}`}
                  type="button"
                  onClick={() => onChangePlaybackRate(rate)}
                  className={`px-2.5 py-1 text-xs font-mono font-bold rounded transition-colors ${
                    isSelected
                      ? 'bg-[#4fc3f7] text-[#090d16] shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {rate}x
                </button>
              );
            })}
          </div>
        </div>

        {/* Solar Amber Export Clip Button */}
        {onExportClip && (
          <button
            type="button"
            onClick={onExportClip}
            title="Download this recording segment"
            className="flex items-center gap-2 px-3.5 py-2 min-h-[40px] bg-[#fb923c] hover:bg-[#f97316] text-gray-950 font-bold text-xs rounded-md transition-all shadow-md active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Save Clip</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default PlaybackControls;
