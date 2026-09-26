import React, { useRef, useState, useCallback } from 'react';
import type { TimelineSpan } from '../hooks/usePlaybackSession.js';

export interface CameraTrackData {
  cameraId: string;
  cameraName: string;
  color?: string;
  spans: TimelineSpan[];
}

export interface MultiTrackTimelineProps {
  currentDate: string; // YYYY-MM-DD
  currentTime: Date;
  tracks: CameraTrackData[];
  onSeek: (time: Date) => void;
  className?: string;
}

const TRACK_COLORS = [
  '#4fc3f7', // Cyan
  '#34d399', // Emerald
  '#a78bfa', // Purple
  '#f472b6', // Pink
];

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({
  currentDate,
  currentTime,
  tracks,
  onSeek,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [hoverPosition, setHoverPosition] = useState<{ xPercent: number; timeStr: string } | null>(null);

  const getDayStartMs = useCallback((): number => {
    const parts = currentDate.split('-').map(Number);
    if (parts.length === 3) {
      return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime();
    }
    const d = new Date(currentDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [currentDate]);

  const dayStartMs = getDayStartMs();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const currentOffsetMs = Math.max(0, Math.min(DAY_MS, currentTime.getTime() - dayStartMs));
  const playheadPercent = (currentOffsetMs / DAY_MS) * 100;

  const formatTimeFromOffset = (offsetMs: number): string => {
    const totalSeconds = Math.floor(Math.max(0, Math.min(DAY_MS, offsetMs)) / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handlePointerAction = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetMs = dayStartMs + fraction * DAY_MS;
      onSeek(new Date(targetMs));
    },
    [dayStartMs, DAY_MS, onSeek]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    handlePointerAction(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    const hoverMs = fraction * DAY_MS;
    setHoverPosition({
      xPercent: fraction * 100,
      timeStr: formatTimeFromOffset(hoverMs),
    });

    if (isDragging) {
      handlePointerAction(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
    setIsDragging(false);
  };

  const handlePointerLeave = () => {
    if (!isDragging) {
      setHoverPosition(null);
    }
  };

  const hours = Array.from({ length: 25 }, (_, i) => i);

  return (
    <div className={`w-full bg-[#0d131f] border border-[#1f2937] rounded-lg p-2.5 select-none ${className}`}>
      {/* Header Info */}
      <div className="flex items-center justify-between mb-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-200">SYNCHRONIZED MULTI-TRACK TIMELINE</span>
          <span className="text-[10px] text-slate-400 font-mono">({tracks.length} Channels Locked)</span>
        </div>
        <div className="text-xs font-mono font-bold text-[#4fc3f7] bg-[#4fc3f7]/10 px-2 py-0.5 rounded border border-[#4fc3f7]/30">
          PLAYHEAD: {formatTimeFromOffset(currentOffsetMs)}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* Time Scale Ruler */}
        <div className="flex items-center">
          <div className="w-36 shrink-0 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Channel
          </div>
          <div className="flex-1 relative h-4">
            <div className="absolute inset-0 flex justify-between text-[9px] font-mono text-slate-400">
              {hours.filter((h) => h % 2 === 0).map((h) => (
                <div key={h} className="relative -translate-x-1/2 flex flex-col items-center">
                  <span>{String(h).padStart(2, '0')}:00</span>
                  <div className="w-px h-1 bg-slate-600 mt-0.5" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Multi-Track Grid with Cross-Track Playhead */}
        <div className="flex flex-col gap-1.5 relative">
          {tracks.map((track, trackIndex) => {
            const trackColor = track.color || TRACK_COLORS[trackIndex % TRACK_COLORS.length];
            const totalRecordedSec = track.spans.reduce((sum, s) => sum + s.durationSeconds, 0);
            const totalRecordedHours = (totalRecordedSec / 3600).toFixed(1);

            return (
              <div key={track.cameraId} className="flex items-center gap-2">
                {/* Camera Channel Label */}
                <div className="w-36 shrink-0 flex items-center justify-between bg-[#111827] px-2 py-1.5 rounded border border-[#1f2937] text-xs">
                  <div className="flex items-center gap-1.5 truncate">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
                    <span className="truncate text-slate-200 font-medium text-[11px]" title={track.cameraName}>
                      {track.cameraName}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-1">
                    {totalRecordedHours}h
                  </span>
                </div>

                {/* Track Ribbon */}
                <div className="flex-1 h-6 bg-[#090d16] rounded border border-[#1f2937] relative overflow-hidden">
                  {/* Recorded Segments */}
                  {track.spans.map((span, sIdx) => {
                    const startMs = new Date(span.startTime).getTime();
                    const endMs = new Date(span.endTime).getTime();
                    const startOffset = Math.max(0, Math.min(DAY_MS, startMs - dayStartMs));
                    const endOffset = Math.max(0, Math.min(DAY_MS, endMs - dayStartMs));

                    const leftPct = (startOffset / DAY_MS) * 100;
                    const widthPct = Math.max(0.2, ((endOffset - startOffset) / DAY_MS) * 100);

                    return (
                      <div
                        key={span.recordingId || sIdx}
                        className="absolute top-0 bottom-0 rounded-sm opacity-85 transition-opacity hover:opacity-100"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          backgroundColor: trackColor,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Transparent Overlay for Pointer Dragging across all tracks */}
          <div
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            className="absolute top-0 bottom-0 left-[152px] right-0 cursor-pointer touch-none z-10"
          >
            {/* Unified Vertical Playhead Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.8)]"
              style={{ left: `${playheadPercent}%` }}
            >
              <div className="absolute -top-1 -left-1.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white shadow" />
            </div>

            {/* Hover Tooltip Line */}
            {hoverPosition && (
              <div
                className="absolute top-0 bottom-0 w-px bg-white/50 pointer-events-none"
                style={{ left: `${hoverPosition.xPercent}%` }}
              >
                <div className="absolute -top-6 -translate-x-1/2 bg-[#111827] text-white text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#1f2937] shadow">
                  {hoverPosition.timeStr}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
