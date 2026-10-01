import React, { useState, useRef, useEffect } from 'react';
import {
  Maximize2,
  Minimize2,
  Video,
  X,
  Layers,
  Compass,
  ShieldAlert,
  Camera,
  Volume2,
  VolumeX,
  Wifi,
  Radio,
  Sliders,
  AlertTriangle,
} from 'lucide-react';
import { WhepHlsPlayer } from './WhepHlsPlayer.js';
import { PtzControlsOverlay } from './PtzControlsOverlay.js';
import { MotionZoneEditorModal } from './MotionZoneEditorModal.js';
import { useAuth } from '../context/AuthContext.js';
import { CameraHealthTelemetry } from '../hooks/useCameraHealth.js';
import { captureVideoSnapshot } from '../utils/snapshot.js';
import { resolveStreamProfile } from '../utils/streamProfileManager.js';
import type {
  ViewMode,
  QualityOverride,
  StreamProfileResolution,
} from '../utils/streamProfileManager.js';

export type { ViewMode, QualityOverride, StreamProfileResolution };

export interface CameraStreamInfo {
  cameraId: string;
  name: string;
  mediaMtxPath: string;
  subStreamPath?: string | null;
  subMediaMtxPath?: string | null;
  whepUrl: string;
  subStreamWhepUrl?: string | null;
  hlsUrl: string;
  subStreamHlsUrl?: string | null;
  rtspUrl?: string;
}

export interface LiveCameraTileProps {
  slotIndex: number;
  camera?: CameraStreamInfo | null;
  telemetry?: CameraHealthTelemetry | null;
  availableCameras?: CameraStreamInfo[];
  onAssignCamera?: (slotIndex: number, camera: CameraStreamInfo) => void;
  onClearSlot?: (slotIndex: number) => void;
  onMaximizeSlot?: (slotIndex: number) => void;
  onNavigatePlayback?: (cameraId: string) => void;
  isMaximized?: boolean;
  viewMode?: ViewMode;
  forceSubStream?: boolean;
  hasMotionAlert?: boolean;
  isMotionBuffering?: boolean;
  canControlPtz?: boolean;
  isAdmin?: boolean;
  iceServers?: RTCIceServer[];
}

export const LiveCameraTile: React.FC<LiveCameraTileProps> = ({
  slotIndex,
  camera,
  telemetry,
  availableCameras = [],
  onAssignCamera,
  onClearSlot,
  onMaximizeSlot,
  onNavigatePlayback,
  isMaximized = false,
  viewMode,
  forceSubStream = false,
  hasMotionAlert = false,
  isMotionBuffering = false,
  canControlPtz = true,
  isAdmin,
  iceServers,
}) => {
  const { isAdmin: authIsAdmin } = useAuth();
  const canEditZones = isAdmin !== undefined ? isAdmin : authIsAdmin;

  const [qualityOverride, setQualityOverride] = useState<QualityOverride>('AUTO');
  const [showPtzOverlay, setShowPtzOverlay] = useState(false);
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isAlertDismissed, setIsAlertDismissed] = useState(false);
  const [timecodeStr, setTimecodeStr] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Synchronized precision centisecond timecode (11:42:19.48)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
      setTimecodeStr(`${h}:${m}:${s}.${ms}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 50);
    return () => clearInterval(interval);
  }, []);

  // Reset alert dismissal when a fresh motion alert arrives
  useEffect(() => {
    if (hasMotionAlert) {
      setIsAlertDismissed(false);
    }
  }, [hasMotionAlert]);

  // Derive effective ViewMode for adaptive stream profile resolution.
  const effectiveViewMode: ViewMode = viewMode
    ? viewMode
    : isMaximized && !forceSubStream
    ? 'FULLSCREEN'
    : 'GRID';

  const subPath =
    camera?.subMediaMtxPath ||
    camera?.subStreamPath ||
    (camera?.subStreamWhepUrl ? `${camera.mediaMtxPath}_sub` : null);

  const streamProfile: StreamProfileResolution | null = camera
    ? resolveStreamProfile({
        viewMode: effectiveViewMode,
        operatorOverride: qualityOverride,
        mainPath: camera.mediaMtxPath,
        subPath,
      })
    : null;

  // Resolve WHEP and HLS stream URLs based on streamProfile
  let whepUrl = '';
  let hlsUrl = '';

  if (camera && streamProfile) {
    if (streamProfile.selectedStream === 'SUB') {
      if (camera.subStreamWhepUrl) {
        whepUrl = camera.subStreamWhepUrl;
      } else {
        const mainWhepSuffix = `/${camera.mediaMtxPath}/whep`;
        if (camera.whepUrl.endsWith(mainWhepSuffix)) {
          const base = camera.whepUrl.slice(0, -mainWhepSuffix.length);
          whepUrl = `${base}/${streamProfile.path}/whep`;
        } else {
          whepUrl = camera.whepUrl;
        }
      }

      if (camera.subStreamHlsUrl) {
        hlsUrl = camera.subStreamHlsUrl;
      } else {
        const mainHlsSuffix = `/${camera.mediaMtxPath}/index.m3u8`;
        if (camera.hlsUrl.endsWith(mainHlsSuffix)) {
          const base = camera.hlsUrl.slice(0, -mainHlsSuffix.length);
          hlsUrl = `${base}/${streamProfile.path}/index.m3u8`;
        } else {
          hlsUrl = camera.hlsUrl;
        }
      }
    } else {
      whepUrl = camera.whepUrl;
      hlsUrl = camera.hlsUrl;
    }
  }

  const channelLabel = `CAM-0${slotIndex + 1}`;
  const displayBitrate = telemetry?.bitrateKbps ? `${(telemetry.bitrateKbps / 1000).toFixed(1)} Mb/s` : '2.4 Mb/s';
  const showMotionIncidentCard = hasMotionAlert && !isAlertDismissed;

  return (
    <div
      className={`group relative rounded-xl overflow-hidden bg-zinc-950 border transition-all duration-200 flex flex-col justify-between shadow-lg h-full w-full ${
        showMotionIncidentCard
          ? 'border-amber-500/50 hover:border-amber-500/70 shadow-[0_0_28px_rgba(245,158,11,0.12)] ring-1 ring-amber-500/30'
          : isMaximized
          ? 'border-emerald-500/50 ring-2 ring-emerald-500/30'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      {/* Video Content Canvas */}
      <div
        onDoubleClick={() => onMaximizeSlot && onMaximizeSlot(slotIndex)}
        title={camera ? 'Double-click to expand or restore full view' : undefined}
        className="absolute inset-0 w-full h-full bg-black flex items-center justify-center cursor-pointer select-none overflow-hidden"
      >
        {camera ? (
          <>
            <WhepHlsPlayer
              ref={videoRef}
              key={camera.cameraId}
              whepUrl={whepUrl}
              hlsUrl={hlsUrl}
              iceServers={iceServers}
              cameraName={camera.name}
              streamProfile={streamProfile?.selectedStream}
            />

            {/* Subtle cinematic surveillance vignette overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/65 pointer-events-none z-10" />

            {/* Floating PTZ Controls HUD */}
            {showPtzOverlay && canControlPtz && (
              <PtzControlsOverlay
                cameraId={camera.cameraId}
                cameraName={camera.name}
                onClose={() => setShowPtzOverlay(false)}
                isMaximized={isMaximized}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center z-10">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 mb-3 shadow-md">
              <span className="material-symbols-outlined text-[24px]">videocam_off</span>
            </div>
            <span className="text-xs font-semibold text-zinc-300 mb-1">
              Slot {slotIndex + 1} Unassigned
            </span>
            <span className="text-[11px] text-zinc-500 max-w-xs mb-3">
              Assign an ONVIF or RTSP stream to this viewport
            </span>
            {availableCameras.length > 0 && onAssignCamera && (
              <select
                className="bg-zinc-900 border border-white/10 text-zinc-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500/60 transition-colors shadow-sm"
                defaultValue=""
                onChange={(e) => {
                  const selectedId = e.target.value;
                  const cam = availableCameras.find((c) => c.cameraId === selectedId);
                  if (cam) {
                    onAssignCamera(slotIndex, cam);
                  }
                }}
              >
                <option value="" disabled>
                  + Assign camera feed...
                </option>
                {availableCameras.map((cam) => (
                  <option key={cam.cameraId} value={cam.cameraId}>
                    {cam.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Top Overlay: Camera Title HUD Chip & Synchronized Clock */}
      <div className="relative z-20 p-3 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md hud-chip text-xs pointer-events-auto">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              telemetry?.status === 'DEGRADED'
                ? 'bg-amber-400 animate-pulse'
                : telemetry?.status === 'OFFLINE'
                ? 'bg-rose-500 animate-ping'
                : 'bg-emerald-400'
            }`}
          />
          <span className="font-semibold text-zinc-100 tracking-tight truncate max-w-[160px] sm:max-w-[200px]">
            {camera ? `${slotIndex + 1 < 10 ? `0${slotIndex + 1}` : slotIndex + 1} · ${camera.name}` : `Slot ${slotIndex + 1}`}
          </span>
          <span className="text-[10px] text-zinc-400 bg-white/5 px-1.5 py-0.5 rounded font-mono border border-white/5">
            {channelLabel}
          </span>
        </div>

        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md hud-chip text-xs tabular-nums text-zinc-300 pointer-events-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-[10px] font-semibold text-rose-300">
            {hasMotionAlert ? 'REC (MOTION)' : 'REC'}
          </span>
          <span className="text-zinc-600">|</span>
          <span className="live-timecode text-zinc-300 font-mono text-[11px]">
            {timecodeStr || '11:42:19.48'}
          </span>
        </div>
      </div>

      {/* Linear / Verkada Style Motion Incident Card (Promoted in center when active) */}
      {showMotionIncidentCard && (
        <div className="relative z-30 mx-4 my-auto max-w-sm alert-glass border border-amber-500/30 rounded-lg p-3 shadow-2xl flex items-center justify-between gap-3 animate-in fade-in zoom-in-95 pointer-events-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 shrink-0">
              <span className="material-symbols-outlined text-[16px]">sensors</span>
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-zinc-100 truncate">Motion detected</span>
                <span className="text-[10px] text-amber-400 tabular-nums font-mono">· Active</span>
              </div>
              <span className="text-[11px] text-zinc-400 truncate">
                {camera?.name || 'Camera'} · Zone Triggered
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onNavigatePlayback && camera && (
              <button
                type="button"
                onClick={() => onNavigatePlayback(camera.cameraId)}
                className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs transition-colors shadow-sm"
              >
                Review Clip
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsAlertDismissed(true)}
              className="px-2 py-1 rounded hover:bg-white/10 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Bottom Overlay & Controls Strip */}
      <div className="relative z-20 p-3 flex items-end justify-between pointer-events-none">
        {/* Left Telemetry Chips */}
        <div className="flex items-center gap-1.5 flex-wrap pointer-events-auto">
          <span className="px-2 py-0.5 rounded-md hud-chip text-[11px] font-mono text-zinc-300 tabular-nums">
            {streamProfile?.selectedStream === 'SUB' ? '720p · 25fps' : '1080p · 30fps'}
          </span>
          <span className="px-2 py-0.5 rounded-md hud-chip text-[11px] font-mono text-emerald-300 tabular-nums flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px] text-emerald-400">wifi</span>
            {displayBitrate}
          </span>
          {/* Quality override pill */}
          {streamProfile && !streamProfile.isHdOnly && (
            <div className="flex items-center hud-chip rounded-md p-0.5 text-[10px] font-mono font-bold select-none">
              {(['AUTO', 'SD', 'HD'] as const).map((q) => {
                const isSelected = qualityOverride === q;
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQualityOverride(q)}
                    className={`px-1.5 py-0.5 rounded transition-all ${
                      isSelected
                        ? 'bg-emerald-500 text-zinc-950 font-bold shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {q}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Hover Control Strip */}
        <div className="flex items-center gap-1 hud-chip p-1 rounded-lg opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all duration-150 pointer-events-auto">
          {/* Instant Snapshot */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (videoRef.current && camera) {
                captureVideoSnapshot(videoRef.current, camera.name);
              }
            }}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Snapshot"
          >
            <span className="material-symbols-outlined text-[15px]">photo_camera</span>
          </button>

          {/* Audio toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsAudioMuted(!isAudioMuted);
              if (videoRef.current) {
                videoRef.current.muted = !isAudioMuted;
              }
            }}
            className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors"
            title={isAudioMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            <span className="material-symbols-outlined text-[15px]">
              {isAudioMuted ? 'volume_off' : 'volume_up'}
            </span>
          </button>

          {/* PTZ Controls */}
          {canControlPtz && camera && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowPtzOverlay(!showPtzOverlay);
              }}
              className={`w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center transition-colors ${
                showPtzOverlay ? 'text-emerald-400 bg-white/10' : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title="PTZ Controls"
            >
              <span className="material-symbols-outlined text-[15px]">control_camera</span>
            </button>
          )}

          {/* Motion Zones Modal (Admin) */}
          {canEditZones && camera && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowZoneModal(true);
              }}
              className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-emerald-400 transition-colors"
              title="Configure Motion Zones"
            >
              <span className="material-symbols-outlined text-[15px]">tune</span>
            </button>
          )}

          <div className="h-3.5 w-px bg-white/10 mx-0.5" />

          {/* Maximize / Solo */}
          {onMaximizeSlot && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMaximizeSlot(slotIndex);
              }}
              className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors"
              title={isMaximized ? 'Restore Grid' : 'Maximize'}
            >
              <span className="material-symbols-outlined text-[15px]">
                {isMaximized ? 'close_fullscreen' : 'open_in_full'}
              </span>
            </button>
          )}

          {/* Clear Slot */}
          {onClearSlot && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClearSlot(slotIndex);
              }}
              className="w-7 h-7 rounded hover:bg-rose-500/20 flex items-center justify-center text-zinc-400 hover:text-rose-400 transition-colors"
              title="Remove from Grid"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Motion Zone Editor Modal */}
      {showZoneModal && camera && (
        <MotionZoneEditorModal
          isOpen={showZoneModal}
          onClose={() => setShowZoneModal(false)}
          cameraId={camera.cameraId}
          cameraName={camera.name}
        />
      )}
    </div>
  );
};

export default LiveCameraTile;

