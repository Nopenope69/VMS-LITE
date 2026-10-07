import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield,
  Video,
  Calendar,
  Radio,
  AlertCircle,
  RefreshCw,
  Film,
  History,
  Clock,
  Bookmark,
  Loader2,
  X,
  ChevronDown,
  Check,
  Layers,
  Keyboard,
} from 'lucide-react';
import { BookmarkItem } from '../components/TimelineScrubber.js';
import { MultiLaneTimeline, LaneCameraData } from '../components/MultiLaneTimeline.js';
import { PlaybackControls } from '../components/PlaybackControls.js';
import { ClipExportModal } from '../components/ClipExportModal.js';
import { BookmarkModal } from '../components/BookmarkModal.js';
import { useCctvHotkeys } from '../hooks/useCctvHotkeys.js';
import { FloatingHudBadge } from '../components/FloatingHudBadge.js';
import { KeyboardShortcutsModal } from '../components/KeyboardShortcutsModal.js';
import {
  getTodayString,
  CameraOption,
  TimelineSpan,
} from '../hooks/usePlaybackSession.js';
import { useAuth } from '../context/AuthContext.js';
import { ALL_SITES, matchesSiteFilter } from '../types/sites.js';
import { orderLanesBySite } from '../utils/site-lanes.js';
import { OperatorBanner } from '../components/OperatorBanner.js';
import {
  PlaybackSyncProvider,
  usePlaybackSync,
  calculatePlayerAlignment,
} from '../context/PlaybackSyncContext.js';
import { apiFetch } from '../api/client.js';

export type { CameraOption };

export interface PlaybackPageProps {
  apiBaseUrl?: string;
  authToken?: string;
  /** Camera to open first (e.g. "View recordings" from the camera view). */
  initialCameraId?: string;
  /** Moment to open at (UTC ms), e.g. from an alert e-mail link */
  initialTimestampMs?: number;
  /** Global site filter: only that site's cameras are offered */
  siteFilter?: string;
  /** Known sites, for grouping timeline lanes and the camera picker */
  sites?: Array<{ id: string | null; name: string }>;
  onNavigateLive?: () => void;
}

interface SynchronizedCameraTileProps {
  camera: CameraOption;
  spans: TimelineSpan[];
  targetTimestampMs: number;
  isPlaying: boolean;
  playbackRate: number;
  isStallLocked: boolean;
  apiBaseUrl: string;
  authToken: string;
  onBuffering: (cameraId: string, isBuffering: boolean) => void;
  onTimeUpdate: (cameraId: string, currentTimeSec: number, segmentStartMs: number) => void;
  isPrimary: boolean;
}

/**
 * Individual synchronized playback tile for a camera.
 * Displays "No Recording" gap card if footage is absent at the playhead,
 * otherwise renders the fMP4 stream synchronized to the master clock using
 * gentle rate convergence for minor drift and hard seeking only for major drift.
 */
const SynchronizedCameraTile: React.FC<SynchronizedCameraTileProps> = ({
  camera,
  spans,
  targetTimestampMs,
  isPlaying,
  playbackRate,
  isStallLocked,
  apiBaseUrl,
  authToken,
  onBuffering,
  onTimeUpdate,
  isPrimary,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamStartTimeMs, setStreamStartTimeMs] = useState<number | null>(null);
  const [isBufferingLocal, setIsBufferingLocal] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const activeStreamRef = useRef<{ url: string; startTimeMs: number; durationSec: number } | null>(
    null
  );
  const loadedSpanIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef<boolean>(false);
  const fetchSeqRef = useRef<number>(0);
  const lastHardSeekTimeRef = useRef<number>(0);

  // Check if camera has recording footage at target timestamp
  const currentSpan = useMemo(() => {
    return spans.find((s) => {
      const startMs = new Date(s.startTime).getTime();
      const endMs = new Date(s.endTime).getTime();
      return targetTimestampMs >= startMs && targetTimestampMs <= endMs;
    });
  }, [spans, targetTimestampMs]);

  const currentSpanId = currentSpan
    ? currentSpan.recordingId || `${currentSpan.startTime}_${currentSpan.endTime}`
    : null;

  const hasFootage = Boolean(currentSpan);

  // Fetch fMP4 stream URL from MediaMTX anchored to span transitions / chunk boundaries
  // (Prevents in-flight abort race condition on 16ms animation frame ticks)
  useEffect(() => {
    if (!hasFootage || !currentSpanId) {
      setStreamUrl(null);
      setStreamStartTimeMs(null);
      setStreamError(null);
      activeStreamRef.current = null;
      loadedSpanIdRef.current = null;
      onBuffering(camera.id, false);
      return;
    }

    // Check if currently active stream already covers targetTimestampMs within current span
    const active = activeStreamRef.current;
    if (
      active &&
      loadedSpanIdRef.current === currentSpanId &&
      targetTimestampMs >= active.startTimeMs &&
      targetTimestampMs <= active.startTimeMs + active.durationSec * 1000
    ) {
      return;
    }

    // New stream fetch needed
    const thisFetchSeq = ++fetchSeqRef.current;
    isFetchingRef.current = true;
    setIsBufferingLocal(true);
    onBuffering(camera.id, true);
    setStreamError(null);

    const fetchStream = async () => {
      try {
        const isoTimestamp = new Date(targetTimestampMs).toISOString();
        const headers: Record<string, string> = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

        const res = await apiFetch(
          `${apiBaseUrl}/api/playback/stream?cameraId=${encodeURIComponent(
            camera.id
          )}&startTime=${encodeURIComponent(isoTimestamp)}&duration=300`,
          { headers }
        );

        if (!res.ok) {
          throw new Error(`Failed to load stream: HTTP ${res.status}`);
        }

        const data = await res.json();
        // Ignore response if superseded by a newer seek request
        if (fetchSeqRef.current === thisFetchSeq) {
          activeStreamRef.current = {
            url: data.fmp4StreamUrl,
            startTimeMs: targetTimestampMs,
            durationSec: 300,
          };
          loadedSpanIdRef.current = currentSpanId;
          setStreamUrl(data.fmp4StreamUrl);
          setStreamStartTimeMs(targetTimestampMs);
          isFetchingRef.current = false;
        }
      } catch (err: any) {
        if (fetchSeqRef.current === thisFetchSeq) {
          setStreamError(err.message || 'Stream retrieval failed');
          setIsBufferingLocal(false);
          onBuffering(camera.id, false);
          isFetchingRef.current = false;
        }
      }
    };

    fetchStream();
  }, [hasFootage, currentSpanId, targetTimestampMs, camera.id, apiBaseUrl, authToken, onBuffering]);

  // Synchronize play/pause and stall lock
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (isPlaying && !isStallLocked) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Play interrupted or autoplay policy
        });
      }
    } else {
      video.pause();
    }
  }, [isPlaying, isStallLocked, streamUrl]);

  // Check and enforce player time alignment with rate convergence
  // (Prevents GOP seek keyframe thrashing / continuous stuttering loops)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl || streamStartTimeMs === null) return;

    const alignment = calculatePlayerAlignment({
      segmentStartMs: streamStartTimeMs,
      currentTimeSec: video.currentTime,
      targetTimestampMs,
      toleranceMs: 200,
    });

    const now = Date.now();

    // 1. Large drift (> 1000ms): Hard seek with cooldown to align with user jump or stall recovery
    if (alignment.skewMs > 1000) {
      if (now - lastHardSeekTimeRef.current > 600) {
        lastHardSeekTimeRef.current = now;
        video.currentTime = alignment.suggestedSeekSec;
        video.playbackRate = playbackRate;
      }
      return;
    }

    // 2. Minor drift (200ms - 1000ms): Smooth rate convergence without seek freezing
    if (alignment.skewMs > 200) {
      const playerIsBehind = alignment.playerAbsoluteMs < targetTimestampMs;
      if (playerIsBehind) {
        // Slightly speed up to catch up
        video.playbackRate = playbackRate * 1.05;
      } else {
        // Slightly slow down to let master clock catch up
        video.playbackRate = Math.max(0.25, playbackRate * 0.95);
      }
      return;
    }

    // 3. In sync (skew <= 200ms): Restore nominal playback rate
    if (video.playbackRate !== playbackRate) {
      video.playbackRate = playbackRate;
    }
  }, [targetTimestampMs, streamUrl, streamStartTimeMs, playbackRate]);

  // Cleanup buffering state on unmount
  useEffect(() => {
    return () => {
      onBuffering(camera.id, false);
    };
  }, [camera.id, onBuffering]);

  const handleWaiting = () => {
    setIsBufferingLocal(true);
    onBuffering(camera.id, true);
  };

  const handleCanPlay = () => {
    setIsBufferingLocal(false);
    onBuffering(camera.id, false);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current && streamStartTimeMs !== null) {
      onTimeUpdate(camera.id, videoRef.current.currentTime, streamStartTimeMs);
    }
  };

  // If no recording at playhead, render explicit Gap Card
  if (!hasFootage) {
    return (
      <div className="relative w-full h-full bg-[#090a0f] flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden">
        {/* Subtle diagonal gap pattern */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(45deg, #090a0f, #090a0f 12px, #111318 12px, #111318 24px)`,
          }}
        />

        {/* Camera Header Badge */}
        <div className="absolute top-3 left-3 hud-chip px-2.5 py-1 rounded-md text-xs font-medium text-zinc-300 flex items-center gap-2 z-10">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
          <span className="truncate max-w-[140px] text-zinc-200">{camera.name}</span>
          {isPrimary && (
            <span className="text-[10px] text-emerald-400 font-mono font-semibold uppercase tracking-wider">
              Primary
            </span>
          )}
        </div>

        {/* Center Gap Notice */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-12 h-12 rounded-xl hud-chip flex items-center justify-center mb-3">
            <Film className="w-6 h-6 text-zinc-500" />
          </div>
          <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">No Recording</h3>
          <p className="text-[11px] text-zinc-400 mt-1 max-w-xs font-sans">
            No footage captured for {camera.name} at{' '}
            <span className="font-mono text-zinc-300 tabular-nums">
              {new Date(targetTimestampMs).toISOString().substring(11, 19)} UTC
            </span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      {streamUrl ? (
        <video
          ref={videoRef}
          src={streamUrl}
          playsInline
          autoPlay={isPlaying && !isStallLocked}
          onWaiting={handleWaiting}
          onCanPlay={handleCanPlay}
          onPlaying={handleCanPlay}
          onTimeUpdate={handleTimeUpdate}
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-zinc-400 gap-2">
          <Loader2 className="w-7 h-7 text-emerald-400 animate-spin" />
          <span className="text-xs font-medium">Resolving stream...</span>
        </div>
      )}

      {/* Local Buffering Spinner */}
      {isBufferingLocal && (
        <div className="absolute inset-0 bg-[#090a0f]/60 backdrop-blur-sm flex items-center justify-center pointer-events-none z-10">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
        </div>
      )}

      {/* Camera Header Badge */}
      <div className="absolute top-3 left-3 hud-chip px-2.5 py-1 rounded-md text-xs font-medium text-zinc-100 flex items-center gap-2 shadow-lg z-10">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] animate-pulse" />
        <span className="truncate max-w-[140px]">{camera.name}</span>
        {isPrimary && (
          <span className="text-[10px] text-emerald-400 font-mono font-semibold uppercase tracking-wider">
            Primary
          </span>
        )}
      </div>

      {/* Error Overlay */}
      {streamError && (
        <div className="absolute inset-0 bg-[#090a0f]/90 flex flex-col items-center justify-center p-4 text-center border border-rose-500/30 z-20">
          <AlertCircle className="w-7 h-7 text-amber-400 mb-2" />
          <p className="text-xs font-semibold text-zinc-200">{streamError}</p>
        </div>
      )}
    </div>
  );
};

const PlaybackPageContent: React.FC<PlaybackPageProps> = ({
  apiBaseUrl = '',
  authToken = '',
  initialCameraId,
  initialTimestampMs,
  siteFilter = ALL_SITES,
  sites = [],
  onNavigateLive,
}) => {
  const { token: authContextToken, can } = useAuth();
  const effectiveToken = authToken || authContextToken || '';

  const {
    targetTimestampMs,
    isPlaying,
    playbackRate,
    isBuffering,
    selectedCameraIds,
    decodeBudgetWarning,
    seekToTimestamp,
    setIsPlaying,
    setPlaybackRate,
    setSelectedCameraIds,
    toggleCameraSelection,
    clearDecodeBudgetWarning,
    reportBuffering,
    reportPlayerTime,
  } = usePlaybackSync();

  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    getTodayString(initialTimestampMs !== undefined ? new Date(initialTimestampMs) : new Date())
  );

  // Open at the requested moment once (deep link from an alert)
  const appliedInitialTimestamp = useRef(false);
  useEffect(() => {
    if (appliedInitialTimestamp.current || initialTimestampMs === undefined) return;
    appliedInitialTimestamp.current = true;
    seekToTimestamp(initialTimestampMs);
  }, [initialTimestampMs, seekToTimestamp]);
  const [primaryCameraId, setPrimaryCameraId] = useState<string>('');
  const [timelines, setTimelines] = useState<Record<string, TimelineSpan[]>>({});
  const [bookmarks, setBookmarks] = useState<Record<string, BookmarkItem[]>>({});
  const [isLoadingTimeline, setIsLoadingTimeline] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [isCameraDropdownOpen, setIsCameraDropdownOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState<boolean>(false);

  const hasInitializedCamerasRef = useRef<boolean>(false);

  const todayStr = getTodayString();
  const yesterdayStr = getTodayString(new Date(Date.now() - 86400000));
  const dayBeforeStr = getTodayString(new Date(Date.now() - 2 * 86400000));

  // Determine export permissions
  const canExport = Boolean(primaryCameraId) && can(primaryCameraId, 'canExportClips');

  const selectedCameraIdsRef = useRef<string[]>(selectedCameraIds);
  selectedCameraIdsRef.current = selectedCameraIds;

  // Fetch camera roster on mount and when the site filter changes (not on selection changes)
  useEffect(() => {
    let isCancelled = false;
    const fetchCameras = async () => {
      try {
        const headers: Record<string, string> = {};
        if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;

        let res = await apiFetch(`${apiBaseUrl}/api/cameras`, { headers });
        if (!res.ok) {
          res = await apiFetch(`${apiBaseUrl}/api/streaming/config`, { headers });
        }
        if (!res.ok) {
          throw new Error(`Failed to load camera list: HTTP ${res.status}`);
        }

        const data = await res.json();
        const raw: any[] = Array.isArray(data) ? data : data.cameras || [];
        const list: CameraOption[] = raw
          .filter((c: any) => matchesSiteFilter(c.siteId, siteFilter))
          .map((c: any) => ({ id: c.id, name: c.name, mediaMtxPath: c.mediaMtxPath, siteId: c.siteId ?? null }));

        if (!isCancelled) {
          setCameras(list);
          // Changing site drops selections that are no longer offered
          if (hasInitializedCamerasRef.current) {
            const ids = new Set(list.map((c) => c.id));
            const kept = selectedCameraIdsRef.current.filter((id) => ids.has(id));
            setSelectedCameraIds(kept.length > 0 ? kept : list.slice(0, 1).map((c) => c.id));
          }
          if (list.length > 0 && !hasInitializedCamerasRef.current) {
            hasInitializedCamerasRef.current = true;
            const first = list.find((c) => c.id === initialCameraId) ?? list[0];
            setSelectedCameraIds([first.id]);
            setPrimaryCameraId(first.id);
          }
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.warn('Error loading camera roster:', err);
        }
      }
    };

    fetchCameras();
    return () => {
      isCancelled = true;
    };
  }, [apiBaseUrl, effectiveToken, setSelectedCameraIds, initialCameraId, siteFilter]);

  // Keep primaryCameraId valid when selected cameras change
  useEffect(() => {
    if (selectedCameraIds.length > 0 && !selectedCameraIds.includes(primaryCameraId)) {
      setPrimaryCameraId(selectedCameraIds[0]);
    }
  }, [selectedCameraIds, primaryCameraId]);

  // Fetch timelines and bookmarks for all selected cameras
  const fetchAllTimelinesAndBookmarks = useCallback(async () => {
    if (selectedCameraIds.length === 0) return;
    setIsLoadingTimeline(true);
    setPageError(null);

    const headers: Record<string, string> = {};
    if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;

    const dayStart = `${selectedDate}T00:00:00.000Z`;
    const dayEnd = `${selectedDate}T23:59:59.999Z`;

    try {
      const timelinePromises = selectedCameraIds.map(async (camId) => {
        try {
          const res = await apiFetch(
            `${apiBaseUrl}/api/playback/timeline?cameraId=${encodeURIComponent(
              camId
            )}&date=${encodeURIComponent(selectedDate)}`,
            { headers }
          );
          if (res.ok) {
            const data = await res.json();
            return {
              camId,
              spans: (data.spans || []).map((s: any) => ({
                startTime: s.startTime,
                endTime: s.endTime,
                durationSeconds: s.durationSeconds,
                recordingId: s.recordingId,
              })),
            };
          }
        } catch {
          // Ignore individual camera errors
        }
        return { camId, spans: [] };
      });

      const bookmarkPromises = selectedCameraIds.map(async (camId) => {
        try {
          const res = await apiFetch(
            `${apiBaseUrl}/api/cameras/${encodeURIComponent(
              camId
            )}/bookmarks?from=${encodeURIComponent(dayStart)}&to=${encodeURIComponent(dayEnd)}`,
            { headers }
          );
          if (res.ok) {
            const data = await res.json();
            return { camId, bookmarks: data.bookmarks || [] };
          }
        } catch {
          // Ignore
        }
        return { camId, bookmarks: [] };
      });

      const [timelineResults, bookmarkResults] = await Promise.all([
        Promise.all(timelinePromises),
        Promise.all(bookmarkPromises),
      ]);

      const newTimelines: Record<string, TimelineSpan[]> = {};
      timelineResults.forEach((r) => {
        newTimelines[r.camId] = r.spans;
      });

      const newBookmarks: Record<string, BookmarkItem[]> = {};
      bookmarkResults.forEach((r) => {
        newBookmarks[r.camId] = r.bookmarks;
      });

      setTimelines(newTimelines);
      setBookmarks(newBookmarks);
    } catch (err: any) {
      setPageError(err.message || 'Failed to retrieve timeline records');
    } finally {
      setIsLoadingTimeline(false);
    }
  }, [selectedCameraIds, selectedDate, effectiveToken, apiBaseUrl]);

  useEffect(() => {
    fetchAllTimelinesAndBookmarks();
  }, [fetchAllTimelinesAndBookmarks]);

  // Two-Context CCTV Keyboard Hotkeys Engine integration for Playback mode
  const currentShuttleSpeed = useMemo(() => {
    if (!isPlaying) return 0;
    return playbackRate;
  }, [isPlaying, playbackRate]);

  const {
    isShortcutsOpen,
    setIsShortcutsOpen,
    hudBadgeText,
    triggerHud,
  } = useCctvHotkeys({
    mode: 'PLAYBACK',
    currentShuttleSpeed,
    onTogglePlayPause: () => {
      setIsPlaying((prev) => {
        const next = !prev;
        triggerHud(next ? '[ Playing ]' : '[ Paused ]');
        return next;
      });
    },
    onShuttleChange: (newSpeed) => {
      if (newSpeed === 0) {
        setIsPlaying(false);
      } else {
        setPlaybackRate(newSpeed);
        setIsPlaying(true);
      }
    },
    onSeekRelativeMs: (deltaMs) => {
      seekToTimestamp(targetTimestampMs + deltaMs);
    },
    onStepFrame: (dir) => {
      const frameDeltaMs = Math.round((1000 / 30) * dir);
      seekToTimestamp(targetTimestampMs + frameDeltaMs);
    },
    onFocusPlaybackSlot: (slotNum) => {
      const idx = slotNum - 1;
      if (selectedCameraIds[idx]) {
        setPrimaryCameraId(selectedCameraIds[idx]);
      }
    },
    onAddBookmark: () => {
      setIsBookmarkModalOpen(true);
    },
    onToggleShortcutsModal: () => {
      setIsShortcutsOpen((prev) => !prev);
    },
  });

  // Quick incident jump helper (-5m, -15m, -1h) - preserves user play/pause state
  const handleQuickJump = (minutesAgo: number) => {
    const target = new Date(Date.now() - minutesAgo * 60 * 1000);
    const targetDateStr = getTodayString(target);
    if (targetDateStr !== selectedDate) {
      setSelectedDate(targetDateStr);
    }
    seekToTimestamp(target.getTime());
  };

  // Jump to yesterday at same time - preserves user play/pause state
  const handleJumpYesterdaySameTime = () => {
    const targetMs = targetTimestampMs - 24 * 60 * 60 * 1000;
    setSelectedDate(yesterdayStr);
    seekToTimestamp(targetMs);
  };

  // Timeline seek handler - preserves user play/pause state
  const handleSeek = (seekTime: Date) => {
    seekToTimestamp(seekTime.getTime());
  };

  // Step -5s / +5s handler
  const handleStep = (seconds: number) => {
    seekToTimestamp(targetTimestampMs + seconds * 1000);
  };

  // Toggle play/pause
  const handleTogglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  // Canonical UTC Date selection handler (PLAY-01, Canonical Time Domain)
  const handleDateChange = (newDateStr: string) => {
    setSelectedDate(newDateStr);
    const parts = newDateStr.split('-').map(Number);
    if (parts.length === 3) {
      const utcMs = Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      seekToTimestamp(utcMs);
    }
  };

  // Prepare lanes data for MultiLaneTimeline
  // Site name and order per site id (unassigned cameras sort last)
  const siteIndex = useMemo(() => {
    const index = new Map<string | null, { name: string; order: number }>();
    sites.forEach((site, order) => index.set(site.id, { name: site.name, order }));
    if (!index.has(null)) index.set(null, { name: 'Unassigned', order: sites.length });
    return index;
  }, [sites]);
  const groupBySite = sites.some((site) => site.id !== null);

  // Lanes are ordered by site and carry the site name as their group header
  const timelineLanes: LaneCameraData[] = useMemo(
    () =>
      orderLanesBySite(
        selectedCameraIds.map((camId) => {
          const cam = cameras.find((c) => c.id === camId);
          return {
            cameraId: camId,
            cameraName: cam?.name || `Camera ${camId}`,
            spans: timelines[camId] || [],
            bookmarks: bookmarks[camId] || [],
          };
        }),
        (camId) => cameras.find((c) => c.id === camId)?.siteId,
        sites
      ),
    [selectedCameraIds, cameras, timelines, bookmarks, sites]
  );

  // Camera picker groups: [site name, cameras] in site order
  const cameraGroups = useMemo(() => {
    if (!groupBySite) return [{ siteId: undefined as string | null | undefined, name: '', cameras }];
    const groups = new Map<string | null, CameraOption[]>();
    for (const cam of cameras) {
      const key = cam.siteId ?? null;
      groups.set(key, [...(groups.get(key) ?? []), cam]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (siteIndex.get(a)?.order ?? 1e9) - (siteIndex.get(b)?.order ?? 1e9))
      .map(([siteId, list]) => ({ siteId, name: siteIndex.get(siteId)?.name ?? 'Unassigned', cameras: list }));
  }, [cameras, groupBySite, siteIndex]);

  // Selecting a site loads its cameras into the playback matrix (up to the 4-camera budget)
  const selectSiteCameras = useCallback(
    (list: CameraOption[]) => {
      const ids = list.slice(0, 4).map((c) => c.id);
      if (ids.length > 0) setSelectedCameraIds(ids);
    },
    [setSelectedCameraIds]
  );

  // Determine grid matrix layout based on active camera count (1 to 4)
  const gridClasses = useMemo(() => {
    const count = selectedCameraIds.length;
    if (count <= 1) return 'grid-cols-1 grid-rows-1';
    if (count === 2) return 'grid-cols-1 md:grid-cols-2 grid-rows-1';
    if (count === 3) return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 grid-rows-1';
    return 'grid-cols-2 grid-rows-2';
  }, [selectedCameraIds.length]);

  const primaryCamera = useMemo(
    () => cameras.find((c) => c.id === primaryCameraId) || cameras[0],
    [cameras, primaryCameraId]
  );

  return (
    <div className="flex flex-col w-full h-full flex-1 bg-[#090a0f] text-zinc-100 overflow-hidden font-sans">
      {/* Operator Shift Mode Banner */}
      <OperatorBanner />

      {/* Top Application Header / Controls Bar */}
      <header className="flex items-center justify-between px-4 py-2 glass-bar border-b border-white/[0.08] shrink-0 z-30">
        <div className="flex items-center gap-3">
          {/* Multi-Camera Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsCameraDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 hud-chip px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 text-xs font-medium text-zinc-200 transition-colors"
            >
              <Video className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Cameras ({selectedCameraIds.length}/4)
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 ml-0.5" />
            </button>

            {isCameraDropdownOpen && (
              <div className="absolute top-full mt-1.5 left-0 w-64 alert-glass border border-white/10 rounded-xl shadow-2xl p-2 z-50">
                <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-white/5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  <span>Playback Matrix</span>
                  <span
                    className={
                      selectedCameraIds.length >= 4 ? 'text-amber-400 font-bold' : 'text-zinc-500'
                    }
                  >
                    {selectedCameraIds.length} / 4 Max
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto flex flex-col gap-1 py-1">
                  {cameras.length === 0 ? (
                    <div className="text-xs text-zinc-500 italic p-2 text-center">
                      No cameras configured
                    </div>
                  ) : (
                    cameraGroups.map((group) => (
                    <React.Fragment key={group.siteId ?? 'none'}>
                    {groupBySite && (
                      <button
                        type="button"
                        onClick={() => selectSiteCameras(group.cameras)}
                        title={`Show ${Math.min(group.cameras.length, 4)} camera(s) from ${group.name}`}
                        className="w-full flex items-center justify-between px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-emerald-300"
                      >
                        <span className="truncate">{group.name}</span>
                        <span className="normal-case tracking-normal font-normal">select site</span>
                      </button>
                    )}
                    {group.cameras.map((c) => {
                      const isSelected = selectedCameraIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCameraSelection(c.id)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                            isSelected
                              ? 'bg-emerald-500/15 text-emerald-300 font-medium'
                              : 'text-zinc-300 hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="truncate">{c.name}</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        </button>
                      );
                    })}
                    </React.Fragment>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

          {/* Quick Date Shortcuts */}
          <div className="hidden md:flex items-center bg-zinc-950/60 p-0.5 rounded-lg border border-white/[0.07] text-xs">
            <button
              type="button"
              onClick={() => handleDateChange(todayStr)}
              className={`px-2.5 py-1 rounded-md transition-all text-xs font-medium ${
                selectedDate === todayStr
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handleDateChange(yesterdayStr)}
              className={`px-2.5 py-1 rounded-md transition-all text-xs font-medium ${
                selectedDate === yesterdayStr
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => handleDateChange(dayBeforeStr)}
              className={`px-2.5 py-1 rounded-md transition-all text-xs font-medium ${
                selectedDate === dayBeforeStr
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              2 Days Ago
            </button>
          </div>

          {/* Custom Date Input */}
          <div className="flex items-center gap-1.5 hud-chip px-2.5 py-1.5 rounded-lg text-xs">
            <Calendar className="w-3.5 h-3.5 text-zinc-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer text-xs font-medium"
            />
          </div>
        </div>

        {/* Right Tools: Hotkeys, Refresh & Return to Live */}
        <div className="flex items-center gap-2">
          {/* Keyboard Shortcuts Cheat Sheet Button */}
          <button
            type="button"
            onClick={() => setIsShortcutsOpen(true)}
            title="Keyboard Shortcuts & Jog-Shuttle (?)"
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hud-chip hover:bg-zinc-800 transition-colors"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchAllTimelinesAndBookmarks}
            title="Refresh Timeline Records"
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hud-chip hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoadingTimeline ? 'animate-spin text-emerald-400' : ''}`}
            />
          </button>

          {onNavigateLive && (
            <button
              type="button"
              onClick={onNavigateLive}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-medium text-xs rounded-lg transition-all"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Back to Live</span>
            </button>
          )}
        </div>
      </header>

      {/* Decode Budget Warning Banner */}
      {decodeBudgetWarning && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-400 font-medium flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{decodeBudgetWarning}</span>
          </div>
          <button
            type="button"
            onClick={clearDecodeBudgetWarning}
            className="text-amber-400 hover:text-zinc-200 p-0.5 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Playback Matrix Area */}
      <main className="flex-1 w-full relative flex flex-col bg-[#090a0f] overflow-hidden">
        {pageError ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center bg-[#090a0f]">
            <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
            <h2 className="text-sm font-semibold text-zinc-200 mb-1">Timeline Retrieval Error</h2>
            <p className="text-xs text-zinc-400 max-w-md mb-4">{pageError}</p>
            <button
              type="button"
              onClick={fetchAllTimelinesAndBookmarks}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs rounded-lg transition-colors"
            >
              Retry Timeline Query
            </button>
          </div>
        ) : selectedCameraIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center bg-[#090a0f]">
            <div className="w-12 h-12 rounded-xl hud-chip flex items-center justify-center mb-3 text-zinc-400">
              <Video className="w-6 h-6" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-200 mb-1">No Cameras Selected</h2>
            <p className="text-xs text-zinc-400 max-w-md">
              Select 1 to 4 cameras from the dropdown above to start synchronized multi-lane
              playback.
            </p>
          </div>
        ) : (
          <div className="flex-1 w-full h-full relative p-2.5 overflow-hidden">
            {/* Multi-Camera Playback Matrix Grid */}
            <div className={`grid ${gridClasses} w-full h-full gap-2.5`}>
              {selectedCameraIds.map((camId) => {
                const cam = cameras.find((c) => c.id === camId) || {
                  id: camId,
                  name: `Camera ${camId}`,
                };
                const isPrimary = camId === primaryCameraId;
                return (
                  <div
                    key={camId}
                    onClick={() => setPrimaryCameraId(camId)}
                    className={`relative w-full h-full rounded-xl overflow-hidden border transition-all ${
                      isPrimary
                        ? 'border-emerald-500/80 shadow-[0_0_16px_rgba(16,185,129,0.2)] ring-1 ring-emerald-500/50'
                        : 'border-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    <SynchronizedCameraTile
                      camera={cam}
                      spans={timelines[camId] || []}
                      targetTimestampMs={targetTimestampMs}
                      isPlaying={isPlaying}
                      playbackRate={playbackRate}
                      isStallLocked={isBuffering}
                      apiBaseUrl={apiBaseUrl}
                      authToken={effectiveToken}
                      onBuffering={reportBuffering}
                      onTimeUpdate={reportPlayerTime}
                      isPrimary={isPrimary}
                    />
                  </div>
                );
              })}
            </div>

            {/* Stall Lock Indicator Overlay across the Grid */}
            {isBuffering && (
              <div className="absolute inset-0 bg-[#090a0f]/70 backdrop-blur-sm flex flex-col items-center justify-center z-30 pointer-events-none transition-all">
                <div className="flex flex-col items-center alert-glass border border-white/10 px-6 py-4 rounded-xl shadow-2xl">
                  <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-2" />
                  <span className="text-xs font-semibold text-zinc-100 tracking-wide">
                    Synchronizing Playback Engine
                  </span>
                  <span className="text-[11px] text-zinc-400 mt-1 font-mono">
                    Stall pause lock active — waiting for camera streams to buffer...
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick-Jump Incident & Bookmark Bar */}
        <div className="w-full glass-bar px-4 py-1.5 border-t border-white/[0.08] flex items-center justify-between gap-3 text-xs shrink-0 select-none">
          <div className="flex items-center gap-2 text-zinc-400 text-[11px] font-medium">
            <History className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">QUICK INCIDENT JUMP:</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => handleQuickJump(5)}
              className="px-2.5 py-1 hud-chip hover:bg-zinc-800 rounded-md text-zinc-300 font-mono text-[11px] transition-colors shrink-0"
            >
              -5m
            </button>

            <button
              type="button"
              onClick={() => handleQuickJump(15)}
              className="px-2.5 py-1 hud-chip hover:bg-zinc-800 rounded-md text-zinc-300 font-mono text-[11px] transition-colors shrink-0"
            >
              -15m
            </button>

            <button
              type="button"
              onClick={() => handleQuickJump(60)}
              className="px-2.5 py-1 hud-chip hover:bg-zinc-800 rounded-md text-zinc-300 font-mono text-[11px] transition-colors shrink-0"
            >
              -1h
            </button>

            <button
              type="button"
              onClick={handleJumpYesterdaySameTime}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 font-medium text-[11px] rounded-md transition-colors shrink-0"
            >
              <Clock className="w-3 h-3" />
              <span>Yesterday Same Time</span>
            </button>

            {/* Add Bookmark Action Button */}
            <button
              type="button"
              onClick={() => setIsBookmarkModalOpen(true)}
              title="Bookmark current playback frame (Hotkey: B)"
              className="flex items-center gap-1.5 px-2.5 py-1 hud-chip hover:bg-zinc-800 text-zinc-200 font-medium text-[11px] rounded-md transition-colors shrink-0"
            >
              <Bookmark className="w-3 h-3 text-amber-400" />
              <span>Bookmark (B)</span>
            </button>
          </div>
        </div>

        {/* Stacked Multi-Lane Timeline Component Container */}
        <div className="w-full bg-[#090a0f] px-4 py-2 border-t border-white/[0.08] shrink-0">
          <MultiLaneTimeline
            currentDate={selectedDate}
            currentTime={targetTimestampMs}
            lanes={timelineLanes}
            onSeek={handleSeek}
            onAddBookmarkAtTime={(time, camId) => {
              if (camId) setPrimaryCameraId(camId);
              seekToTimestamp(time.getTime());
              setIsBookmarkModalOpen(true);
            }}
          />
        </div>

        {/* Playback Controls Container */}
        <div className="shrink-0">
          <PlaybackControls
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            onStep={handleStep}
            playbackRate={playbackRate}
            onChangePlaybackRate={setPlaybackRate}
            selectedDate={selectedDate}
            onChangeDate={handleDateChange}
            currentTime={new Date(targetTimestampMs)}
            isLoading={isLoadingTimeline}
            onExportClip={canExport ? () => setIsExportModalOpen(true) : undefined}
          />
        </div>
      </main>

      {/* Clip Export Modal */}
      <ClipExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        cameraId={primaryCameraId}
        cameraName={primaryCamera?.name || 'Selected Camera'}
        initialStartTime={new Date(targetTimestampMs - 2.5 * 60 * 1000)}
        initialEndTime={new Date(targetTimestampMs + 2.5 * 60 * 1000)}
        apiBaseUrl={apiBaseUrl}
        authToken={effectiveToken}
      />

      {/* Bookmark Modal */}
      <BookmarkModal
        isOpen={isBookmarkModalOpen}
        onClose={() => setIsBookmarkModalOpen(false)}
        onSaved={fetchAllTimelinesAndBookmarks}
        cameraId={primaryCameraId}
        cameraName={primaryCamera?.name || 'Selected Camera'}
        timestamp={new Date(targetTimestampMs)}
        apiBaseUrl={apiBaseUrl}
        authToken={effectiveToken}
      />

      {/* Accessible Floating HUD Badge Overlay */}
      <FloatingHudBadge text={hudBadgeText} />

      {/* Keyboard Shortcuts Cheat Sheet Modal (Hotkey: ?) */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
};

export const PlaybackPage: React.FC<PlaybackPageProps> = (props) => {
  return (
    <PlaybackSyncProvider>
      <PlaybackPageContent {...props} />
    </PlaybackSyncProvider>
  );
};

export default PlaybackPage;
