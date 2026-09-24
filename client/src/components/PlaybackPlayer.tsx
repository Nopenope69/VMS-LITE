import React, { useRef, useEffect, useState } from 'react';
import { Film, AlertCircle, Loader2 } from 'lucide-react';

export interface PlaybackPlayerProps {
  streamUrl: string | null;
  isPlaying: boolean;
  playbackRate: number;
  onTimeUpdate?: (currentTimeSeconds: number) => void;
  onEnded?: () => void;
  onError?: (errorMessage: string) => void;
  cameraName?: string;
  className?: string;
}

export const PlaybackPlayer: React.FC<PlaybackPlayerProps> = ({
  streamUrl,
  isPlaying,
  playbackRate,
  onTimeUpdate,
  onEnded,
  onError,
  cameraName,
  className = '',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Sync isPlaying with HTML5 video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (isPlaying) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          // Auto-play or codec policy error
          console.warn('[PlaybackPlayer] play() interrupted or failed:', err);
        });
      }
    } else {
      video.pause();
    }
  }, [isPlaying, streamUrl]);

  // Sync playback speed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Handle streamUrl source changes
  useEffect(() => {
    setPlaybackError(null);
    setIsBuffering(Boolean(streamUrl));
  }, [streamUrl]);

  const handleWaiting = () => {
    setIsBuffering(true);
  };

  const handleCanPlay = () => {
    setIsBuffering(false);
  };

  const handleVideoTimeUpdate = () => {
    if (videoRef.current && onTimeUpdate) {
      onTimeUpdate(videoRef.current.currentTime);
    }
  };

  const handleVideoError = () => {
    setIsBuffering(false);
    const errMessage = 'Unable to stream recording segment. Video format or stream unavailable.';
    setPlaybackError(errMessage);
    if (onError) {
      onError(errMessage);
    }
  };

  return (
    <div className={`relative w-full h-full bg-black flex items-center justify-center overflow-hidden ${className}`}>
      {streamUrl ? (
        <video
          ref={videoRef}
          src={streamUrl}
          playsInline
          autoPlay={isPlaying}
          onWaiting={handleWaiting}
          onCanPlay={handleCanPlay}
          onTimeUpdate={handleVideoTimeUpdate}
          onEnded={onEnded}
          onError={handleVideoError}
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-zinc-500 gap-2 p-4 text-center">
          <Film className="w-12 h-12 stroke-[1.2] text-zinc-600" />
          <p className="text-sm font-medium text-zinc-400">No Recording Segment Selected</p>
          <p className="text-xs text-zinc-600 max-w-sm">
            Select a camera and seek to an active recorded interval on the 24-hour timeline below to start playback.
          </p>
        </div>
      )}

      {/* Buffering Spinner */}
      {isBuffering && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
        </div>
      )}

      {/* Error Overlay */}
      {playbackError && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-4 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
          <p className="text-sm font-semibold text-zinc-200">{playbackError}</p>
        </div>
      )}

      {/* Camera Name Tag */}
      {cameraName && (
        <div className="absolute top-3 left-3 bg-zinc-950/80 backdrop-blur-sm border border-zinc-800 px-2.5 py-1 rounded text-xs font-medium text-zinc-200 pointer-events-none flex items-center gap-1.5 shadow">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>{cameraName}</span>
        </div>
      )}
    </div>
  );
};

export default PlaybackPlayer;
