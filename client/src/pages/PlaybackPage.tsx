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
} from 'lucide-react';
import { BookmarkItem } from '../components/TimelineScrubber.js';
import { MultiLaneTimeline, LaneCameraData } from '../components/MultiLaneTimeline.js';
import { PlaybackControls } from '../components/PlaybackControls.js';
import { ClipExportModal } from '../components/ClipExportModal.js';
import { BookmarkModal } from '../components/BookmarkModal.js';
import {
  getTodayString,
  CameraOption,
  TimelineSpan,
} from '../hooks/usePlaybackSession.js';
import { useAuth, CameraPermissionDto } from '../context/AuthContext.js';
import { OperatorBanner } from '../components/OperatorBanner.js';
import {
  PlaybackSyncProvider,
  usePlaybackSync,
  calculatePlayerAlignment,
} from '../context/PlaybackSyncContext.js';

export type { CameraOption };

export interface PlaybackPageProps {
  apiBaseUrl?: string;
  authToken?: string;
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
 * otherwise renders the fMP4 stream synchronized to the master clock.
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
  const lastReseekTimeRef = useRef<number>(0);

  // Check if camera has recording footage at target timestamp
  const currentSpan = useMemo(() => {
    return spans.find((s) => {
      const startMs = new Date(s.startTime).getTime();
      const endMs = new Date(s.endTime).getTime();
      return targetTimestampMs >= startMs && targetTimestampMs <= endMs;
    });
  }, [spans, targetTimestampMs]);

  const hasFootage = Boolean(currentSpan);

  // Fetch fMP4 stream URL from MediaMTX when playhead enters a recording segment
  useEffect(() => {
    if (!hasFootage) {
      setStreamUrl(null);
      setStreamStartTimeMs(null);
      setStreamError(null);
      onBuffering(camera.id, false);
      return;
    }

    // If existing stream already covers targetTimestampMs, reuse it
    if (
      streamUrl &&
      streamStartTimeMs !== null &&
      targetTimestampMs >= streamStartTimeMs &&
      targetTimestampMs <= streamStartTimeMs + 300 * 1000
    ) {
      return;
    }

    let isCancelled = false;
    const fetchStream = async () => {
      try {
        setStreamError(null);
        setIsBufferingLocal(true);
        onBuffering(camera.id, true);

        const isoTimestamp = new Date(targetTimestampMs).toISOString();
        const headers: Record<string, string> = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

        const res = await fetch(
          `${apiBaseUrl}/api/playback/stream?cameraId=${encodeURIComponent(
            camera.id
          )}&startTime=${encodeURIComponent(isoTimestamp)}&duration=300`,
          { headers }
        );

        if (!res.ok) {
          throw new Error(`Failed to load stream: HTTP ${res.status}`);
        }

        const data = await res.json();
        if (!isCancelled) {
          setStreamUrl(data.fmp4StreamUrl);
          setStreamStartTimeMs(targetTimestampMs);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setStreamError(err.message || 'Stream retrieval failed');
          setIsBufferingLocal(false);
          onBuffering(camera.id, false);
        }
      }
    };

    fetchStream();

    return () => {
      isCancelled = true;
    };
  }, [hasFootage, camera.id, targetTimestampMs, streamUrl, streamStartTimeMs, apiBaseUrl, authToken, onBuffering]);

  // Synchronize play/pause and stall lock
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (isPlaying && !isStallLocked) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          // Play interrupted or autoplay policy
        });
      }
    } else {
      video.pause();
    }
  }, [isPlaying, isStallLocked, streamUrl]);

  // Synchronize playback speed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Check and enforce player time alignment with master target clock
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl || streamStartTimeMs === null) return;

    const now = Date.now();
    // Allow cooldown between reseeks to avoid oscillation
    if (now - lastReseekTimeRef.current < 300) return;

    const alignment = calculatePlayerAlignment({
      segmentStartMs: streamStartTimeMs,
      currentTimeSec: video.currentTime,
      targetTimestampMs,
      toleranceMs: 200,
    });

    if (alignment.needsReseek) {
      lastReseekTimeRef.current = now;
      video.currentTime = alignment.suggestedSeekSec;
    }
  }, [targetTimestampMs, streamUrl, streamStartTimeMs]);

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
      <div className="relative w-full h-full bg-[#090d16] flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden">
        {/* Subtle diagonal gap pattern */}
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(45deg, #090d16, #090d16 12px, #0e1320 12px, #0e1320 24px)`,
          }}
        />

        {/* Camera Header Badge */}
        <div className="absolute top-3 left-3 bg-[#111827]/90 backdrop-blur-sm border border-[#1f2937] px-2.5 py-1 rounded-md text-xs font-semibold text-slate-300 flex items-center gap-2 z-10">
          <div className="w-2 h-2 rounded-full bg-slate-500" />
          <span className="truncate max-w-[140px]">{camera.name}</span>
          {isPrimary && (
            <span className="text-[10px] text-[#4fc3f7] font-bold uppercase tracking-wider">
              Primary
            </span>
          )}
        </div>

        {/* Center Gap Notice */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-14 h-14 rounded-full bg-[#111827] border border-[#1f2937] flex items-center justify-center mb-3 shadow-inner">
            <Film className="w-7 h-7 text-slate-500" />
          </div>
          <h3 className="text-sm font-bold text-slate-200">No Recording</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xs font-sans">
            No footage captured for {camera.name} at{' '}
            <span className="font-mono text-slate-300">
              {new Date(targetTimestampMs).toLocaleTimeString()}
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
        <div className="flex flex-col items-center justify-center text-slate-400 gap-2">
          <Loader2 className="w-8 h-8 text-[#4fc3f7] animate-spin" />
          <span className="text-xs font-semibold">Resolving stream...</span>
        </div>
      )}

      {/* Local Buffering Spinner */}
      {isBufferingLocal && (
        <div className="absolute inset-0 bg-[#090d16]/50 backdrop-blur-sm flex items-center justify-center pointer-events-none z-10">
          <Loader2 className="w-8 h-8 text-[#4fc3f7] animate-spin" />
        </div>
      )}

      {/* Camera Header Badge */}
      <div className="absolute top-3 left-3 bg-[#111827]/90 backdrop-blur-sm border border-[#1f2937] px-2.5 py-1 rounded-md text-xs font-semibold text-slate-100 flex items-center gap-2 shadow-lg z-10">
        <div className="w-2 h-2 rounded-full bg-[#10b981] shadow-[0_0_6px_#10b981] animate-pulse" />
        <span className="truncate max-w-[140px]">{camera.name}</span>
        {isPrimary && (
          <span className="text-[10px] text-[#4fc3f7] font-bold uppercase tracking-wider">
            Primary
          </span>
        )}
      </div>

      {/* Error Overlay */}
      {streamError && (
        <div className="absolute inset-0 bg-[#090d16]/90 flex flex-col items-center justify-center p-4 text-center border border-red-900/50 z-20">
          <AlertCircle className="w-8 h-8 text-[#fb923c] mb-2" />
          <p className="text-xs font-bold text-slate-100">{streamError}</p>
        </div>
      )}
    </div>
  );
};

const PlaybackPageContent: React.FC<PlaybackPageProps> = ({
  apiBaseUrl = '',
  authToken = '',
  onNavigateLive,
}) => {
  const { token: authContextToken, user } = useAuth();
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
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayString());
  const [primaryCameraId, setPrimaryCameraId] = useState<string>('');
  const [timelines, setTimelines] = useState<Record<string, TimelineSpan[]>>({});
  const [bookmarks, setBookmarks] = useState<Record<string, BookmarkItem[]>>({});
  const [isLoadingTimeline, setIsLoadingTimeline] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [isCameraDropdownOpen, setIsCameraDropdownOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState<boolean>(false);

  const todayStr = getTodayString();
  const yesterdayStr = getTodayString(new Date(Date.now() - 86400000));
  const dayBeforeStr = getTodayString(new Date(Date.now() - 2 * 86400000));

  // Determine export permissions
  const canExport =
    user?.role === 'ADMIN' ||
    (user?.role === 'OPERATOR' &&
      user?.cameraPermissions?.find((p: CameraPermissionDto) => p.cameraId === primaryCameraId)
        ?.canExportClips !== false);

  // Fetch camera roster on mount
  useEffect(() => {
    let isCancelled = false;
    const fetchCameras = async () => {
      try {
        const headers: Record<string, string> = {};
        if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;

        let res = await fetch(`${apiBaseUrl}/api/cameras`, { headers });
        if (!res.ok) {
          res = await fetch(`${apiBaseUrl}/api/streaming/config`, { headers });
        }
        if (!res.ok) {
          throw new Error(`Failed to load camera list: HTTP ${res.status}`);
        }

        const data = await res.json();
        const list: CameraOption[] = Array.isArray(data)
          ? data.map((c: any) => ({ id: c.id, name: c.name, mediaMtxPath: c.mediaMtxPath }))
          : (data.cameras || []).map((c: any) => ({
              id: c.id,
              name: c.name,
              mediaMtxPath: c.mediaMtxPath,
            }));

        if (!isCancelled) {
          setCameras(list);
          if (list.length > 0 && selectedCameraIds.length === 0) {
            setSelectedCameraIds([list[0].id]);
            setPrimaryCameraId(list[0].id);
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
  }, [apiBaseUrl, effectiveToken, selectedCameraIds.length, setSelectedCameraIds]);

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
          const res = await fetch(
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
          const res = await fetch(
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

  // Keyboard shortcut: 'b' or 'B' to add bookmark at current playback time
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        setIsBookmarkModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Quick incident jump helper (-5m, -15m, -1h)
  const handleQuickJump = (minutesAgo: number) => {
    const target = new Date(Date.now() - minutesAgo * 60 * 1000);
    const targetDateStr = getTodayString(target);
    if (targetDateStr !== selectedDate) {
      setSelectedDate(targetDateStr);
    }
    seekToTimestamp(target.getTime());
    setIsPlaying(true);
  };

  // Jump to yesterday at same time
  const handleJumpYesterdaySameTime = () => {
    const targetMs = targetTimestampMs - 24 * 60 * 60 * 1000;
    setSelectedDate(yesterdayStr);
    seekToTimestamp(targetMs);
  };

  // Timeline seek handler
  const handleSeek = (seekTime: Date) => {
    seekToTimestamp(seekTime.getTime());
    setIsPlaying(true);
  };

  // Step -5s / +5s handler
  const handleStep = (seconds: number) => {
    seekToTimestamp(targetTimestampMs + seconds * 1000);
  };

  // Toggle play/pause
  const handleTogglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  // Date selection handler
  const handleDateChange = (newDateStr: string) => {
    setSelectedDate(newDateStr);
    const parts = newDateStr.split('-').map(Number);
    if (parts.length === 3) {
      const d = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      seekToTimestamp(d.getTime());
    }
  };

  // Prepare lanes data for MultiLaneTimeline
  const timelineLanes: LaneCameraData[] = useMemo(() => {
    return selectedCameraIds.map((camId) => {
      const cam = cameras.find((c) => c.id === camId);
      return {
        cameraId: camId,
        cameraName: cam?.name || `Camera ${camId}`,
        spans: timelines[camId] || [],
        bookmarks: bookmarks[camId] || [],
      };
    });
  }, [selectedCameraIds, cameras, timelines, bookmarks]);

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
    <div className="flex flex-col w-screen h-screen bg-[#090d16] text-slate-100 overflow-hidden font-sans">
      {/* Operator Shift Mode Banner */}
      <OperatorBanner />

      {/* Top Application Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#111827] border-b border-[#1f2937] shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-bold tracking-tight text-sm text-slate-100">
            <div className="w-8 h-8 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#4fc3f7]" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs tracking-wider text-[#4fc3f7] font-mono">BASIC VMS</span>
              <span className="text-[10px] text-slate-400 font-normal">
                Synchronized Multi-Camera Playback Matrix
              </span>
            </div>
          </div>
          <span className="text-[#1f2937]">|</span>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-300 font-medium">
            <Layers className="w-4 h-4 text-[#4fc3f7]" />
            <span>1–4 Matrix & Multi-Lane</span>
          </div>
        </div>

        {/* Center: Camera Multi-Selector & Date Controls */}
        <div className="flex items-center gap-2.5">
          {/* Multi-Camera Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsCameraDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 bg-[#090d16] px-3 py-1.5 rounded-md border border-[#1f2937] hover:border-[#4fc3f7]/50 text-xs font-semibold text-slate-200 transition-colors"
            >
              <Video className="w-3.5 h-3.5 text-[#4fc3f7]" />
              <span>
                Cameras ({selectedCameraIds.length}/4)
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
            </button>

            {isCameraDropdownOpen && (
              <div className="absolute top-full mt-1.5 left-0 w-64 bg-[#111827] border border-[#1f2937] rounded-lg shadow-2xl p-2 z-50">
                <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-[#1f2937] text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <span>Playback Matrix</span>
                  <span
                    className={
                      selectedCameraIds.length >= 4 ? 'text-[#fb923c] font-bold' : 'text-slate-400'
                    }
                  >
                    {selectedCameraIds.length} / 4 Max
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto flex flex-col gap-1 py-1">
                  {cameras.length === 0 ? (
                    <div className="text-xs text-slate-500 italic p-2 text-center">
                      No cameras configured
                    </div>
                  ) : (
                    cameras.map((c) => {
                      const isSelected = selectedCameraIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCameraSelection(c.id)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors ${
                            isSelected
                              ? 'bg-[#4fc3f7]/15 text-[#4fc3f7] font-bold'
                              : 'text-slate-300 hover:bg-[#1f2937]'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="truncate">{c.name}</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-[#4fc3f7] shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Date Shortcuts */}
          <div className="hidden md:flex items-center gap-1 bg-[#090d16] p-1 rounded-md border border-[#1f2937] text-xs font-semibold">
            <button
              type="button"
              onClick={() => handleDateChange(todayStr)}
              className={`px-2.5 py-1 rounded transition-colors ${
                selectedDate === todayStr
                  ? 'bg-[#4fc3f7] text-[#090d16] font-bold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handleDateChange(yesterdayStr)}
              className={`px-2.5 py-1 rounded transition-colors ${
                selectedDate === yesterdayStr
                  ? 'bg-[#4fc3f7] text-[#090d16] font-bold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => handleDateChange(dayBeforeStr)}
              className={`px-2.5 py-1 rounded transition-colors ${
                selectedDate === dayBeforeStr
                  ? 'bg-[#4fc3f7] text-[#090d16] font-bold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              2 Days Ago
            </button>
          </div>

          {/* Custom Date Input */}
          <div className="flex items-center gap-1.5 bg-[#090d16] px-2.5 py-1.5 rounded-md border border-[#1f2937] text-xs">
            <Calendar className="w-3.5 h-3.5 text-[#4fc3f7]" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer text-xs font-semibold"
            />
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchAllTimelinesAndBookmarks}
            title="Refresh Timeline Records"
            className="p-2 text-slate-300 hover:text-white rounded-md bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/50 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoadingTimeline ? 'animate-spin text-[#4fc3f7]' : ''}`}
            />
          </button>
        </div>

        {/* Right Navigation: Return to Live */}
        <div className="flex items-center gap-2">
          {onNavigateLive && (
            <button
              type="button"
              onClick={onNavigateLive}
              className="flex items-center gap-2 px-3.5 py-1.5 min-h-[36px] bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-md transition-all shadow-md active:scale-95"
            >
              <Radio className="w-4 h-4" />
              <span>Back to Live</span>
            </button>
          )}
        </div>
      </header>

      {/* Decode Budget Warning Banner */}
      {decodeBudgetWarning && (
        <div className="bg-[#fb923c]/15 border-b border-[#fb923c]/40 px-4 py-2 text-xs text-[#fb923c] font-semibold flex items-center justify-between shrink-0 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{decodeBudgetWarning}</span>
          </div>
          <button
            type="button"
            onClick={clearDecodeBudgetWarning}
            className="text-[#fb923c] hover:text-white p-0.5 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Playback Matrix Area */}
      <main className="flex-1 w-full relative flex flex-col bg-black overflow-hidden">
        {pageError ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center bg-[#090d16]">
            <AlertCircle className="w-12 h-12 text-[#fb923c] mb-3" />
            <h2 className="text-base font-bold text-slate-100 mb-1">Timeline Retrieval Error</h2>
            <p className="text-xs text-slate-400 max-w-md mb-4">{pageError}</p>
            <button
              type="button"
              onClick={fetchAllTimelinesAndBookmarks}
              className="px-5 py-2 min-h-[40px] bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-md transition-colors"
            >
              Retry Timeline Query
            </button>
          </div>
        ) : selectedCameraIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center bg-[#090d16]">
            <Video className="w-12 h-12 text-[#4fc3f7] mb-3 opacity-60" />
            <h2 className="text-base font-bold text-slate-100 mb-1">No Cameras Selected</h2>
            <p className="text-xs text-slate-400 max-w-md mb-4">
              Select 1 to 4 cameras from the dropdown above to start synchronized multi-lane
              playback.
            </p>
          </div>
        ) : (
          <div className="flex-1 w-full h-full relative p-2 overflow-hidden">
            {/* Multi-Camera Playback Matrix Grid */}
            <div className={`grid ${gridClasses} w-full h-full gap-2`}>
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
                    className={`relative w-full h-full rounded-lg overflow-hidden border transition-all ${
                      isPrimary
                        ? 'border-[#4fc3f7] shadow-[0_0_12px_rgba(79,195,247,0.25)]'
                        : 'border-[#1f2937] hover:border-slate-600'
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
              <div className="absolute inset-0 bg-[#090d16]/70 backdrop-blur-sm flex flex-col items-center justify-center z-30 pointer-events-none transition-all">
                <div className="flex flex-col items-center bg-[#111827]/95 border border-[#1f2937] px-6 py-4 rounded-xl shadow-2xl">
                  <Loader2 className="w-8 h-8 text-[#4fc3f7] animate-spin mb-2" />
                  <span className="text-sm font-bold text-slate-100 tracking-wide">
                    Synchronizing Playback Engine
                  </span>
                  <span className="text-xs text-slate-400 mt-1 font-mono">
                    Stall pause lock active — waiting for camera streams to buffer...
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick-Jump Incident & Bookmark Bar */}
        <div className="w-full bg-[#111827] px-4 py-1.5 border-t border-[#1f2937] flex items-center justify-between gap-3 text-xs shrink-0 select-none">
          <div className="flex items-center gap-2 text-slate-300 font-semibold">
            <History className="w-4 h-4 text-[#4fc3f7]" />
            <span className="hidden sm:inline">QUICK INCIDENT JUMP:</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => handleQuickJump(5)}
              className="flex items-center gap-1 px-3 py-1 bg-[#090d16] hover:bg-[#1f2937] border border-[#1f2937] hover:border-[#4fc3f7]/50 rounded-md text-slate-200 font-semibold text-xs transition-colors shrink-0"
            >
              <span>-5 Min</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickJump(15)}
              className="flex items-center gap-1 px-3 py-1 bg-[#090d16] hover:bg-[#1f2937] border border-[#1f2937] hover:border-[#4fc3f7]/50 rounded-md text-slate-200 font-semibold text-xs transition-colors shrink-0"
            >
              <span>-15 Min</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickJump(60)}
              className="flex items-center gap-1 px-3 py-1 bg-[#090d16] hover:bg-[#1f2937] border border-[#1f2937] hover:border-[#4fc3f7]/50 rounded-md text-slate-200 font-semibold text-xs transition-colors shrink-0"
            >
              <span>-1 Hour</span>
            </button>

            <button
              type="button"
              onClick={handleJumpYesterdaySameTime}
              className="flex items-center gap-1.5 px-3 py-1 bg-[#fb923c]/15 hover:bg-[#fb923c]/25 border border-[#fb923c]/40 text-[#fb923c] font-bold text-xs rounded-md transition-colors shrink-0"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Yesterday Same Time</span>
            </button>

            {/* Add Bookmark Action Button */}
            <button
              type="button"
              onClick={() => setIsBookmarkModalOpen(true)}
              title="Bookmark current playback frame (Hotkey: B)"
              className="flex items-center gap-1.5 px-3 py-1 bg-[#111827] hover:bg-[#1f2937] border border-[#fb923c]/60 text-[#fb923c] font-bold text-xs rounded-md transition-colors shrink-0 shadow-sm"
            >
              <Bookmark className="w-3.5 h-3.5 text-[#fb923c]" />
              <span>Add Bookmark (B)</span>
            </button>
          </div>
        </div>

        {/* Stacked Multi-Lane Timeline Component Container */}
        <div className="w-full bg-[#090d16] px-4 py-2.5 border-t border-[#1f2937] shrink-0">
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
