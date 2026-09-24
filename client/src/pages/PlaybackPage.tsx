import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield,
  Video,
  Calendar,
  Radio,
  AlertCircle,
  RefreshCw,
  Film,
} from 'lucide-react';
import { TimelineScrubber, TimelineSpan } from '../components/TimelineScrubber.js';
import { PlaybackControls } from '../components/PlaybackControls.js';
import { PlaybackPlayer } from '../components/PlaybackPlayer.js';

export interface CameraOption {
  id: string;
  name: string;
  mediaMtxPath?: string;
}

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
  // Today's date in YYYY-MM-DD
  const getTodayString = (): string => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayString());
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [timelineSpans, setTimelineSpans] = useState<TimelineSpan[]>([]);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamStartTime, setStreamStartTime] = useState<Date | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Common request headers with Auth
  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  }, [authToken]);

  // Fetch camera list on mount
  const fetchCameras = useCallback(async () => {
    try {
      let res = await fetch(`${apiBaseUrl}/api/cameras`, { headers: authHeaders });
      if (!res.ok) {
        // Fallback to streaming config if /api/cameras is not directly available
        res = await fetch(`${apiBaseUrl}/api/streaming/config`, { headers: authHeaders });
      }
      if (!res.ok) {
        throw new Error(`Failed to load camera list: HTTP ${res.status}`);
      }

      const data = await res.json();
      const list: CameraOption[] = Array.isArray(data)
        ? data.map((c: any) => ({ id: c.id, name: c.name, mediaMtxPath: c.mediaMtxPath }))
        : (data.cameras || []).map((c: any) => ({ id: c.id, name: c.name, mediaMtxPath: c.mediaMtxPath }));

      setCameras(list);
      if (list.length > 0 && !selectedCameraId) {
        setSelectedCameraId(list[0].id);
      }
    } catch (err: any) {
      console.warn('Error loading camera list:', err);
    }
  }, [apiBaseUrl, authHeaders, selectedCameraId]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  // Fetch 24-hour recorded spans for the selected camera & date
  const fetchTimeline = useCallback(async () => {
    if (!selectedCameraId) return;
    setIsLoading(true);
    setError(null);

    try {
      const url = `${apiBaseUrl}/api/playback/timeline?cameraId=${encodeURIComponent(
        selectedCameraId
      )}&date=${encodeURIComponent(selectedDate)}`;

      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) {
        throw new Error(`Failed to fetch timeline: HTTP ${res.status}`);
      }

      const data = await res.json();
      const spans: TimelineSpan[] = (data.spans || []).map((s: any) => ({
        startTime: s.startTime,
        endTime: s.endTime,
        durationSeconds: s.durationSeconds,
        recordingId: s.recordingId,
      }));

      setTimelineSpans(spans);

      // If current time is not within selectedDate, set playhead to first span or date 00:00:00
      const dayStart = new Date(`${selectedDate}T00:00:00`);
      if (spans.length > 0) {
        const firstSpanStart = new Date(spans[0].startTime);
        setCurrentTime(firstSpanStart);
      } else {
        setCurrentTime(dayStart);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading timeline recordings');
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, selectedCameraId, selectedDate]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  // Request fMP4 stream URL from MediaMTX playback server
  const loadStreamForTimestamp = useCallback(
    async (seekDate: Date) => {
      if (!selectedCameraId) return;

      try {
        const isoTimestamp = seekDate.toISOString();
        const duration = 300; // 5-minute chunk window for smooth playback
        const res = await fetch(
          `${apiBaseUrl}/api/playback/stream?cameraId=${encodeURIComponent(
            selectedCameraId
          )}&startTime=${encodeURIComponent(isoTimestamp)}&duration=${duration}`,
          { headers: authHeaders }
        );

        if (!res.ok) {
          throw new Error(`Failed to resolve playback stream: HTTP ${res.status}`);
        }

        const data = await res.json();
        setStreamUrl(data.fmp4StreamUrl);
        setStreamStartTime(seekDate);
      } catch (err: any) {
        console.error('Failed to resolve stream URL:', err);
      }
    },
    [apiBaseUrl, authHeaders, selectedCameraId]
  );

  // Seek handler from timeline scrubber (PLAY-02)
  const handleSeek = useCallback(
    (seekTime: Date) => {
      setCurrentTime(seekTime);
      loadStreamForTimestamp(seekTime);
      setIsPlaying(true);
    },
    [loadStreamForTimestamp]
  );

  // Stepping -5s / +5s handler (PLAY-04)
  const handleStep = useCallback(
    (seconds: number) => {
      const newMs = currentTime.getTime() + seconds * 1000;
      const newDate = new Date(newMs);
      setCurrentTime(newDate);
      loadStreamForTimestamp(newDate);
    },
    [currentTime, loadStreamForTimestamp]
  );

  // Toggle play/pause (PLAY-04)
  const handleTogglePlay = () => {
    if (!streamUrl && timelineSpans.length > 0) {
      // Seek to current playhead if not yet streaming
      handleSeek(currentTime);
    } else {
      setIsPlaying((prev) => !prev);
    }
  };

  // Video playback time update
  const handleVideoTimeUpdate = (currentTimeSeconds: number) => {
    if (streamStartTime) {
      const updatedMs = streamStartTime.getTime() + currentTimeSeconds * 1000;
      setCurrentTime(new Date(updatedMs));
    }
  };

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);

  return (
    <div className="flex flex-col w-screen h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Top Application Header */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold tracking-tight text-sm text-zinc-100">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span>BASIC VMS</span>
          </div>
          <span className="text-zinc-600">|</span>
          <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-medium">
            <Film className="w-4 h-4 text-emerald-500" />
            <span>24-Hour Playback & Timeline</span>
          </div>
        </div>

        {/* Center: Camera Selector & Date Picker */}
        <div className="flex items-center gap-3">
          {/* Camera Dropdown */}
          <div className="flex items-center gap-1.5 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800 text-xs">
            <Video className="w-3.5 h-3.5 text-zinc-400" />
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer text-xs"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id} className="bg-zinc-900 text-zinc-100">
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Date Switcher */}
          <div className="flex items-center gap-1.5 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800 text-xs">
            <Calendar className="w-3.5 h-3.5 text-zinc-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer text-xs"
            />
          </div>

          {/* Refresh Timeline */}
          <button
            type="button"
            onClick={fetchTimeline}
            title="Refresh Timeline"
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Right Navigation */}
        <div className="flex items-center gap-2">
          {onNavigateLive && (
            <button
              type="button"
              onClick={onNavigateLive}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-xs font-medium rounded text-zinc-200 transition-colors"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Live View</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Playback Area */}
      <main className="flex-1 w-full relative flex flex-col bg-black overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center">
            <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
            <h2 className="text-base font-semibold text-zinc-200 mb-1">Timeline Retrieval Error</h2>
            <p className="text-xs text-zinc-400 max-w-md mb-4">{error}</p>
            <button
              type="button"
              onClick={fetchTimeline}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium rounded text-zinc-100 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
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

        {/* Timeline Scrubber Container */}
        <div className="w-full bg-zinc-950 px-4 py-3 border-t border-zinc-800 shrink-0">
          <TimelineScrubber
            currentDate={selectedDate}
            currentTime={currentTime}
            spans={timelineSpans}
            onSeek={handleSeek}
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
            onChangeDate={setSelectedDate}
            currentTime={currentTime}
            isLoading={isLoading}
          />
        </div>
      </main>
    </div>
  );
};

export default PlaybackPage;
