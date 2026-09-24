import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, RefreshCw, AlertTriangle, Radio } from 'lucide-react';
import { connectWhep, WhepSession } from '../utils/whep-client.js';

export interface WhepHlsPlayerProps {
  whepUrl: string;
  hlsUrl: string;
  iceServers?: RTCIceServer[];
  autoPlay?: boolean;
  cameraName?: string;
  onModeChange?: (mode: 'webrtc' | 'hls') => void;
  className?: string;
}

export const WhepHlsPlayer: React.FC<WhepHlsPlayerProps> = ({
  whepUrl,
  hlsUrl,
  iceServers,
  autoPlay = true,
  cameraName,
  onModeChange,
  className = '',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<WhepSession | null>(null);

  const [mode, setMode] = useState<'webrtc' | 'hls'>('webrtc');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'fallback' | 'error'>('connecting');
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cleanCurrentSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
  }, []);

  const startHlsPlayback = useCallback(() => {
    cleanCurrentSession();
    setMode('hls');
    setStatus('fallback');
    onModeChange?.('hls');

    if (!videoRef.current) return;

    const video = videoRef.current;

    // Check for native HLS support (Safari / iOS WebKit)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.play().catch(() => {});
    } else {
      // In non-Safari environments without native HLS support, set direct src
      // or hls.js when bundled. Fallback loads direct stream URL
      video.src = hlsUrl;
      video.play().catch(() => {});
    }
  }, [cleanCurrentSession, hlsUrl, onModeChange]);

  const startWhepPlayback = useCallback(async () => {
    cleanCurrentSession();
    setMode('webrtc');
    setStatus('connecting');
    setErrorMessage(null);
    onModeChange?.('webrtc');

    try {
      const session = await connectWhep(whepUrl, {
        iceServers,
        timeoutMs: 6000,
        onConnectionStateChange: (iceState) => {
          if (iceState === 'failed' || iceState === 'disconnected') {
            console.warn(`[WhepHlsPlayer] WebRTC ICE state: ${iceState}, switching to HLS`);
            startHlsPlayback();
          }
        },
      });

      sessionRef.current = session;

      if (videoRef.current) {
        videoRef.current.srcObject = session.stream;
        if (autoPlay) {
          videoRef.current.play().catch((err) => {
            console.warn('[WhepHlsPlayer] Autoplay blocked, requires interaction:', err);
          });
        }
      }

      setStatus('connected');
    } catch (err: any) {
      console.warn('[WhepHlsPlayer] WebRTC WHEP connection failed, falling back to HLS:', err.message);
      startHlsPlayback();
    }
  }, [cleanCurrentSession, whepUrl, iceServers, autoPlay, onModeChange, startHlsPlayback]);

  useEffect(() => {
    startWhepPlayback();
    return () => {
      cleanCurrentSession();
    };
  }, [whepUrl, hlsUrl, startWhepPlayback, cleanCurrentSession]);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  return (
    <div
      className={`relative w-full h-full bg-black overflow-hidden select-none flex items-center justify-center group ${className}`}
      style={{ aspectRatio: '16/9' }}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        autoPlay={autoPlay}
        playsInline
        muted={isMuted}
        onLoadedData={() => {
          if (status !== 'connected' && mode === 'hls') {
            setStatus('connected');
          }
        }}
        onError={() => {
          if (mode === 'webrtc') {
            startHlsPlayback();
          } else {
            setStatus('error');
            setErrorMessage('Unable to load video stream');
          }
        }}
      />

      {/* Top Status Overlays */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 z-10">
        {/* LIVE Status Badge */}
        <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold tracking-wider bg-black/60 text-white backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>LIVE</span>
        </div>

        {/* Protocol Badge (LIVE-01 WebRTC vs LIVE-02 HLS) */}
        <div
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono tracking-wider backdrop-blur-sm ${
            mode === 'webrtc'
              ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
              : 'bg-amber-950/80 text-amber-300 border border-amber-500/30'
          }`}
        >
          <Radio className="w-3 h-3" />
          <span>{mode === 'webrtc' ? 'WebRTC' : 'HLS Fallback'}</span>
        </div>
      </div>

      {/* Bottom Control Overlays */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          type="button"
          onClick={toggleMute}
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white/90 transition-colors backdrop-blur-sm"
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={startWhepPlayback}
          title="Reconnect Stream"
          className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white/90 transition-colors backdrop-blur-sm"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Connecting Overlay */}
      {status === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-20 text-white">
          <RefreshCw className="w-6 h-6 animate-spin text-zinc-400 mb-2" />
          <span className="text-xs text-zinc-400 font-mono">Connecting to live feed...</span>
        </div>
      )}

      {/* Error Overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 z-20 text-white p-4 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mb-2" />
          <span className="text-sm font-medium text-zinc-200">Stream Unavailable</span>
          <span className="text-xs text-zinc-400 mt-1 max-w-xs">{errorMessage || 'Camera stream offline or unreachable'}</span>
          <button
            type="button"
            onClick={startWhepPlayback}
            className="mt-3 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-xs rounded text-zinc-200 transition-colors"
          >
            Retry Connection
          </button>
        </div>
      )}
    </div>
  );
};

export default WhepHlsPlayer;
