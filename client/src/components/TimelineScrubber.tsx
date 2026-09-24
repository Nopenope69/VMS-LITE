import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { TimelineSpan } from '../hooks/usePlaybackSession.js';

export type { TimelineSpan };

export interface TimelineScrubberProps {
  currentDate: string; // YYYY-MM-DD
  currentTime: Date;
  spans: TimelineSpan[];
  onSeek: (time: Date) => void;
  className?: string;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  currentDate,
  currentTime,
  spans,
  onSeek,
  className = '',
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [hoverPosition, setHoverPosition] = useState<{ xPercent: number; timeStr: string } | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Compute start of the given date in local time
  const getDayStartMs = useCallback((): number => {
    // If currentDate is YYYY-MM-DD, create date at 00:00:00
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

  // Compute playhead percentage [0, 100]
  const currentOffsetMs = Math.max(0, Math.min(DAY_MS, currentTime.getTime() - dayStartMs));
  const playheadPercent = (currentOffsetMs / DAY_MS) * 100;

  // Format milliseconds into HH:MM:SS
  const formatTimeFromOffset = (offsetMs: number): string => {
    const totalSeconds = Math.floor(Math.max(0, Math.min(DAY_MS, offsetMs)) / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handlePointerAction = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
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
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    // Update hover tooltip
    const hoverMs = fraction * DAY_MS;
    setHoverPosition({
      xPercent: fraction * 100,
      timeStr: formatTimeFromOffset(hoverMs),
    });

    if (isDragging) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(() => {
        handlePointerAction(e.clientX);
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture already released
      }
    }
  };

  const handlePointerLeave = () => {
    if (!isDragging) {
      setHoverPosition(null);
    }
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Pre-calculate spans relative to the day
  const renderedSpans = spans.map((span, idx) => {
    const spanStartMs = new Date(span.startTime).getTime();
    const spanEndMs = new Date(span.endTime).getTime();

    const startOffset = Math.max(0, spanStartMs - dayStartMs);
    const endOffset = Math.min(DAY_MS, spanEndMs - dayStartMs);

    if (endOffset <= 0 || startOffset >= DAY_MS || startOffset >= endOffset) {
      return null;
    }

    const left = (startOffset / DAY_MS) * 100;
    const width = Math.max(0.15, ((endOffset - startOffset) / DAY_MS) * 100);

    return {
      key: span.recordingId || `span-${idx}`,
      left: `${left}%`,
      width: `${width}%`,
      startTime: span.startTime,
      endTime: span.endTime,
    };
  }).filter(Boolean);

  // Hour labels (every 2 hours: 00:00, 02:00, ..., 24:00)
  const hours = Array.from({ length: 13 }, (_, i) => i * 2);

  return (
    <div className={`w-full select-none flex flex-col gap-2 ${className}`}>
      {/* 24h Time Ruler Header */}
      <div className="relative w-full h-5 text-[11px] text-slate-400 font-mono">
        {hours.map((hour) => {
          const percent = (hour / 24) * 100;
          return (
            <div
              key={`hour-${hour}`}
              className="absolute transform -translate-x-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${percent}%` }}
            >
              <span className="font-semibold">{String(hour).padStart(2, '0')}:00</span>
              <div className="w-[1px] h-1.5 bg-[#1f2937] mt-0.5" />
            </div>
          );
        })}
      </div>

      {/* Main Timeline Scrubber Bar with Taller Ergonomic Hit Area */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className="relative w-full h-12 bg-[#090d16] border border-[#1f2937] rounded-lg cursor-pointer overflow-hidden group shadow-inner transition-colors hover:border-[#4fc3f7]/40"
      >
        {/* Background minor grid lines every 1 hour */}
        {Array.from({ length: 24 }, (_, i) => (
          <div
            key={`minor-tick-${i}`}
            className="absolute top-0 bottom-0 w-[1px] bg-[#1f2937]/70 pointer-events-none"
            style={{ left: `${(i / 24) * 100}%` }}
          />
        ))}

        {/* Recorded Video Spans (Continuous Blue Blocks in Palette 1) */}
        {renderedSpans.map((rendered) => rendered && (
          <div
            key={rendered.key}
            className="absolute top-1.5 bottom-1.5 bg-[#0284c7] hover:bg-[#38bdf8] rounded-sm opacity-95 transition-colors pointer-events-none shadow-[0_0_6px_rgba(2,132,199,0.4)]"
            style={{ left: rendered.left, width: rendered.width }}
          />
        ))}

        {/* Hover Tooltip and Hover Line in Solar Amber */}
        {hoverPosition && (
          <>
            <div
              className="absolute top-0 bottom-0 w-[1px] bg-[#fb923c] pointer-events-none"
              style={{ left: `${hoverPosition.xPercent}%` }}
            />
            <div
              className="absolute -top-8 transform -translate-x-1/2 px-2 py-0.5 bg-[#111827] border border-[#fb923c] rounded text-[11px] font-mono text-[#fb923c] font-bold pointer-events-none shadow-xl z-30"
              style={{ left: `${hoverPosition.xPercent}%` }}
            >
              {hoverPosition.timeStr}
            </div>
          </>
        )}

        {/* Playhead Indicator (Ion Blue needle with glowing pin) */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-[#4fc3f7] z-20 pointer-events-none flex flex-col items-center"
          style={{ left: `${playheadPercent}%` }}
        >
          {/* Playhead marker pin at top */}
          <div className="w-3 h-3 bg-[#4fc3f7] rotate-45 -mt-1.5 shadow-[0_0_10px_#4fc3f7]" />
          <div className="flex-1 w-[2px] bg-[#4fc3f7] shadow-[0_0_12px_#4fc3f7]" />
        </div>
      </div>

      {/* Playhead Time Badge */}
      <div className="flex justify-between items-center text-xs text-slate-400 font-mono px-1">
        <span>00:00:00</span>
        <div className="text-slate-100 font-bold flex items-center gap-2 bg-[#111827] px-3 py-1 rounded-md border border-[#1f2937]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#4fc3f7] inline-block shadow-[0_0_6px_#4fc3f7] animate-pulse" />
          <span className="text-[#4fc3f7]">SEEK TIME: {formatTimeFromOffset(currentOffsetMs)}</span>
        </div>
        <span>23:59:59</span>
      </div>
    </div>
  );
};

export default TimelineScrubber;
