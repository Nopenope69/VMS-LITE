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
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold tracking-wider bg-[#090d16]/90 text-slate-100 border border-[#1f2937] backdrop-blur-sm shadow-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>LIVE</span>
        </div>

        {/* Protocol Badge (WebRTC Ion Blue vs HLS Solar Amber) */}
        <div
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono tracking-wider backdrop-blur-sm ${
            mode === 'webrtc'
              ? 'bg-[#4fc3f7]/15 text-[#4fc3f7] border border-[#4fc3f7]/40'
              : 'bg-[#fb923c]/15 text-[#fb923c] border border-[#fb923c]/40'
          }`}
        >
          <Radio className="w-3 h-3" />
          <span>{mode === 'webrtc' ? 'WHEP HD' : 'HLS Fallback'}</span>
        </div>
      </div>

      {/* Bottom Control Overlays */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
        <button
          type="button"
          onClick={toggleMute}
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-[#111827]/90 hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] transition-colors backdrop-blur-sm shadow-md"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-[#4fc3f7]" />}
        </button>

        <button
          type="button"
          onClick={startWhepPlayback}
          title="Reconnect Stream"
          className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-[#111827]/90 hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] transition-colors backdrop-blur-sm shadow-md"
        >
          <RefreshCw className="w-4 h-4 text-[#4fc3f7]" />
        </button>
      </div>

      {/* Connecting Overlay */}
      {status === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d16]/85 z-20 text-slate-200">
          <RefreshCw className="w-7 h-7 animate-spin text-[#4fc3f7] mb-2" />
          <span className="text-xs text-[#4fc3f7] font-mono tracking-wide">CONNECTING TO VIDEO FEED...</span>
        </div>
      )}

      {/* Error Overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d16]/95 border border-red-900/50 z-20 text-slate-100 p-4 text-center">
          <AlertTriangle className="w-10 h-10 text-[#fb923c] mb-2" />
          <span className="text-sm font-bold text-slate-100 tracking-wide">NO SIGNAL - CAMERA OFFLINE</span>
          <span className="text-xs text-slate-400 mt-1 max-w-xs">{errorMessage || 'Check camera network cable or PoE switch power'}</span>
          <button
            type="button"
            onClick={startWhepPlayback}
            className="mt-3 px-4 py-2 min-h-[40px] bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded transition-colors shadow-lg"
          >
            Retry Video Connection
          </button>
        </div>
      )}
    </div>
  );
};

export default WhepHlsPlayer;
