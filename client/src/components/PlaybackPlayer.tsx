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
        <div className="flex flex-col items-center justify-center text-slate-500 gap-3 p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-[#111827] border border-[#1f2937] flex items-center justify-center">
            <Film className="w-8 h-8 text-[#4fc3f7]/60" />
          </div>
          <p className="text-sm font-bold text-slate-200">No Recording Segment Selected</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Select a camera above and seek on the blue 24-hour timeline below to start instant zero-transcode fMP4 playback.
          </p>
        </div>
      )}

      {/* Buffering Spinner in Ion Blue */}
      {isBuffering && (
        <div className="absolute inset-0 bg-[#090d16]/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <Loader2 className="w-10 h-10 text-[#4fc3f7] animate-spin" />
        </div>
      )}

      {/* Error Overlay */}
      {playbackError && (
        <div className="absolute inset-0 bg-[#090d16]/90 flex flex-col items-center justify-center p-4 text-center border border-red-900/50">
          <AlertCircle className="w-10 h-10 text-[#fb923c] mb-2" />
          <p className="text-sm font-bold text-slate-100">{playbackError}</p>
        </div>
      )}

      {/* Camera Name Tag & Playing Indicator */}
      {cameraName && (
        <div className="absolute top-3 left-3 bg-[#111827]/90 backdrop-blur-sm border border-[#1f2937] px-3 py-1.5 rounded-md text-xs font-bold text-slate-100 pointer-events-none flex items-center gap-2 shadow-lg">
          <span className="w-2.5 h-2.5 rounded-full bg-[#4fc3f7] shadow-[0_0_6px_#4fc3f7] animate-pulse" />
          <span>{cameraName}</span>
        </div>
      )}
    </div>
  );
};

export default PlaybackPlayer;
