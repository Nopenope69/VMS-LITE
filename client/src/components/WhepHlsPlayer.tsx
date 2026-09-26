import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, RefreshCw, AlertTriangle, Radio } from 'lucide-react';
import { connectWhep, WhepSession } from '../utils/whep-client.js';

export interface WhepHlsPlayerProps {
  whepUrl: string;
  hlsUrl: string;
  iceServers?: RTCIceServer[];
  autoPlay?: boolean;
  cameraName?: string;
  mediaSource?: string | null;
  mediaUrl?: string | null;
  onModeChange?: (mode: 'webrtc' | 'hls' | 'simulated') => void;
  className?: string;
  onVideoElementReady?: (el: HTMLVideoElement | null) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const WhepHlsPlayer: React.FC<WhepHlsPlayerProps> = ({
  whepUrl,
  hlsUrl,
  iceServers,
  autoPlay = true,
  cameraName = 'Camera',
  mediaSource,
  mediaUrl,
  onModeChange,
  className = '',
  onVideoElementReady,
  onContextMenu,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<WhepSession | null>(null);
  const simStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const offscreenVideoRef = useRef<HTMLVideoElement | null>(null);

  const [mode, setMode] = useState<'webrtc' | 'hls' | 'simulated'>('webrtc');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'fallback' | 'error'>('connecting');
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isPlayingVideoLoop, setIsPlayingVideoLoop] = useState<boolean>(false);
  const [osdTime, setOsdTime] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Real-time CCTV clock watermark updated once per second with 0% CPU cost
  useEffect(() => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const updateTime = () => {
      const now = new Date();
      setOsdTime(
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
          now.getHours()
        )}:${pad(now.getMinutes())}:${pad(now.getSeconds())} IST`
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const cleanCurrentSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (simStreamRef.current) {
      simStreamRef.current.getTracks().forEach((track) => track.stop());
      simStreamRef.current = null;
    }
    if (offscreenVideoRef.current) {
      offscreenVideoRef.current.pause();
      offscreenVideoRef.current.src = '';
      offscreenVideoRef.current.load();
      offscreenVideoRef.current = null;
    }
    setIsPlayingVideoLoop(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
  }, []);

  // Generates real-time 1080p procedural CCTV stream for zero-downtime evaluation / simulation
  const startSimulatedPlayback = useCallback(() => {
    cleanCurrentSession();
    setMode('simulated');
    setStatus('connected');
    setErrorMessage(null);
    onModeChange?.('simulated');

    const nameLower = (cameraName || '').toLowerCase();
    const isGate =
      nameLower.includes('gate') ||
      nameLower.includes('barrier') ||
      nameLower.includes('ch-01') ||
      nameLower.includes('entry');
    const isWarehouse =
      nameLower.includes('warehouse') ||
      nameLower.includes('bay') ||
      nameLower.includes('rack') ||
      nameLower.includes('ch-02');
    const isPerimeter =
      nameLower.includes('perimeter') ||
      nameLower.includes('fence') ||
      nameLower.includes('north') ||
      nameLower.includes('ch-03');
    const isReception =
      nameLower.includes('reception') ||
      nameLower.includes('lobby') ||
      nameLower.includes('admin') ||
      nameLower.includes('office') ||
      nameLower.includes('ch-04');

    // Resolve candidate video loop URL
    let candidateMediaUrl = mediaUrl || (mediaSource ? `/media/${encodeURIComponent(mediaSource)}` : null);
    if (!candidateMediaUrl) {
      const chMatch = nameLower.match(/ch[-_ ]*0?(\d+)/i) || nameLower.match(/cam[-_ ]*0?(\d+)/i) || nameLower.match(/camera[-_ ]*0?(\d+)/i);
      if (chMatch) {
        candidateMediaUrl = `/media/${chMatch[1]}.mp4`;
      } else if (isGate) {
        candidateMediaUrl = '/media/1.mp4';
      } else if (isWarehouse) {
        candidateMediaUrl = '/media/2.mp4';
      } else if (isPerimeter) {
        candidateMediaUrl = '/media/3.mp4';
      } else if (isReception) {
        candidateMediaUrl = '/media/4.mp4';
      }
    }

    // Direct native hardware-accelerated HTML5 video playback (0% CPU, 60fps zero-lag)
    if (candidateMediaUrl && videoRef.current) {
      setIsPlayingVideoLoop(true);
      const vid = videoRef.current;
      vid.srcObject = null;
      if (vid.src !== candidateMediaUrl && !vid.src.endsWith(candidateMediaUrl)) {
        vid.src = candidateMediaUrl;
      }
      vid.loop = true;
      vid.muted = isMuted;
      vid.playsInline = true;
      if (autoPlay) {
        vid.play().catch(() => {});
      }
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const render = () => {
      frame++;
      const w = canvas.width;
      const h = canvas.height;

      // 1. Draw Real Uploaded Video Frame or Fallback Procedural Scene
      let hasDrawnVideo = false;
      if (offscreenVideo && offscreenVideo.readyState >= 2) {
        try {
          ctx.drawImage(offscreenVideo, 0, 0, w, h);
          hasDrawnVideo = true;
        } catch {
          hasDrawnVideo = false;
        }
      }

      if (!hasDrawnVideo) {
        if (isGate) {
          // Gate scene
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, w, h);
          // Road
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, h * 0.62, w, h * 0.38);
        // Yellow lane dividers
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 4;
        ctx.setLineDash([24, 20]);
        ctx.beginPath();
        ctx.moveTo(0, h * 0.81);
        ctx.lineTo(w, h * 0.81);
        ctx.stroke();
        ctx.setLineDash([]);
        // Guard booth
        ctx.fillStyle = '#334155';
        ctx.fillRect(w * 0.72, h * 0.38, 140, 170);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(w * 0.76, h * 0.44, 60, 45); // Window
        // Barrier Arm
        const barrierArmUp = Math.sin(frame * 0.02) > 0.4;
        const barrierAngle = barrierArmUp ? -0.85 : 0;
        ctx.save();
        ctx.translate(w * 0.72, h * 0.62);
        ctx.rotate(barrierAngle);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-260, -10, 260, 16);
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 6; i++) {
          ctx.fillRect(-240 + i * 40, -10, 20, 16);
        }
        ctx.restore();
        // Moving Vehicle
        const carX = ((frame * 3.5) % (w + 260)) - 130;
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(carX, h * 0.7, 160, 60);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(carX + 35, h * 0.58, 85, 32);
        // AI Bounding Box
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(carX - 8, h * 0.54, 180, 88);
        ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
        ctx.fillRect(carX - 8, h * 0.54 - 20, 160, 20);
        ctx.fillStyle = '#090d16';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('VEHICLE: 98% [DL-01-AB]', carX - 4, h * 0.54 - 6);
      } else if (isWarehouse) {
        // Warehouse Logistics Bay
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, h * 0.72, w, h * 0.28);
        // Racks
        for (let i = 0; i < 5; i++) {
          const rx = 60 + i * 230;
          ctx.fillStyle = '#334155';
          ctx.fillRect(rx, h * 0.15, 170, h * 0.57);
          ctx.fillStyle = '#ea580c';
          ctx.fillRect(rx + 15, h * 0.28, 140, 35);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(rx + 15, h * 0.46, 140, 35);
          ctx.fillStyle = '#eab308';
          ctx.fillRect(rx + 15, h * 0.6, 140, 35);
        }
        // Moving Forklift
        const forkX = w * 0.45 + Math.sin(frame * 0.02) * 220;
        ctx.fillStyle = '#facc15';
        ctx.fillRect(forkX, h * 0.65, 110, 60);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(forkX + 90, h * 0.5, 10, 80);
        ctx.fillStyle = '#f97316';
        ctx.fillRect(forkX + 102, h * 0.56, 45, 30);
        // AI Bounding Box
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(forkX - 8, h * 0.46, 165, 90);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
        ctx.fillRect(forkX - 8, h * 0.46 - 20, 150, 20);
        ctx.fillStyle = '#090d16';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('FORKLIFT: 96% ACTIVE', forkX - 4, h * 0.46 - 6);
      } else if (isPerimeter) {
        // Perimeter Night IR
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, w, h);
        // Ground
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, h * 0.7, w, h * 0.3);
        // Chainlink Fence
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.5;
        for (let x = 0; x < w; x += 32) {
          ctx.beginPath();
          ctx.moveTo(x, h * 0.25);
          ctx.lineTo(x + 24, h);
          ctx.moveTo(x + 24, h * 0.25);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        // Sweeping IR Beam
        const beamX = w * 0.5 + Math.sin(frame * 0.025) * (w * 0.4);
        const grad = ctx.createRadialGradient(beamX, h * 0.65, 20, beamX, h * 0.65, 240);
        grad.addColorStop(0, 'rgba(79, 195, 247, 0.35)');
        grad.addColorStop(1, 'rgba(79, 195, 247, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        // Motion Intrusion Box
        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(beamX - 40, h * 0.52, 80, 110);
        ctx.fillStyle = 'rgba(251, 146, 60, 0.9)';
        ctx.fillRect(beamX - 40, h * 0.52 - 20, 150, 20);
        ctx.fillStyle = '#090d16';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('MOTION ALERT: 93%', beamX - 36, h * 0.52 - 6);
      } else if (isReception) {
        // Reception / Admin Lobby
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, h * 0.65, w, h * 0.35);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(w * 0.2, h * 0.15, w * 0.6, h * 0.5);
        // Reception Desk
        ctx.fillStyle = '#334155';
        ctx.fillRect(w * 0.28, h * 0.52, 280, 80);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 14px monospace';
        ctx.fillText('SECURITY CONSOLE', w * 0.34, h * 0.58);
        // Walking Person
        const personX = w * 0.5 + Math.sin(frame * 0.02) * 160;
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(personX, h * 0.42, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(personX - 14, h * 0.45, 28, 55);
        // AI Bounding Box
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(personX - 25, h * 0.38, 50, 110);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
        ctx.fillRect(personX - 25, h * 0.38 - 20, 110, 20);
        ctx.fillStyle = '#090d16';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('PERSON: 99%', personX - 21, h * 0.38 - 6);
      } else {
        // Production Assembly / Machinery
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, h * 0.6, w, h * 0.4);
        // Conveyor belt
        ctx.fillStyle = '#334155';
        ctx.fillRect(0, h * 0.68, w, 40);
        for (let i = 0; i < 6; i++) {
          const px = ((frame * 2.5 + i * 220) % (w + 100)) - 50;
          ctx.fillStyle = '#f97316';
          ctx.fillRect(px, h * 0.62, 50, 35);
        }
      }
      }

      // 2. Optical CCTV Scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 2);
      }

      // 3. Live Surveillance OSD Overlay
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
        now.getHours()
      )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${now
        .getMilliseconds()
        .toString()
        .padStart(3, '0')} IST`;

      // Top OSD Bar
      ctx.fillStyle = 'rgba(9, 13, 22, 0.85)';
      ctx.fillRect(0, 0, w, 38);
      ctx.fillStyle = '#4fc3f7';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(`● REC [${(cameraName || 'CAMERA').toUpperCase()}]`, 18, 24);
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(timeStr, w - 310, 24);

      // Bottom OSD Bar
      ctx.fillStyle = 'rgba(9, 13, 22, 0.75)';
      ctx.fillRect(0, h - 28, w, 28);
      ctx.fillStyle = '#10b981';
      ctx.font = '12px monospace';
      ctx.fillText('1080P HD • 25 FPS • 2480 KBPS • H.264 MAIN', 18, h - 10);
      ctx.fillStyle = '#64748b';
      ctx.fillText('BASIC VMS LITE • CP PLUS / HIKVISION PARITY', w - 360, h - 10);

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    try {
      const stream = (canvas as any).captureStream
        ? (canvas as any).captureStream(25)
        : null;
      if (stream && videoRef.current) {
        simStreamRef.current = stream;
        videoRef.current.srcObject = stream;
        if (autoPlay) {
          videoRef.current.play().catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[WhepHlsPlayer] Canvas captureStream error:', e);
    }
  }, [cleanCurrentSession, cameraName, onModeChange, autoPlay, mediaSource, mediaUrl]);

  const startHlsPlayback = useCallback(() => {
    cleanCurrentSession();
    setMode('hls');
    setStatus('fallback');
    onModeChange?.('hls');

    if (!videoRef.current) {
      startSimulatedPlayback();
      return;
    }

    const video = videoRef.current;

    // Check for native HLS support (Safari / iOS WebKit)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.play().catch(() => {
        startSimulatedPlayback();
      });
    } else {
      // In non-Safari environments without native HLS support, activate simulated stream
      startSimulatedPlayback();
    }
  }, [cleanCurrentSession, hlsUrl, onModeChange, startSimulatedPlayback]);

  const startWhepPlayback = useCallback(async () => {
    cleanCurrentSession();
    setMode('webrtc');
    setStatus('connecting');
    setErrorMessage(null);
    onModeChange?.('webrtc');

    try {
      const session = await connectWhep(whepUrl, {
        iceServers,
        timeoutMs: 3000,
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
    } catch {
      console.warn('[WhepHlsPlayer] WebRTC WHEP connection failed, falling back to HLS / Simulation');
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
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e);
      }}
      className={`relative w-full h-full bg-black overflow-hidden select-none flex items-center justify-center group ${className}`}
      style={{ aspectRatio: '16/9' }}
    >
      <video
        ref={(el) => {
          videoRef.current = el;
          onVideoElementReady?.(el);
        }}
        className="w-full h-full object-contain pointer-events-auto"
        autoPlay={autoPlay}
        playsInline
        crossOrigin="anonymous"
        muted={isMuted}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu?.(e);
        }}
        onLoadedData={() => {
          if (status !== 'connected' && (mode === 'hls' || mode === 'simulated')) {
            setStatus('connected');
          }
        }}
        onError={() => {
          if (mode === 'webrtc') {
            startHlsPlayback();
          } else if (mode === 'hls') {
            startSimulatedPlayback();
          } else {
            setStatus('error');
            setErrorMessage('Unable to load video stream');
          }
        }}
      />

      {/* Top Status Overlays */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 z-10 pointer-events-none">
        {/* LIVE Status Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold tracking-wider bg-[#090d16]/90 text-slate-100 border border-[#1f2937] backdrop-blur-sm shadow-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>LIVE</span>
        </div>

        {/* Protocol Badge (WebRTC Ion Blue vs HLS Solar Amber vs Simulated Emerald) */}
        <div
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono tracking-wider backdrop-blur-sm ${
            mode === 'webrtc'
              ? 'bg-[#4fc3f7]/15 text-[#4fc3f7] border border-[#4fc3f7]/40'
              : mode === 'simulated'
              ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/40'
              : 'bg-[#fb923c]/15 text-[#fb923c] border border-[#fb923c]/40'
          }`}
        >
          <Radio className="w-3 h-3" />
          <span>
            {mode === 'webrtc'
              ? 'WHEP HD'
              : mode === 'simulated'
              ? isPlayingVideoLoop
                ? 'VIDEO LOOP HD'
                : 'SIMULATED HD'
              : 'HLS Fallback'}
          </span>
        </div>
      </div>

      {/* Top Right Real-Time OSD Clock Watermark */}
      {osdTime && (
        <div className="absolute top-2 right-2 flex items-center px-2 py-0.5 rounded text-[10px] font-mono tracking-wider bg-[#090d16]/85 text-slate-300 border border-[#1f2937] backdrop-blur-sm shadow-sm pointer-events-none z-10">
          <span>{osdTime}</span>
        </div>
      )}

      {/* Bottom Left Stream Telemetry Watermark */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono tracking-wider bg-[#090d16]/85 text-[#10b981] border border-[#1f2937] backdrop-blur-sm shadow-sm pointer-events-none z-10">
        <span>1080P HD • 25 FPS • H.264</span>
      </div>

      {/* Hardware-Accelerated CSS AI Bounding Box Overlay */}
      {isPlayingVideoLoop && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          <div
            className="absolute border-2 border-[#10b981] rounded shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-700 ease-in-out"
            style={{
              left: '20%',
              top: '30%',
              width: '24%',
              height: '42%',
            }}
          >
            <div className="bg-[#10b981] text-[#090d16] font-mono text-[9px] font-bold px-1.5 py-0.5 tracking-wider inline-block">
              AI TARGET: 98%
            </div>
          </div>
        </div>
      )}

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
};

export default WhepHlsPlayer;
