import React from 'react';
import {
  Shield,
  Video,
  Calendar,
  Radio,
  AlertCircle,
  RefreshCw,
  Film,
} from 'lucide-react';
import { TimelineScrubber } from '../components/TimelineScrubber.js';
import { PlaybackControls } from '../components/PlaybackControls.js';
import { PlaybackPlayer } from '../components/PlaybackPlayer.js';
import {
  usePlaybackSession,
  CameraOption,
} from '../hooks/usePlaybackSession.js';

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
    authToken,
  });

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
