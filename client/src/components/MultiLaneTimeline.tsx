import React, { useRef, useState, useCallback, useMemo } from 'react';
import { Video, Bookmark, Activity, Film } from 'lucide-react';
import type { TimelineSpan } from '../hooks/usePlaybackSession.js';
import type { BookmarkItem } from './TimelineScrubber.js';

export interface LaneCameraData {
  cameraId: string;
  cameraName: string;
  /** Site the camera belongs to; consecutive lanes with the same group share a header */
  group?: string;
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

  // A header row precedes the first lane of each site group (only when lanes are grouped)
  const startsGroup = (idx: number) =>
    Boolean(lanes[idx]?.group) && (idx === 0 || lanes[idx - 1]?.group !== lanes[idx].group);

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
        group: lane.group,
        renderedSpans,
        renderedMotionEvents,
        renderedBookmarks,
      };
    });
  }, [lanes, dayStartMs, DAY_MS]);

  return (
    <div className={`w-full select-none flex flex-col gap-2 font-sans ${className}`}>
      {/* Multi-Lane Container */}
      <div className="flex w-full bg-[#090a0f] border border-white/[0.08] rounded-xl overflow-hidden shadow-2xl">
        {/* Left Column: Camera Headers */}
        <div className="w-36 sm:w-44 shrink-0 bg-[#111318] border-r border-white/[0.08] flex flex-col">
          {/* Header spacer aligning with time ruler */}
          <div className="h-6 px-3 flex items-center border-b border-white/[0.08] bg-[#0c0e14] text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            <span>Camera Lane</span>
          </div>

          {/* Lane Labels */}
          {precomputedLanes.length === 0 ? (
            <div className="h-10 px-3 flex items-center text-xs text-zinc-500 italic">
              No cameras selected
            </div>
          ) : (
            precomputedLanes.map((lane, idx) => (
              <React.Fragment key={lane.cameraId || `lane-${idx}`}>
                {startsGroup(idx) && (
                  <div
                    className="h-6 px-3 flex items-center border-b border-white/[0.06] bg-white/[0.03] text-[10px] font-semibold uppercase tracking-wider text-zinc-400 truncate"
                    title={lane.group}
                  >
                    {lane.group}
                  </div>
                )}
                <div
                  className="h-9 px-3 flex items-center gap-2 border-b border-white/5 text-xs font-medium text-zinc-300 truncate"
                  title={lane.cameraName}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                  <span className="truncate">{lane.cameraName}</span>
                </div>
              </React.Fragment>
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
            backgroundImage: `repeating-linear-gradient(45deg, #090a0f, #090a0f 10px, #0f1219 10px, #0f1219 20px)`,
          }}
        >
          {/* Top 24-Hour Time Ruler */}
          <div className="h-6 relative w-full bg-[#0c0e14] border-b border-white/[0.08] pointer-events-none">
            {hourTicks.map((hour) => {
              const percent = (hour / 24) * 100;
              return (
                <div
                  key={`ruler-hour-${hour}`}
                  className="absolute top-0 bottom-0 transform -translate-x-1/2 flex flex-col items-center justify-between py-0.5"
                  style={{ left: `${percent}%` }}
                >
                  <span className="text-[10px] font-mono font-medium text-zinc-400">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                  <div className="w-[1px] h-1 bg-white/10" />
                </div>
              );
            })}
          </div>

          {/* Background vertical 1-hour grid lines */}
          {Array.from({ length: 24 }, (_, i) => (
            <div
              key={`grid-line-${i}`}
              className="absolute top-6 bottom-0 w-[1px] bg-white/[0.04] pointer-events-none z-0"
              style={{ left: `${(i / 24) * 100}%` }}
            />
          ))}

          {/* Precomputed Camera Track Lanes */}
          {precomputedLanes.map((lane, laneIdx) => (
            <React.Fragment key={lane.cameraId || `track-${laneIdx}`}>
            {/* Site header row, aligned with the label column */}
            {startsGroup(laneIdx) && <div className="h-6 w-full border-b border-white/[0.06] bg-[#0c0e14]/80" />}
            <div className="h-9 relative w-full border-b border-white/5 flex items-center">
              {/* Continuous recording segments: Emerald Green */}
              {lane.renderedSpans.map((rendered) => (
                <div
                  key={rendered.key}
                  className={`absolute top-1.5 bottom-1.5 rounded-sm pointer-events-none shadow-sm ${
                    rendered.isMotion
                      ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]'
                      : 'bg-emerald-500/80 shadow-[0_0_6px_rgba(16,185,129,0.4)]'
                  }`}
                  style={{ left: rendered.left, width: rendered.width }}
                />
              ))}

              {/* Motion events overlay: Amber */}
              {lane.renderedMotionEvents.map((m) => (
                <div
                  key={m.key}
                  className="absolute top-1 bottom-1 bg-amber-400 rounded-sm pointer-events-none shadow-[0_0_6px_rgba(251,191,36,0.7)] z-10"
                  style={{ left: m.left, width: m.width }}
                />
              ))}

              {/* Bookmarks overlay: Cyan */}
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
                  <div className="w-2.5 h-3.5 rounded-b-sm bg-cyan-400 border border-cyan-300 shadow-md transform group-hover:scale-125 transition-transform" />
                  <div className="w-[1px] flex-1 bg-cyan-400/70" />
                </div>
              ))}
            </div>
            </React.Fragment>
          ))}

          {/* Unified Hover Tooltip and Hover Line across all lanes */}
          {hoverPosition && (
            <>
              <div
                className="absolute top-0 bottom-0 w-[1px] bg-amber-400 pointer-events-none z-25"
                style={{ left: `${hoverPosition.xPercent}%` }}
              />
              <div
                className="absolute top-1 transform -translate-x-1/2 px-2 py-0.5 hud-chip border-amber-400/50 rounded text-[10px] font-mono text-amber-300 font-medium pointer-events-none shadow-xl z-40"
                style={{ left: `${hoverPosition.xPercent}%` }}
              >
                {hoverPosition.timeStr}
              </div>
            </>
          )}

          {/* Unified Master Playhead Line spanning all lanes */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-emerald-400 z-30 pointer-events-none flex flex-col items-center"
            style={{ left: `${playheadPercent}%` }}
          >
            <div className="w-2.5 h-2.5 bg-emerald-400 rotate-45 -mt-1 shadow-[0_0_10px_#10b981]" />
            <div className="flex-1 w-[2px] bg-emerald-400 shadow-[0_0_12px_#10b981]" />
          </div>

          {/* Active Bookmark Tooltip */}
          {activeBookmarkTooltip && (
            <div
              className="absolute top-2 transform -translate-x-1/2 px-2.5 py-1 alert-glass border border-cyan-500/40 rounded-lg text-xs shadow-2xl z-40 pointer-events-none font-sans min-w-[140px]"
              style={{ left: `${activeBookmarkTooltip.xPercent}%` }}
            >
              <div className="font-medium text-zinc-100 truncate">
                {activeBookmarkTooltip.bookmark.title}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono mt-0.5">
                <span className="text-cyan-400 font-semibold">
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
      <div className="flex flex-wrap justify-between items-center text-xs text-zinc-400 font-mono px-1 gap-2">
        {/* Color Legend */}
        <div className="flex items-center gap-4 text-[11px] font-sans">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2 rounded-sm bg-emerald-500 inline-block shadow-[0_0_4px_#10b981]" />
            <span className="text-zinc-300 font-medium">Continuous</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2 rounded-sm bg-amber-400 inline-block shadow-[0_0_4px_#f59e0b]" />
            <span className="text-zinc-300 font-medium">Motion Events</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2 rounded-sm bg-cyan-400 inline-block shadow-[0_0_4px_#06b6d4]" />
            <span className="text-zinc-300 font-medium">Bookmarks</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2 rounded-sm bg-zinc-900 border border-white/10 inline-block" />
            <span className="text-zinc-500">Gap (No Footage)</span>
          </div>
        </div>

        {/* Master Playhead Readout */}
        <div className="text-zinc-200 font-medium flex items-center gap-2 hud-chip px-3 py-1 rounded-lg text-xs tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shadow-[0_0_6px_#10b981] animate-pulse" />
          <span className="text-emerald-400 font-mono font-semibold">
            PLAYHEAD: {formatTimeFromOffset(currentOffsetMs)} UTC
          </span>
        </div>
      </div>
    </div>
  );
};

export default MultiLaneTimeline;
