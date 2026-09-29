import React, { useRef, useState, useCallback, useMemo } from 'react';
import { Video, Bookmark, Activity, Film } from 'lucide-react';
import type { TimelineSpan } from '../hooks/usePlaybackSession.js';
import type { BookmarkItem } from './TimelineScrubber.js';

export interface LaneCameraData {
  cameraId: string;
  cameraName: string;
  spans: TimelineSpan[];
  motionEvents?: Array<{ startTime: string; endTime: string; label?: string }>;
  bookmarks?: BookmarkItem[];
}

export interface MultiLaneTimelineProps {
  currentDate: string; // YYYY-MM-DD
  currentTime: Date | number; // UTC Date or timestamp ms
  lanes: LaneCameraData[]; // 1 to 4 lanes
  onSeek: (time: Date) => void;
  onAddBookmarkAtTime?: (time: Date, cameraId?: string) => void;
  className?: string;
}

export const MultiLaneTimeline: React.FC<MultiLaneTimelineProps> = ({
  currentDate,
  currentTime,
  lanes,
  onSeek,
  onAddBookmarkAtTime,
  className = '',
}) => {
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [hoverPosition, setHoverPosition] = useState<{ xPercent: number; timeStr: string } | null>(
    null
  );
  const [activeBookmarkTooltip, setActiveBookmarkTooltip] = useState<{
    bookmark: BookmarkItem;
    xPercent: number;
    cameraName: string;
  } | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Compute canonical UTC start of current date in milliseconds (PLAY-01, Canonical Time Domain)
  const getDayStartMs = useCallback((): number => {
    const parts = currentDate.split('-').map(Number);
    if (parts.length === 3) {
      return Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    }
    const d = new Date(currentDate);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  }, [currentDate]);

  const dayStartMs = getDayStartMs();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Compute playhead percentage [0, 100]
  const currentMs = typeof currentTime === 'number' ? currentTime : currentTime.getTime();
  const currentOffsetMs = Math.max(0, Math.min(DAY_MS, currentMs - dayStartMs));
  const playheadPercent = (currentOffsetMs / DAY_MS) * 100;

  // Format milliseconds offset from UTC day start into HH:MM:SS
  const formatTimeFromOffset = (offsetMs: number): string => {
    const totalSeconds = Math.floor(Math.max(0, Math.min(DAY_MS, offsetMs)) / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(
      2,
      '0'
    )}`;
  };

  const handlePointerAction = useCallback(
    (clientX: number) => {
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
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
    if (!trackAreaRef.current) return;
    const rect = trackAreaRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    const hoverMs = fraction * DAY_MS;
    setHoverPosition({
      xPercent: fraction * 100,
      timeStr: `${formatTimeFromOffset(hoverMs)} UTC`,
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
        // Ignore
      }
    }
  };

  const handlePointerLeave = () => {
    setHoverPosition(null);
    if (isDragging) {
      setIsDragging(false);
    }
  };

  // 24-hour markers every 2 hours: 00:00, 02:00, ..., 24:00
  const hourTicks = useMemo(() => Array.from({ length: 13 }, (_, i) => i * 2), []);

  // Memoize rendered spans, motion events, and bookmarks per lane
  // Prevents re-parsing ISO date strings on every 16ms animation frame
  const precomputedLanes = useMemo(() => {
    return lanes.map((lane, laneIdx) => {
      const renderedSpans = lane.spans
        .map((span, sIdx) => {
          const sStart = new Date(span.startTime).getTime();
          const sEnd = new Date(span.endTime).getTime();
          const clampedStart = Math.max(dayStartMs, sStart);
          const clampedEnd = Math.min(dayStartMs + DAY_MS, sEnd);

          if (clampedStart >= clampedEnd) return null;

          const left = ((clampedStart - dayStartMs) / DAY_MS) * 100;
          const width = Math.max(0.2, ((clampedEnd - clampedStart) / DAY_MS) * 100);

          const isMotion =
            (span as any).type === 'motion' ||
            span.recordingId?.toLowerCase().includes('motion');

          return {
            key: span.recordingId || `span-${laneIdx}-${sIdx}`,
            left: `${left}%`,
            width: `${width}%`,
            isMotion,
          };
        })
        .filter(Boolean) as Array<{ key: string; left: string; width: string; isMotion: boolean }>;

      const renderedMotionEvents = (lane.motionEvents || [])
        .map((evt, mIdx) => {
          const mStart = new Date(evt.startTime).getTime();
          const mEnd = new Date(evt.endTime).getTime();
          const clampedStart = Math.max(dayStartMs, mStart);
          const clampedEnd = Math.min(dayStartMs + DAY_MS, mEnd);

          if (clampedStart >= clampedEnd) return null;

          const left = ((clampedStart - dayStartMs) / DAY_MS) * 100;
          const width = Math.max(0.3, ((clampedEnd - clampedStart) / DAY_MS) * 100);

          return {
            key: `motion-${laneIdx}-${mIdx}`,
            left: `${left}%`,
            width: `${width}%`,
          };
        })
        .filter(Boolean) as Array<{ key: string; left: string; width: string }>;

      const renderedBookmarks = (lane.bookmarks || [])
        .map((bm) => {
          const bmTime = new Date(bm.timestamp).getTime();
          const offset = bmTime - dayStartMs;
          if (offset < 0 || offset > DAY_MS) return null;
          const percent = (offset / DAY_MS) * 100;
          return {
            bookmark: bm,
            percent,
          };
        })
        .filter(Boolean) as Array<{ bookmark: BookmarkItem; percent: number }>;

      return {
        cameraId: lane.cameraId,
        cameraName: lane.cameraName,
        renderedSpans,
        renderedMotionEvents,
        renderedBookmarks,
      };
    });
  }, [lanes, dayStartMs, DAY_MS]);

  return (
    <div className={`w-full select-none flex flex-col gap-2 font-sans ${className}`}>
      {/* Multi-Lane Container */}
      <div className="flex w-full bg-[#090d16] border border-[#1f2937] rounded-lg overflow-hidden shadow-inner">
        {/* Left Column: Camera Headers */}
        <div className="w-36 sm:w-44 shrink-0 bg-[#0d1322] border-r border-[#1f2937] flex flex-col">
          {/* Header spacer aligning with time ruler */}
          <div className="h-6 px-3 flex items-center border-b border-[#1f2937] bg-[#111827] text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span>Camera Lane</span>
          </div>

          {/* Lane Labels */}
          {precomputedLanes.length === 0 ? (
            <div className="h-10 px-3 flex items-center text-xs text-slate-500 italic">
              No cameras selected
            </div>
          ) : (
            precomputedLanes.map((lane, idx) => (
              <div
                key={lane.cameraId || `lane-${idx}`}
                className="h-9 px-3 flex items-center gap-2 border-b border-[#1f2937]/60 text-xs font-semibold text-slate-200 truncate"
                title={lane.cameraName}
              >
                <div className="w-2 h-2 rounded-full bg-[#4fc3f7] shrink-0" />
                <span className="truncate">{lane.cameraName}</span>
              </div>
            ))
          )}
        </div>

        {/* Right Column: Time Ruler and Multi-Track Lanes */}
        <div
          ref={trackAreaRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          className="flex-1 relative cursor-pointer overflow-hidden flex flex-col"
          style={{
            backgroundImage: `repeating-linear-gradient(45deg, #090d16, #090d16 10px, #0e1320 10px, #0e1320 20px)`,
          }}
        >
          {/* Top 24-Hour Time Ruler */}
          <div className="h-6 relative w-full bg-[#111827] border-b border-[#1f2937] pointer-events-none">
            {hourTicks.map((hour) => {
              const percent = (hour / 24) * 100;
              return (
                <div
                  key={`ruler-hour-${hour}`}
                  className="absolute top-0 bottom-0 transform -translate-x-1/2 flex flex-col items-center justify-between py-0.5"
                  style={{ left: `${percent}%` }}
                >
                  <span className="text-[10px] font-mono font-semibold text-slate-400">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                  <div className="w-[1px] h-1 bg-[#1f2937]" />
                </div>
              );
            })}
          </div>

          {/* Background vertical 1-hour grid lines */}
          {Array.from({ length: 24 }, (_, i) => (
            <div
              key={`grid-line-${i}`}
              className="absolute top-6 bottom-0 w-[1px] bg-[#1f2937]/50 pointer-events-none z-0"
              style={{ left: `${(i / 24) * 100}%` }}
            />
          ))}

          {/* Precomputed Camera Track Lanes */}
          {precomputedLanes.map((lane, laneIdx) => (
            <div
              key={lane.cameraId || `track-${laneIdx}`}
              className="h-9 relative w-full border-b border-[#1f2937]/50 flex items-center"
            >
              {/* Continuous recording segments: Emerald Green (#10b981) */}
              {lane.renderedSpans.map((rendered) => (
                <div
                  key={rendered.key}
                  className={`absolute top-1.5 bottom-1.5 rounded-sm pointer-events-none shadow-sm ${
                    rendered.isMotion
                      ? 'bg-[#f59e0b] shadow-[0_0_6px_rgba(245,158,11,0.5)]'
                      : 'bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.4)]'
                  }`}
                  style={{ left: rendered.left, width: rendered.width }}
                />
              ))}

              {/* Motion events overlay: Amber / Orange (#f59e0b) */}
              {lane.renderedMotionEvents.map((m) => (
                <div
                  key={m.key}
                  className="absolute top-1 bottom-1 bg-[#f59e0b] rounded-sm pointer-events-none shadow-[0_0_6px_rgba(245,158,11,0.7)] z-10"
                  style={{ left: m.left, width: m.width }}
                />
              ))}

              {/* Bookmarks overlay: Blue / Cyan (#38bdf8) */}
              {lane.renderedBookmarks.map((b) => (
                <div
                  key={b.bookmark.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSeek(new Date(b.bookmark.timestamp));
                  }}
                  onMouseEnter={() =>
                    setActiveBookmarkTooltip({
                      bookmark: b.bookmark,
                      xPercent: b.percent,
                      cameraName: lane.cameraName,
                    })
                  }
                  onMouseLeave={() => setActiveBookmarkTooltip(null)}
                  className="absolute top-0 bottom-0 w-3 -ml-1.5 z-20 flex flex-col items-center justify-start cursor-pointer group"
                  style={{ left: `${b.percent}%` }}
                >
                  <div className="w-2.5 h-3.5 rounded-b-sm bg-[#38bdf8] border border-[#0284c7] shadow-md transform group-hover:scale-125 transition-transform" />
                  <div className="w-[1px] flex-1 bg-[#38bdf8]/70" />
                </div>
              ))}
            </div>
          ))}

          {/* Unified Hover Tooltip and Hover Line across all lanes */}
          {hoverPosition && (
            <>
              <div
                className="absolute top-0 bottom-0 w-[1px] bg-[#fb923c] pointer-events-none z-25"
                style={{ left: `${hoverPosition.xPercent}%` }}
              />
              <div
                className="absolute top-1 transform -translate-x-1/2 px-2 py-0.5 bg-[#111827] border border-[#fb923c] rounded text-[11px] font-mono text-[#fb923c] font-bold pointer-events-none shadow-xl z-40"
                style={{ left: `${hoverPosition.xPercent}%` }}
              >
                {hoverPosition.timeStr}
              </div>
            </>
          )}

          {/* Unified Master Playhead Line spanning all lanes */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-[#4fc3f7] z-30 pointer-events-none flex flex-col items-center"
            style={{ left: `${playheadPercent}%` }}
          >
            <div className="w-3 h-3 bg-[#4fc3f7] rotate-45 -mt-1 shadow-[0_0_10px_#4fc3f7]" />
            <div className="flex-1 w-[2px] bg-[#4fc3f7] shadow-[0_0_12px_#4fc3f7]" />
          </div>

          {/* Active Bookmark Tooltip */}
          {activeBookmarkTooltip && (
            <div
              className="absolute top-2 transform -translate-x-1/2 px-2.5 py-1 bg-[#111827] border border-[#38bdf8] rounded-lg text-xs shadow-2xl z-40 pointer-events-none font-sans min-w-[140px]"
              style={{ left: `${activeBookmarkTooltip.xPercent}%` }}
            >
              <div className="font-semibold text-slate-100 truncate">
                {activeBookmarkTooltip.bookmark.title}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono mt-0.5">
                <span className="text-[#38bdf8] font-bold">
                  {activeBookmarkTooltip.cameraName}
                </span>
                <span>•</span>
                <span>
                  {new Date(activeBookmarkTooltip.bookmark.timestamp).toISOString().substring(11, 19)} UTC
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline Footer: Legend & Master Time Readout */}
      <div className="flex flex-wrap justify-between items-center text-xs text-slate-400 font-mono px-1 gap-2">
        {/* Color Legend */}
        <div className="flex items-center gap-4 text-[11px] font-sans">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-[#10b981] inline-block shadow-[0_0_4px_#10b981]" />
            <span className="text-slate-300 font-medium">Continuous Recording</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-[#f59e0b] inline-block shadow-[0_0_4px_#f59e0b]" />
            <span className="text-slate-300 font-medium">Motion Events</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-[#38bdf8] inline-block shadow-[0_0_4px_#38bdf8]" />
            <span className="text-slate-300 font-medium">Bookmarks / Incidents</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-[#090d16] border border-[#1f2937] inline-block" />
            <span className="text-slate-500">Gap (No Footage)</span>
          </div>
        </div>

        {/* Master Playhead Readout */}
        <div className="text-slate-100 font-bold flex items-center gap-2 bg-[#111827] px-3 py-1 rounded-md border border-[#1f2937]">
          <span className="w-2 h-2 rounded-full bg-[#4fc3f7] inline-block shadow-[0_0_6px_#4fc3f7] animate-pulse" />
          <span className="text-[#4fc3f7]">
            MASTER PLAYHEAD: {formatTimeFromOffset(currentOffsetMs)} UTC
          </span>
        </div>
      </div>
    </div>
  );
};

export default MultiLaneTimeline;
