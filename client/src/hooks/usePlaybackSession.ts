import { useState, useEffect, useCallback, useMemo } from 'react';
import { TimelineSpan } from '../components/TimelineScrubber.js';

export interface CameraOption {
  id: string;
  name: string;
  mediaMtxPath?: string;
}

export interface UsePlaybackSessionOptions {
  apiBaseUrl?: string;
  authToken?: string;
  initialDate?: string;
  initialCameraId?: string;
  chunkDurationSeconds?: number;
}

export interface PlaybackSessionState {
  cameras: CameraOption[];
  selectedCameraId: string;
  selectedDate: string;
  currentTime: Date;
  timelineSpans: TimelineSpan[];
  streamUrl: string | null;
  streamStartTime: Date | null;
  isPlaying: boolean;
  playbackRate: number;
  isLoading: boolean;
  error: string | null;
  selectedCamera?: CameraOption;
}

export interface PlaybackSessionActions {
  setSelectedCameraId: (id: string) => void;
  setSelectedDate: (date: string) => void;
  setPlaybackRate: (rate: number) => void;
  setIsPlaying: (playing: boolean | ((prev: boolean) => boolean)) => void;
  handleSeek: (seekTime: Date) => void;
  handleStep: (seconds: number) => void;
  handleTogglePlay: () => void;
  handleVideoTimeUpdate: (currentTimeSeconds: number) => void;
  fetchCameras: () => Promise<void>;
  fetchTimeline: () => Promise<void>;
  loadStreamForTimestamp: (seekDate: Date) => Promise<void>;
}

export interface PlaybackSession extends PlaybackSessionState, PlaybackSessionActions {}

export const getTodayString = (now = new Date()): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Headless playback session hook encapsulating the 11 playback state variables,
 * API querying, seek arithmetic, play/pause transitions, and stream chunk loading.
 */
export function usePlaybackSession(options: UsePlaybackSessionOptions = {}): PlaybackSession {
  const {
    apiBaseUrl = '',
    authToken = '',
    initialDate,
    initialCameraId = '',
    chunkDurationSeconds = 300,
  } = options;

  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(initialCameraId);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || getTodayString());
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
        const res = await fetch(
          `${apiBaseUrl}/api/playback/stream?cameraId=${encodeURIComponent(
            selectedCameraId
          )}&startTime=${encodeURIComponent(isoTimestamp)}&duration=${chunkDurationSeconds}`,
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
    [apiBaseUrl, authHeaders, selectedCameraId, chunkDurationSeconds]
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
  const handleTogglePlay = useCallback(() => {
    if (!streamUrl && timelineSpans.length > 0) {
      // Seek to current playhead if not yet streaming
      handleSeek(currentTime);
    } else {
      setIsPlaying((prev) => !prev);
    }
  }, [streamUrl, timelineSpans.length, handleSeek, currentTime]);

  // Video playback time update
  const handleVideoTimeUpdate = useCallback(
    (currentTimeSeconds: number) => {
      if (streamStartTime) {
        const updatedMs = streamStartTime.getTime() + currentTimeSeconds * 1000;
        setCurrentTime(new Date(updatedMs));
      }
    },
    [streamStartTime]
  );

  const selectedCamera = useMemo(
    () => cameras.find((c) => c.id === selectedCameraId),
    [cameras, selectedCameraId]
  );

  return {
    cameras,
    selectedCameraId,
    setSelectedCameraId,
    selectedDate,
    setSelectedDate,
    currentTime,
    timelineSpans,
    streamUrl,
    streamStartTime,
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
    fetchCameras,
    fetchTimeline,
    loadStreamForTimestamp,
  };
}
