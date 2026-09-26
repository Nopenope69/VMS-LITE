import React, { useEffect, useRef, useState, useCallback, forwardRef } from 'react';
import {
  Volume2,
  VolumeX,
  RefreshCw,
  AlertTriangle,
  Radio,
  Camera,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import { connectWhep, WhepSession } from '../utils/whep-client.js';
import { captureVideoSnapshot } from '../utils/snapshot.js';

export interface WhepHlsPlayerProps {
  whepUrl: string;
  hlsUrl: string;
  iceServers?: RTCIceServer[];
  autoPlay?: boolean;
  cameraName?: string;
  onModeChange?: (mode: 'webrtc' | 'hls') => void;
  className?: string;
  enableDigitalZoom?: boolean;
}

export const WhepHlsPlayer = forwardRef<HTMLVideoElement, WhepHlsPlayerProps>(
  (
    {
      whepUrl,
      hlsUrl,
      iceServers,
      autoPlay = true,
      cameraName = 'camera',
      onModeChange,
      className = '',
      enableDigitalZoom = true,
    },
    ref
  ) => {
    const internalVideoRef = useRef<HTMLVideoElement | null>(null);
    const sessionRef = useRef<WhepSession | null>(null);

    const [mode, setMode] = useState<'webrtc' | 'hls'>('webrtc');
    const [status, setStatus] = useState<'connecting' | 'connected' | 'fallback' | 'error'>('connecting');
    const [isMuted, setIsMuted] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Client-side Digital Zoom (1.0x to 4.0x) & Pan (MVP-10)
    const [zoomScale, setZoomScale] = useState<number>(1.0);
    const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [snapshotFeedback, setSnapshotFeedback] = useState<boolean>(false);

    // Sync forwarded ref with internal video ref
    const setVideoElement = useCallback(
      (el: HTMLVideoElement | null) => {
        internalVideoRef.current = el;
        if (typeof ref === 'function') {
          ref(el);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLVideoElement | null>).current = el;
        }
      },
      [ref]
    );

    const cleanCurrentSession = useCallback(() => {
      if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
      }
      if (internalVideoRef.current) {
        internalVideoRef.current.srcObject = null;
        internalVideoRef.current.removeAttribute('src');
      }
    }, []);

    const startHlsPlayback = useCallback(() => {
      cleanCurrentSession();
      setMode('hls');
      setStatus('fallback');
      onModeChange?.('hls');

      if (!internalVideoRef.current) return;

      const video = internalVideoRef.current;

      // Check for native HLS support (Safari / iOS WebKit)
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        video.play().catch(() => {});
      } else {
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

        if (internalVideoRef.current) {
          internalVideoRef.current.srcObject = session.stream;
          if (autoPlay) {
            internalVideoRef.current.play().catch((err) => {
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
      if (internalVideoRef.current) {
        internalVideoRef.current.muted = !isMuted;
        setIsMuted(!isMuted);
      }
    };

    // Digital Zoom controls
    const zoomIn = () => {
      if (!enableDigitalZoom) return;
      setZoomScale((prev) => Math.min(4.0, parseFloat((prev + 0.5).toFixed(2))));
    };

    const zoomOut = () => {
      if (!enableDigitalZoom) return;
      setZoomScale((prev) => {
        const next = Math.max(1.0, parseFloat((prev - 0.5).toFixed(2)));
        if (next === 1.0) setPanOffset({ x: 0, y: 0 });
        return next;
      });
    };

    const resetZoom = () => {
      setZoomScale(1.0);
      setPanOffset({ x: 0, y: 0 });
    };

    // Wheel Zoom handler
    const handleWheel = (e: React.WheelEvent) => {
      if (!enableDigitalZoom) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      setZoomScale((prev) => {
        const next = Math.min(4.0, Math.max(1.0, parseFloat((prev + delta).toFixed(2))));
        if (next === 1.0) setPanOffset({ x: 0, y: 0 });
        return next;
      });
    };

    // Mouse Pan handlers (when zoomed > 1.0x)
    const handleMouseDown = (e: React.MouseEvent) => {
      if (!enableDigitalZoom || zoomScale <= 1.0) return;
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
      if (!isDragging || zoomScale <= 1.0) return;
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    // Instant Snapshot handler
    const triggerSnapshot = () => {
      if (internalVideoRef.current) {
        const result = captureVideoSnapshot(internalVideoRef.current, cameraName);
        if (result.success) {
          setSnapshotFeedback(true);
          setTimeout(() => setSnapshotFeedback(false), 2000);
        }
      }
    };

    return (
      <div
        className={`relative w-full h-full bg-black overflow-hidden select-none flex items-center justify-center group ${className}`}
        style={{
          aspectRatio: '16/9',
          cursor: zoomScale > 1.0 ? (isDragging ? 'grabbing' : 'grab') : 'default',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <video
          ref={setVideoElement}
          className="w-full h-full object-contain pointer-events-none transition-transform duration-75"
          style={{
            transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${
              panOffset.y / zoomScale
            }px)`,
            transformOrigin: 'center center',
          }}
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

        {/* Top-Left Status Overlays */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 z-10 pointer-events-none">
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

        {/* Top-Right Digital Zoom Status Badge */}
        {zoomScale > 1.0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10 pointer-events-auto">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0284c7]/80 text-white border border-[#38bdf8] backdrop-blur-sm shadow-md animate-in fade-in duration-150">
              <ZoomIn className="w-3 h-3" />
              <span>{zoomScale.toFixed(1)}x ZOOM</span>
            </div>
            <button
              type="button"
              onClick={resetZoom}
              title="Reset Zoom to 1.0x (or Double-Click)"
              className="p-1 rounded bg-[#111827]/90 hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] backdrop-blur-sm transition-colors text-[10px] font-mono flex items-center gap-1 px-1.5"
            >
              <RotateCcw className="w-3 h-3 text-[#38bdf8]" />
              <span>1x</span>
            </button>
          </div>
        )}

        {/* Snapshot Success Toast Overlay */}
        {snapshotFeedback && (
          <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1 bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 rounded-md text-xs font-semibold backdrop-blur-sm shadow-lg animate-in fade-in duration-200">
            <Camera className="w-3.5 h-3.5 text-emerald-400" />
            <span>Snapshot Saved</span>
          </div>
        )}

        {/* Bottom Control Overlays (shown on hover) */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10 pointer-events-auto">
          {/* Instant Snapshot Button */}
          <button
            type="button"
            onClick={triggerSnapshot}
            title={`Capture Instant JPEG Snapshot (${cameraName})`}
            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-[#111827]/90 hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] transition-colors backdrop-blur-sm shadow-md hover:text-[#38bdf8]"
          >
            <Camera className="w-4 h-4" />
          </button>

          {/* Digital Zoom Controls */}
          {enableDigitalZoom && (
            <>
              <button
                type="button"
                onClick={zoomIn}
                disabled={zoomScale >= 4.0}
                title="Digital Zoom In (or Scroll Wheel Up)"
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-[#111827]/90 hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] transition-colors backdrop-blur-sm shadow-md disabled:opacity-40"
              >
                <ZoomIn className="w-4 h-4 text-[#38bdf8]" />
              </button>
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoomScale <= 1.0}
                title="Digital Zoom Out (or Scroll Wheel Down)"
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-[#111827]/90 hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] transition-colors backdrop-blur-sm shadow-md disabled:opacity-40"
              >
                <ZoomOut className="w-4 h-4 text-[#38bdf8]" />
              </button>
            </>
          )}

          {/* Mute Audio Toggle */}
          <button
            type="button"
            onClick={toggleMute}
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-[#111827]/90 hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] transition-colors backdrop-blur-sm shadow-md"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-[#4fc3f7]" />}
          </button>

          {/* Reconnect Stream */}
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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d16]/85 z-20 text-slate-200 pointer-events-none">
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
  }
);

WhepHlsPlayer.displayName = 'WhepHlsPlayer';

export default WhepHlsPlayer;
