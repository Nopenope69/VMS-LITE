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
import {
  FAILURE_COPY,
  StreamFailure,
  classifyError,
  classifyHttpFailure,
  classifyMediaElementError,
} from '../utils/stream-errors.js';
import type HlsType from 'hls.js';

/** Most specific explanation wins (a codec or permission problem explains a later HLS failure). */
function pickFailure(a: StreamFailure | null, b: StreamFailure): StreamFailure {
  const rank = { unsupported_codec: 4, forbidden: 3, no_stream: 2, unreachable: 1, unknown: 0 } as const;
  return a && rank[a.kind] >= rank[b.kind] ? a : b;
}
import { captureVideoSnapshot } from '../utils/snapshot.js';

export interface WhepHlsPlayerProps {
  whepUrl: string;
  hlsUrl: string;
  iceServers?: RTCIceServer[];
  autoPlay?: boolean;
  cameraName?: string;
  streamProfile?: 'MAIN' | 'SUB';
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
      streamProfile,
      onModeChange,
      className = '',
      enableDigitalZoom = true,
    },
    ref
  ) => {
    // Dual-layer state for zero-black-frame cross-fade
    const [activeLayer, setActiveLayer] = useState<0 | 1>(0);
    const activeLayerRef = useRef<0 | 1>(0);
    activeLayerRef.current = activeLayer;

    // Component lifecycle and load sequence tracking (prevents async WebRTC leaks)
    const isMountedRef = useRef<boolean>(true);
    const loadSequenceRef = useRef<number>(0);
    const layerLoadIdRef = useRef<{ 0: number; 1: number }>({ 0: 0, 1: 0 });
    const isTearingDownRef = useRef<{ 0: boolean; 1: boolean }>({ 0: false, 1: false });
    const layerModeRef = useRef<{ 0: 'webrtc' | 'hls'; 1: 'webrtc' | 'hls' }>({
      0: 'webrtc',
      1: 'webrtc',
    });

    const videoRef0 = useRef<HTMLVideoElement | null>(null);
    const videoRef1 = useRef<HTMLVideoElement | null>(null);
    const sessionRef0 = useRef<WhepSession | null>(null);
    const sessionRef1 = useRef<WhepSession | null>(null);
    const teardownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hasHadPlaybackRef = useRef<boolean>(false);
    const currentActiveUrlRef = useRef<{ whepUrl: string; hlsUrl: string } | null>(null);

    const [mode, setMode] = useState<'webrtc' | 'hls'>('webrtc');
    const [status, setStatus] = useState<'connecting' | 'connected' | 'fallback' | 'error'>('connecting');
    const [isMuted, setIsMuted] = useState<boolean>(true);
    const [failure, setFailure] = useState<StreamFailure | null>(null);
    const whepFailureRef = useRef<StreamFailure | null>(null);
    const hlsRef = useRef<{ 0: HlsType | null; 1: HlsType | null }>({ 0: null, 1: null });

    const destroyHls = (layer: 0 | 1) => {
      hlsRef.current[layer]?.destroy();
      hlsRef.current[layer] = null;
    };

    // Client-side Digital Zoom (1.0x to 4.0x) & Pan (MVP-10)
    const [zoomScale, setZoomScale] = useState<number>(1.0);
    const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [snapshotFeedback, setSnapshotFeedback] = useState<boolean>(false);

    // Sync forwarded ref with active video element
    const updateForwardedRef = useCallback(
      (el: HTMLVideoElement | null) => {
        if (typeof ref === 'function') {
          ref(el);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLVideoElement | null>).current = el;
        }
      },
      [ref]
    );

    const cleanSession = useCallback((layer: 0 | 1) => {
      isTearingDownRef.current[layer] = true;
      layerLoadIdRef.current[layer] = ++loadSequenceRef.current;
      destroyHls(layer);

      if (layer === 0) {
        if (sessionRef0.current) {
          sessionRef0.current.close();
          sessionRef0.current = null;
        }
        if (videoRef0.current) {
          videoRef0.current.srcObject = null;
          videoRef0.current.removeAttribute('src');
        }
      } else {
        if (sessionRef1.current) {
          sessionRef1.current.close();
          sessionRef1.current = null;
        }
        if (videoRef1.current) {
          videoRef1.current.srcObject = null;
          videoRef1.current.removeAttribute('src');
        }
      }
    }, []);

    const loadHlsIntoLayer = useCallback(
      (layer: 0 | 1, targetHlsUrl: string, isInitial: boolean, expectedLoadId?: number) => {
        const currentLoadId = expectedLoadId ?? ++loadSequenceRef.current;
        if (expectedLoadId === undefined) {
          layerLoadIdRef.current[layer] = currentLoadId;
        }

        if (!isMountedRef.current || layerLoadIdRef.current[layer] !== currentLoadId) {
          return;
        }

        isTearingDownRef.current[layer] = false;
        layerModeRef.current[layer] = 'hls';

        // Close any existing session on this layer
        if (layer === 0) {
          if (sessionRef0.current) {
            sessionRef0.current.close();
            sessionRef0.current = null;
          }
          if (videoRef0.current) {
            videoRef0.current.srcObject = null;
          }
        } else {
          if (sessionRef1.current) {
            sessionRef1.current.close();
            sessionRef1.current = null;
          }
          if (videoRef1.current) {
            videoRef1.current.srcObject = null;
          }
        }

        const videoEl = layer === 0 ? videoRef0.current : videoRef1.current;
        if (!videoEl) return;

        setMode('hls');
        onModeChange?.('hls');

        const onHlsPlaying = () => {
          if (!isMountedRef.current || layerLoadIdRef.current[layer] !== currentLoadId) return;

          hasHadPlaybackRef.current = true;
          currentActiveUrlRef.current = { whepUrl: '', hlsUrl: targetHlsUrl };
          setStatus('connected');

          if (activeLayerRef.current !== layer) {
            const oldLayer = activeLayerRef.current;
            setActiveLayer(layer);
            updateForwardedRef(videoEl);

            if (teardownTimerRef.current) {
              clearTimeout(teardownTimerRef.current);
            }
            teardownTimerRef.current = setTimeout(() => {
              cleanSession(oldLayer);
              teardownTimerRef.current = null;
            }, 350);
          } else {
            updateForwardedRef(videoEl);
          }
        };

        const handlePlaying = () => {
          videoEl.removeEventListener('playing', handlePlaying);
          videoEl.removeEventListener('loadeddata', handlePlaying);
          onHlsPlaying();
        };

        videoEl.addEventListener('playing', handlePlaying);
        videoEl.addEventListener('loadeddata', handlePlaying);

        const isCurrent = () => isMountedRef.current && layerLoadIdRef.current[layer] === currentLoadId;
        const fail = (f: StreamFailure) => {
          if (!isCurrent()) return;
          console.warn(`[WhepHlsPlayer] HLS failed on layer ${layer}: ${f.kind}${f.detail ? ` (${f.detail})` : ''}`);
          destroyHls(layer);
          setStatus('error');
          setFailure(pickFailure(whepFailureRef.current, f));
        };

        destroyHls(layer);
        (async () => {
          // Pre-check the playlist so HTTP problems (no stream, no permission) are not
          // misreported later as decode errors by the media element
          try {
            const res = await fetch(targetHlsUrl, { credentials: 'same-origin' });
            if (!res.ok) {
              fail(classifyHttpFailure(res.status, await res.text().catch(() => '')));
              return;
            }
          } catch (err) {
            fail(classifyError(err));
            return;
          }
          if (!isCurrent()) return;

          if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari / iOS / some Android browsers play HLS natively
            videoEl.src = targetHlsUrl;
            videoEl.play().catch(() => {});
            return;
          }

          // Elsewhere (desktop Chrome, Firefox, Edge) use hls.js via MSE, loaded on demand
          const { default: Hls } = await import('hls.js');
          if (!isCurrent()) return;
          if (!Hls.isSupported()) {
            fail({ kind: 'unknown', detail: 'This browser supports neither WebRTC playback nor HLS' });
            return;
          }
          const hls = new Hls({ lowLatencyMode: true, backBufferLength: 30 });
          hlsRef.current[layer] = hls;
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            const code = (data.response as { code?: number } | undefined)?.code;
            if (code) {
              fail(classifyHttpFailure(code));
            } else if (/codec|incompatible/i.test(data.details)) {
              fail({ kind: 'unsupported_codec', detail: data.details });
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              fail({ kind: 'unreachable', detail: data.details });
            } else {
              fail({ kind: 'unknown', detail: data.details });
            }
          });
          hls.loadSource(targetHlsUrl);
          hls.attachMedia(videoEl);
          videoEl.play().catch(() => {});
        })();
      },
      [cleanSession, onModeChange, updateForwardedRef]
    );

    const loadStreamIntoLayer = useCallback(
      async (layer: 0 | 1, targetWhepUrl: string, targetHlsUrl: string, isInitial: boolean) => {
        const loadId = ++loadSequenceRef.current;
        layerLoadIdRef.current[layer] = loadId;
        isTearingDownRef.current[layer] = false;
        layerModeRef.current[layer] = 'webrtc';

        // Close any prior session on this layer before starting new connection
        if (layer === 0) {
          if (sessionRef0.current) {
            sessionRef0.current.close();
            sessionRef0.current = null;
          }
          if (videoRef0.current) {
            videoRef0.current.srcObject = null;
            videoRef0.current.removeAttribute('src');
          }
        } else {
          if (sessionRef1.current) {
            sessionRef1.current.close();
            sessionRef1.current = null;
          }
          if (videoRef1.current) {
            videoRef1.current.srcObject = null;
            videoRef1.current.removeAttribute('src');
          }
        }

        if (isInitial) {
          setStatus('connecting');
        }
        setFailure(null);
        whepFailureRef.current = null;
        destroyHls(layer);

        const videoEl = layer === 0 ? videoRef0.current : videoRef1.current;
        if (!videoEl) return;

        let hasActivated = false;
        const onPlayingTrigger = () => {
          if (hasActivated) return;
          if (!isMountedRef.current || layerLoadIdRef.current[layer] !== loadId) return;

          hasActivated = true;
          hasHadPlaybackRef.current = true;
          currentActiveUrlRef.current = { whepUrl: targetWhepUrl, hlsUrl: targetHlsUrl };
          setStatus('connected');
          setMode('webrtc');
          onModeChange?.('webrtc');

          if (activeLayerRef.current !== layer) {
            // Smoothly cross-fade to incoming layer
            const oldLayer = activeLayerRef.current;
            setActiveLayer(layer);
            updateForwardedRef(videoEl);

            if (teardownTimerRef.current) {
              clearTimeout(teardownTimerRef.current);
            }
            teardownTimerRef.current = setTimeout(() => {
              cleanSession(oldLayer);
              teardownTimerRef.current = null;
            }, 350);
          } else {
            updateForwardedRef(videoEl);
          }
        };

        try {
          const session = await connectWhep(targetWhepUrl, {
            iceServers,
            timeoutMs: 6000,
            onConnectionStateChange: (iceState) => {
              if (!isMountedRef.current || layerLoadIdRef.current[layer] !== loadId) return;
              if (iceState === 'failed' || iceState === 'disconnected') {
                console.warn(`[WhepHlsPlayer] WebRTC ICE state ${iceState} on layer ${layer}, switching to HLS`);
                loadHlsIntoLayer(layer, targetHlsUrl, isInitial, loadId);
              }
            },
          });

          // Guard against stale load or unmounted component during async connectWhep
          if (!isMountedRef.current || layerLoadIdRef.current[layer] !== loadId) {
            console.warn(`[WhepHlsPlayer] In-flight WHEP connection aborted (layer ${layer}, loadId ${loadId}); closing session to prevent leak`);
            session.close();
            return;
          }

          if (layer === 0) sessionRef0.current = session;
          else sessionRef1.current = session;

          videoEl.srcObject = session.stream;
          if (autoPlay) {
            videoEl.play().catch((err) => {
              console.warn('[WhepHlsPlayer] Autoplay prevented:', err);
            });
          }

          const handlePlaying = () => {
            videoEl.removeEventListener('playing', handlePlaying);
            videoEl.removeEventListener('loadeddata', handlePlaying);
            onPlayingTrigger();
          };

          videoEl.addEventListener('playing', handlePlaying);
          videoEl.addEventListener('loadeddata', handlePlaying);
        } catch (err: any) {
          if (!isMountedRef.current || layerLoadIdRef.current[layer] !== loadId) return;
          whepFailureRef.current = classifyError(err);
          console.warn(`[WhepHlsPlayer] WebRTC WHEP connection failed on layer ${layer}, falling back to HLS:`, err.message);
          loadHlsIntoLayer(layer, targetHlsUrl, isInitial, loadId);
        }
      },
      [iceServers, autoPlay, onModeChange, cleanSession, loadHlsIntoLayer, updateForwardedRef]
    );

    // Fail-loud error handler for both active and incoming layers
    const handleLayerError = useCallback(
      (layer: 0 | 1) => {
        if (isTearingDownRef.current[layer]) {
          // Intentional teardown or cleanup; ignore
          return;
        }

        const layerMode = layerModeRef.current[layer];
        console.warn(`[WhepHlsPlayer] Video error on layer ${layer} (mode: ${layerMode})`);

        if (layerMode === 'webrtc') {
          // Attempt fallback to HLS for this layer
          loadHlsIntoLayer(layer, hlsUrl, false);
        } else if (!hlsRef.current[layer]) {
          // Native HLS playback failed (hls.js reports its own errors)
          const videoEl = layer === 0 ? videoRef0.current : videoRef1.current;
          setStatus('error');
          setFailure(pickFailure(whepFailureRef.current, classifyMediaElementError(videoEl?.error?.code)));
        }
      },
      [hlsUrl, loadHlsIntoLayer]
    );

    // Initial load and URL changes with cross-fade
    useEffect(() => {
      if (!whepUrl && !hlsUrl) {
        cleanSession(0);
        cleanSession(1);
        currentActiveUrlRef.current = null;
        return;
      }

      if (
        currentActiveUrlRef.current &&
        currentActiveUrlRef.current.whepUrl === whepUrl &&
        currentActiveUrlRef.current.hlsUrl === hlsUrl
      ) {
        return;
      }

      const isFirstLoad = !hasHadPlaybackRef.current && currentActiveUrlRef.current === null;
      // Alternate target layer to maintain current video during incoming connect
      const targetLayer: 0 | 1 = isFirstLoad ? 0 : activeLayerRef.current === 0 ? 1 : 0;

      if (teardownTimerRef.current) {
        clearTimeout(teardownTimerRef.current);
        teardownTimerRef.current = null;
      }

      loadStreamIntoLayer(targetLayer, whepUrl, hlsUrl, isFirstLoad);
    }, [whepUrl, hlsUrl, loadStreamIntoLayer, cleanSession]);

    // Unmount cleanup: close all sessions and cancel timers
    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
        if (teardownTimerRef.current) {
          clearTimeout(teardownTimerRef.current);
        }
        cleanSession(0);
        cleanSession(1);
      };
    }, [cleanSession]);

    const handleReconnect = useCallback(() => {
      if (whepUrl || hlsUrl) {
        const isInitial = !hasHadPlaybackRef.current;
        const targetLayer: 0 | 1 = activeLayerRef.current === 0 ? 1 : 0;
        loadStreamIntoLayer(targetLayer, whepUrl, hlsUrl, isInitial);
      }
    }, [whepUrl, hlsUrl, loadStreamIntoLayer]);

    const toggleMute = () => {
      setIsMuted((prev) => !prev);
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
      const activeVideo = activeLayer === 0 ? videoRef0.current : videoRef1.current;
      if (activeVideo) {
        const result = captureVideoSnapshot(activeVideo, cameraName);
        if (result.success) {
          setSnapshotFeedback(true);
          setTimeout(() => setSnapshotFeedback(false), 2000);
        }
      }
    };

    const isSubStream = streamProfile === 'SUB' || Boolean(whepUrl && whepUrl.includes('_sub'));

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
        {/* Dual-layer Video Elements with Zero-Black-Frame Opacity Cross-Fade */}
        <video
          ref={videoRef0}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          style={{
            opacity: activeLayer === 0 ? 1 : 0,
            zIndex: activeLayer === 0 ? 2 : 1,
            transition: 'opacity 300ms ease-in-out, transform 75ms ease-out',
            transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${
              panOffset.y / zoomScale
            }px)`,
            transformOrigin: 'center center',
          }}
          autoPlay={autoPlay}
          playsInline
          muted={isMuted || activeLayer !== 0}
          onError={() => handleLayerError(0)}
        />

        <video
          ref={videoRef1}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          style={{
            opacity: activeLayer === 1 ? 1 : 0,
            zIndex: activeLayer === 1 ? 2 : 1,
            transition: 'opacity 300ms ease-in-out, transform 75ms ease-out',
            transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${
              panOffset.y / zoomScale
            }px)`,
            transformOrigin: 'center center',
          }}
          autoPlay={autoPlay}
          playsInline
          muted={isMuted || activeLayer !== 1}
          onError={() => handleLayerError(1)}
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
            <span>
              {mode === 'webrtc'
                ? isSubStream
                  ? 'WHEP SD'
                  : 'WHEP HD'
                : 'HLS Fallback'}
            </span>
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
            onClick={handleReconnect}
            title="Reconnect Stream"
            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded bg-[#111827]/90 hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] transition-colors backdrop-blur-sm shadow-md"
          >
            <RefreshCw className="w-4 h-4 text-[#4fc3f7]" />
          </button>
        </div>

        {/* Connecting Overlay (shown only when no active stream is rendering) */}
        {status === 'connecting' && !hasHadPlaybackRef.current && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d16]/85 z-20 text-slate-200 pointer-events-none">
            <RefreshCw className="w-7 h-7 animate-spin text-[#4fc3f7] mb-2" />
            <span className="text-xs text-[#4fc3f7] font-mono tracking-wide">CONNECTING TO VIDEO FEED...</span>
          </div>
        )}

        {/* Error Overlay */}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090d16]/95 border border-red-900/50 z-20 text-slate-100 p-4 text-center">
            <AlertTriangle className="w-10 h-10 text-[#fb923c] mb-2" />
            <span className="text-sm font-bold text-slate-100 tracking-wide">
              {FAILURE_COPY[failure?.kind ?? 'unknown'].title}
            </span>
            <span className="text-xs text-slate-400 mt-1 max-w-xs">
              {FAILURE_COPY[failure?.kind ?? 'unknown'].hint}
            </span>
            <span className="text-[10px] text-slate-500 mt-1 font-mono">{cameraName}</span>
            <button
              type="button"
              onClick={handleReconnect}
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
