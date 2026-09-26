import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Sparkles,
  LayoutGrid,
  Square,
  Search,
  CheckSquare,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { TimelineScrubber, BookmarkItem } from '../components/TimelineScrubber.js';
import { PlaybackControls } from '../components/PlaybackControls.js';
import { PlaybackPlayer } from '../components/PlaybackPlayer.js';
import { ClipExportModal } from '../components/ClipExportModal.js';
import { BookmarkModal } from '../components/BookmarkModal.js';
import { SyncPlaybackGrid, SyncCameraSlot } from '../components/SyncPlaybackGrid.js';
import { MultiTrackTimeline, CameraTrackData } from '../components/MultiTrackTimeline.js';
import { SmartMotionSearchModal } from '../components/SmartMotionSearchModal.js';
import {
  usePlaybackSession,
  getTodayString,
  CameraOption,
  TimelineSpan,
} from '../hooks/usePlaybackSession.js';
import { useAuth, CameraPermissionDto } from '../context/AuthContext.js';
import { OperatorBanner } from '../components/OperatorBanner.js';

export type { CameraOption };

export interface PlaybackPageProps {
  apiBaseUrl?: string;
  authToken?: string;
  onNavigateLive?: () => void;
}

export const PlaybackPage: React.FC<PlaybackPageProps> = ({
  apiBaseUrl = '',
  authToken = '',
  onNavigateLive,
}) => {
  const { token: authContextToken, user } = useAuth();
  const effectiveToken = authToken || authContextToken || '';

  const {
    cameras,
    selectedCameraId,
    setSelectedCameraId,
    selectedDate,
    setSelectedDate,
    currentTime,
    timelineSpans,
    streamUrl,
    isPlaying,
    setIsPlaying,
    playbackRate,
    setPlaybackRate,
    isLoading,
    error,
    selectedCamera,
    handleSeek,
    handleStep,
    handleTogglePlay,
    handleVideoTimeUpdate,
    fetchTimeline,
  } = usePlaybackSession({
    apiBaseUrl,
    authToken: effectiveToken,
  });

  const [viewMode, setViewMode] = useState<'single' | 'quad_sync'>('single');
  const [selectedSyncCameraIds, setSelectedSyncCameraIds] = useState<string[]>([]);
  const [isSyncDrawerOpen, setIsSyncDrawerOpen] = useState<boolean>(false);
  const [syncTimelines, setSyncTimelines] = useState<
    Record<string, { spans: TimelineSpan[]; totalDurationSeconds: number }>
  >({});
  const [syncStreams, setSyncStreams] = useState<
    Record<string, { fmp4StreamUrl: string | null; available: boolean }>
  >({});

  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState<boolean>(false);
  const [isMotionSearchOpen, setIsMotionSearchOpen] = useState<boolean>(false);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);

  const todayStr = getTodayString();
  const yesterdayDate = new Date(Date.now() - 86400000);
  const yesterdayStr = getTodayString(yesterdayDate);
  const dayBeforeDate = new Date(Date.now() - 2 * 86400000);
  const dayBeforeStr = getTodayString(dayBeforeDate);

  // Pre-populate sync cameras when cameras load
  useEffect(() => {
    if (cameras.length > 0 && selectedSyncCameraIds.length === 0) {
      setSelectedSyncCameraIds(cameras.slice(0, 4).map((c) => c.id));
    }
  }, [cameras, selectedSyncCameraIds.length]);

  // Determine export permissions
  const canExport =
    user?.role === 'ADMIN' ||
    (user?.role === 'OPERATOR' &&
      user?.cameraPermissions?.find((p: CameraPermissionDto) => p.cameraId === selectedCameraId)
        ?.canExportClips !== false);

  // Fetch bookmarks for current camera and date window
  const fetchBookmarks = useCallback(async () => {
    if (!selectedCameraId) return;
    try {
      const headers: Record<string, string> = {};
      if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;

      const dayStart = `${selectedDate}T00:00:00.000Z`;
      const dayEnd = `${selectedDate}T23:59:59.999Z`;

      const res = await fetch(
        `${apiBaseUrl}/api/cameras/${selectedCameraId}/bookmarks?from=${encodeURIComponent(
          dayStart
        )}&to=${encodeURIComponent(dayEnd)}`,
        { headers }
      );

      if (res.ok) {
        const data = await res.json();
        if (data.bookmarks) {
          setBookmarks(data.bookmarks);
        }
      }
    } catch (err) {
      console.error('Failed to fetch bookmarks:', err);
    }
  }, [selectedCameraId, selectedDate, effectiveToken, apiBaseUrl]);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  // Fetch multi-camera timelines when in quad_sync mode
  const fetchSyncTimelines = useCallback(async () => {
    if (selectedSyncCameraIds.length === 0) return;
    try {
      const headers: Record<string, string> = {};
      if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;

      const url = `${apiBaseUrl}/api/playback/timeline-multi?cameraIds=${encodeURIComponent(
        selectedSyncCameraIds.join(',')
      )}&date=${encodeURIComponent(selectedDate)}`;

      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.timelines) {
          setSyncTimelines(data.timelines);
        }
      }
    } catch (err) {
      console.error('Failed to fetch sync timelines:', err);
    }
  }, [selectedSyncCameraIds, selectedDate, effectiveToken, apiBaseUrl]);

  useEffect(() => {
    if (viewMode === 'quad_sync') {
      fetchSyncTimelines();
    }
  }, [viewMode, fetchSyncTimelines]);

  // Fetch sync stream URLs when playhead time changes in quad_sync mode
  const loadSyncStreams = useCallback(
    async (seekDate: Date) => {
      if (selectedSyncCameraIds.length === 0) return;
      try {
        const headers: Record<string, string> = {};
        if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;

        const url = `${apiBaseUrl}/api/playback/sync-streams?cameraIds=${encodeURIComponent(
          selectedSyncCameraIds.join(',')
        )}&startTime=${encodeURIComponent(seekDate.toISOString())}&duration=300`;

        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.streams) {
            setSyncStreams(data.streams);
          }
        }
      } catch (err) {
        console.error('Failed to load sync streams:', err);
      }
    },
    [selectedSyncCameraIds, effectiveToken, apiBaseUrl]
  );

  // Synchronized seek handler for both modes
  const handleMasterSeek = useCallback(
    (targetTime: Date) => {
      handleSeek(targetTime);
      if (viewMode === 'quad_sync') {
        loadSyncStreams(targetTime);
      }
    },
    [handleSeek, viewMode, loadSyncStreams]
  );

  // Toggle sync camera selection
  const toggleSyncCamera = (camId: string) => {
    setSelectedSyncCameraIds((prev) => {
      if (prev.includes(camId)) {
        if (prev.length <= 1) return prev; // Keep at least 1
        return prev.filter((id) => id !== camId);
      } else {
        if (prev.length >= 4) {
          // Replace last if already at 4 max
          return [...prev.slice(0, 3), camId];
        }
        return [...prev, camId];
      }
    });
  };

  // Keyboard shortcut: 'b' or 'B' to add bookmark
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
    handleMasterSeek(target);
  };

  const handleJumpYesterdaySameTime = () => {
    const target = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);
    setSelectedDate(yesterdayStr);
    handleMasterSeek(target);
  };

  // Build slots for SyncPlaybackGrid
  const syncSlots: SyncCameraSlot[] = useMemo(() => {
    return selectedSyncCameraIds.map((camId) => {
      const cam = cameras.find((c) => c.id === camId);
      const streamInfo = syncStreams[camId];
      const tl = syncTimelines[camId];

      return {
        cameraId: camId,
        cameraName: cam?.name || 'Camera',
        streamUrl: streamInfo?.fmp4StreamUrl || null,
        available: streamInfo?.available ?? true,
        hasSegmentsOnDate: (tl?.spans?.length ?? 0) > 0,
      };
    });
  }, [selectedSyncCameraIds, cameras, syncStreams, syncTimelines]);

  // Build tracks for MultiTrackTimeline
  const multiTracks: CameraTrackData[] = useMemo(() => {
    return selectedSyncCameraIds.map((camId) => {
      const cam = cameras.find((c) => c.id === camId);
      const tl = syncTimelines[camId];
      return {
        cameraId: camId,
        cameraName: cam?.name || 'Camera',
        spans: tl?.spans || [],
      };
    });
  }, [selectedSyncCameraIds, cameras, syncTimelines]);

  return (
    <div className="flex flex-col w-screen h-screen bg-[#090d16] text-slate-100 overflow-hidden font-sans">
      <OperatorBanner />

      {/* Top Application Header */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-[#111827] border-b border-[#1f2937] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-bold tracking-tight text-sm text-slate-100">
            <div className="w-8 h-8 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#4fc3f7]" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs tracking-wider text-[#4fc3f7] font-mono">BASIC VMS</span>
              <span className="text-[10px] text-slate-400 font-normal">Playback & Incident Review</span>
            </div>
          </div>
          <span className="text-[#1f2937]">|</span>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-300 font-medium">
            <Film className="w-4 h-4 text-[#4fc3f7]" />
            <span>24-Hour Timeline</span>
          </div>
        </div>

        {/* Center: View Mode Toggle & Camera Selectors */}
        <div className="flex items-center gap-3">
          {/* Mode Switcher: Single vs 4x Sync Grid */}
          <div className="flex items-center p-0.5 bg-[#090d16] rounded-lg border border-[#1f2937] text-xs">
            <button
              type="button"
              onClick={() => setViewMode('single')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors ${
                viewMode === 'single'
                  ? 'bg-[#4fc3f7] text-[#090d16] shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Square className="w-3.5 h-3.5" />
              <span>Single</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode('quad_sync');
                loadSyncStreams(currentTime);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors ${
                viewMode === 'quad_sync'
                  ? 'bg-[#4fc3f7] text-[#090d16] shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>4x Sync Grid</span>
            </button>
          </div>

          {/* Single Mode: Camera Dropdown */}
          {viewMode === 'single' ? (
            <div className="flex items-center gap-2 bg-[#090d16] px-3 py-1.5 rounded-md border border-[#1f2937] text-xs">
              <Video className="w-4 h-4 text-[#4fc3f7]" />
              <select
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                className="bg-transparent text-slate-100 font-semibold focus:outline-none cursor-pointer text-xs"
              >
                {cameras.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#111827] text-slate-100">
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* Quad Sync Mode: Multi-Camera Drawer Toggle */
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsSyncDrawerOpen((prev) => !prev)}
                className="flex items-center gap-2 bg-[#090d16] hover:bg-[#1f2937] px-3 py-1.5 rounded-md border border-[#1f2937] hover:border-[#4fc3f7]/50 text-xs font-semibold text-slate-200 transition-colors"
              >
                <Layers className="w-3.5 h-3.5 text-[#4fc3f7]" />
                <span>{selectedSyncCameraIds.length} Cameras Synced</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {/* Multi-Camera Selection Popover */}
              {isSyncDrawerOpen && (
                <div className="absolute top-full mt-1.5 left-0 w-64 bg-[#111827] border border-[#1f2937] rounded-lg shadow-2xl p-2 z-50">
                  <div className="text-[11px] font-bold text-slate-400 px-2 py-1 uppercase tracking-wider">
                    Select Up to 4 Cameras:
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {cameras.map((cam) => {
                      const isSelected = selectedSyncCameraIds.includes(cam.id);
                      return (
                        <div
                          key={cam.id}
                          onClick={() => toggleSyncCamera(cam.id)}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#4fc3f7]/15 text-[#4fc3f7] font-semibold'
                              : 'text-slate-300 hover:bg-[#090d16]'
                          }`}
                        >
                          <span className="truncate">{cam.name}</span>
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-[#4fc3f7] shrink-0" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick Date Shortcuts (Today / Yesterday) */}
          <div className="hidden md:flex items-center gap-1 bg-[#090d16] p-1 rounded-md border border-[#1f2937] text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSelectedDate(todayStr)}
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
              onClick={() => setSelectedDate(yesterdayStr)}
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
              onClick={() => setSelectedDate(dayBeforeStr)}
              className={`px-2.5 py-1 rounded transition-colors ${
                selectedDate === dayBeforeStr
                  ? 'bg-[#4fc3f7] text-[#090d16] font-bold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              2 Days Ago
            </button>
          </div>

          {/* Custom Date Picker */}
          <div className="flex items-center gap-1.5 bg-[#090d16] px-2.5 py-1.5 rounded-md border border-[#1f2937] text-xs">
            <Calendar className="w-3.5 h-3.5 text-[#4fc3f7]" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer text-xs font-semibold"
            />
          </div>

          {/* Refresh Timeline */}
          <button
            type="button"
            onClick={() => {
              fetchTimeline();
              fetchBookmarks();
              if (viewMode === 'quad_sync') {
                fetchSyncTimelines();
                loadSyncStreams(currentTime);
              }
            }}
            title="Refresh Timeline Data"
            className="p-2 text-slate-300 hover:text-white rounded-md bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#4fc3f7]' : ''}`} />
          </button>
        </div>

        {/* Right Navigation: Return to Live */}
        <div className="flex items-center gap-2">
          {onNavigateLive && (
            <button
              type="button"
              onClick={onNavigateLive}
              className="flex items-center gap-2 px-3.5 py-2 min-h-[40px] bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-md transition-all shadow-md active:scale-95"
            >
              <Radio className="w-4 h-4" />
              <span>Back to Live</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Playback Area */}
      <main className="flex-1 w-full relative flex flex-col bg-black overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center bg-[#090d16]">
            <AlertCircle className="w-12 h-12 text-[#fb923c] mb-3" />
            <h2 className="text-base font-bold text-slate-100 mb-1">Timeline Retrieval Error</h2>
            <p className="text-xs text-slate-400 max-w-md mb-4">{error}</p>
            <button
              type="button"
              onClick={fetchTimeline}
              className="px-5 py-2 min-h-[40px] bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-md transition-colors"
            >
              Retry Timeline Query
            </button>
          </div>
        ) : viewMode === 'quad_sync' ? (
          /* 4x Synchronized Multi-Camera Grid */
          <div className="flex-1 w-full h-full relative">
            <SyncPlaybackGrid
              slots={syncSlots}
              isPlaying={isPlaying}
              playbackRate={playbackRate}
              onMasterTimeUpdate={handleVideoTimeUpdate}
            />
          </div>
        ) : (
          /* Classic Single Camera Player */
          <div className="flex-1 w-full h-full relative">
            <PlaybackPlayer
              streamUrl={streamUrl}
              isPlaying={isPlaying}
              playbackRate={playbackRate}
              cameraName={selectedCamera?.name || 'Selected Camera'}
              onTimeUpdate={handleVideoTimeUpdate}
              onEnded={() => setIsPlaying(false)}
            />
          </div>
        )}

        {/* Quick-Jump Incident & Smart Search Bar */}
        <div className="w-full bg-[#111827] px-4 py-2 border-t border-[#1f2937] flex items-center justify-between gap-3 text-xs shrink-0 select-none">
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

            {/* Smart Motion Search Action Button */}
            <button
              type="button"
              onClick={() => setIsMotionSearchOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-[#4fc3f7]/15 hover:bg-[#4fc3f7]/25 border border-[#4fc3f7]/40 text-[#4fc3f7] font-bold text-xs rounded-md transition-colors shrink-0 shadow-sm"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Smart Motion Search</span>
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

        {/* Timeline Scrubber Container */}
        <div className="w-full bg-[#090d16] px-4 py-3 border-t border-[#1f2937] shrink-0">
          {viewMode === 'quad_sync' ? (
            <MultiTrackTimeline
              currentDate={selectedDate}
              currentTime={currentTime}
              tracks={multiTracks}
              onSeek={handleMasterSeek}
            />
          ) : (
            <TimelineScrubber
              currentDate={selectedDate}
              currentTime={currentTime}
              spans={timelineSpans}
              bookmarks={bookmarks}
              onSeek={handleMasterSeek}
              onAddBookmarkAtTime={() => setIsBookmarkModalOpen(true)}
            />
          )}
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
            onChangeDate={setSelectedDate}
            currentTime={currentTime}
            isLoading={isLoading}
            onExportClip={canExport ? () => setIsExportModalOpen(true) : undefined}
          />
        </div>
      </main>

      {/* Clip Export Modal */}
      <ClipExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        cameraId={selectedCameraId}
        cameraName={selectedCamera?.name || 'Selected Camera'}
        initialStartTime={new Date(currentTime.getTime() - 2.5 * 60 * 1000)}
        initialEndTime={new Date(currentTime.getTime() + 2.5 * 60 * 1000)}
        apiBaseUrl={apiBaseUrl}
        authToken={effectiveToken}
      />

      {/* Bookmark Modal */}
      <BookmarkModal
        isOpen={isBookmarkModalOpen}
        onClose={() => setIsBookmarkModalOpen(false)}
        onSaved={fetchBookmarks}
        cameraId={selectedCameraId}
        cameraName={selectedCamera?.name || 'Selected Camera'}
        timestamp={currentTime}
        apiBaseUrl={apiBaseUrl}
        authToken={effectiveToken}
      />

      {/* Smart Motion Search Modal */}
      <SmartMotionSearchModal
        isOpen={isMotionSearchOpen}
        onClose={() => setIsMotionSearchOpen(false)}
        cameras={cameras}
        selectedCameraId={selectedCameraId}
        currentPlaybackTime={currentTime}
        apiBaseUrl={apiBaseUrl}
        authToken={effectiveToken}
        onSelectTime={(time) => {
          handleMasterSeek(time);
        }}
      />
    </div>
  );
};

export default PlaybackPage;
