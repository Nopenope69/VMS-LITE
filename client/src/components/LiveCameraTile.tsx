import React, { useState, useRef } from 'react';
import { Maximize2, Minimize2, Video, X, Layers, Compass, ShieldAlert, Camera } from 'lucide-react';
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
}

export interface LiveCameraTileProps {
  slotIndex: number;
  camera?: CameraStreamInfo | null;
  telemetry?: CameraHealthTelemetry | null;
  availableCameras?: CameraStreamInfo[];
  onAssignCamera?: (slotIndex: number, camera: CameraStreamInfo) => void;
  onClearSlot?: (slotIndex: number) => void;
  onMaximizeSlot?: (slotIndex: number) => void;
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
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Derive effective ViewMode for adaptive stream profile resolution.
  // If viewMode is not explicitly provided, honor forceSubStream by staying in GRID mode.
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

  // Resolve WHEP and HLS stream URLs based on streamProfile safely without unescaped RegExp
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

  return (
    <div
      className={`relative flex flex-col w-full h-full bg-[#090d16] rounded-lg overflow-hidden shadow-lg transition-all duration-200 group border ${
        hasMotionAlert
          ? 'border-[#fb923c] ring-4 ring-[#fb923c]/50 animate-pulse'
          : isMaximized
          ? 'border-[#4fc3f7] ring-2 ring-[#4fc3f7]/40'
          : 'border-[#1f2937] hover:border-[#4fc3f7]/50'
      }`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#111827] border-b border-[#1f2937] text-xs text-slate-300">
        <div className="flex items-center gap-2 truncate">
          <span className="flex items-center justify-center w-5 h-5 rounded bg-[#090d16] text-[#4fc3f7] font-mono text-[11px] font-bold border border-[#1f2937]">
            {slotIndex + 1}
          </span>
          <Video className="w-4 h-4 text-[#4fc3f7] shrink-0" />
          <span className="font-semibold truncate select-none text-slate-100 text-xs">
            {camera ? camera.name : `Slot ${slotIndex + 1}: Unassigned`}
          </span>
          {telemetry && (
            <div
              title={`Health: ${telemetry.status}\nLatency: ${telemetry.latencyMs !== null ? `${telemetry.latencyMs}ms` : 'N/A'}\nBitrate: ${telemetry.bitrateKbps !== null ? `${telemetry.bitrateKbps} kbps` : 'Warm-up'}${telemetry.reason ? `\nReason: ${telemetry.reason}` : ''}`}
              className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono cursor-help bg-[#090d16] border border-[#1f2937] shrink-0 select-none"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  telemetry.status === 'ONLINE'
                    ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]'
                    : telemetry.status === 'DEGRADED'
                    ? 'bg-amber-500 animate-pulse shadow-[0_0_6px_rgba(245,158,11,0.8)]'
                    : telemetry.status === 'UNKNOWN'
                    ? 'bg-slate-400'
                    : 'bg-rose-500 animate-ping shadow-[0_0_6px_rgba(239,68,68,0.8)]'
                }`}
              />
              <span
                className={`text-[9px] font-bold uppercase tracking-wider ${
                  telemetry.status === 'ONLINE'
                    ? 'text-emerald-400'
                    : telemetry.status === 'DEGRADED'
                    ? 'text-amber-400'
                    : telemetry.status === 'UNKNOWN'
                    ? 'text-slate-400'
                    : 'text-rose-400'
                }`}
              >
                {telemetry.status}
              </span>
            </div>
          )}
          {hasMotionAlert ? (
            <div
              title="Motion detected! Recording incident promoted to permanent storage."
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/70 text-rose-300 border border-rose-500/50 shrink-0 select-none animate-pulse"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
              <span>REC (MOTION)</span>
            </div>
          ) : isMotionBuffering ? (
            <div
              title="Rolling 2s fMP4 ring-buffer active in memory (standby)"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/40 text-amber-300 border border-amber-600/30 shrink-0 select-none"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>BUF (MOTION)</span>
            </div>
          ) : null}
        </div>

        {camera && (
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Stream Quality Selector Pill (AUTO | SD | HD) or Locked HD Badge */}
            {streamProfile && (
              streamProfile.isHdOnly ? (
                <div
                  title="Sub-stream unavailable for this camera (Locked to Main HD)"
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#1f2937] text-slate-400 border border-[#374151] select-none"
                  aria-label="Stream Quality: HD Only"
                >
                  <Layers className="w-3 h-3 text-slate-400" />
                  <span>HD</span>
                </div>
              ) : (
                <div
                  role="group"
                  aria-label="Stream Quality Selector"
                  className="flex items-center bg-[#090d16] border border-[#1f2937] rounded-md p-0.5 text-[10px] font-mono font-bold select-none"
                >
                  {(['AUTO', 'SD', 'HD'] as const).map((q) => {
                    const isSelected = qualityOverride === q;
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQualityOverride(q);
                        }}
                        aria-pressed={isSelected}
                        title={
                          q === 'AUTO'
                            ? `Automatic Quality (Currently ${streamProfile.selectedStream} in ${effectiveViewMode} mode)`
                            : `Force ${q} stream (${q === 'HD' ? 'Main Profile' : 'Sub Profile'})`
                        }
                        className={`px-1.5 py-0.5 rounded transition-all min-w-[28px] text-center ${
                          isSelected
                            ? 'bg-[#4fc3f7] text-[#090d16] font-extrabold shadow-sm'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-[#1f2937]'
                        }`}
                      >
                        {q}
                      </button>
                    );
                  })}
                </div>
              )
            )}

            {/* PTZ Controls Toggle Button */}
            {canControlPtz && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowPtzOverlay(!showPtzOverlay);
                }}
                title={showPtzOverlay ? 'Hide PTZ Controls' : 'Open PTZ Controls'}
                className={`p-1.5 rounded transition-colors ${
                  showPtzOverlay
                    ? 'bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/50'
                    : 'text-slate-400 hover:text-white rounded hover:bg-[#1f2937]'
                }`}
              >
                <Compass className="w-4 h-4" />
              </button>
            )}

            {/* Motion Zones Modal Trigger (Admin only) */}
            {canEditZones && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowZoneModal(true);
                }}
                title="Configure Motion Zones & Spatial Exclusion"
                className={`p-1.5 rounded transition-colors ${
                  showZoneModal
                    ? 'bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/50'
                    : 'text-slate-400 hover:text-[#10b981] rounded hover:bg-[#1f2937]'
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
              </button>
            )}

            {/* Instant Snapshot Header Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (videoRef.current) {
                  captureVideoSnapshot(videoRef.current, camera.name);
                }
              }}
              title="Capture Instant JPEG Snapshot"
              className="p-1.5 text-slate-400 hover:text-[#38bdf8] rounded hover:bg-[#1f2937] transition-colors"
            >
              <Camera className="w-4 h-4" />
            </button>

            {/* Maximize / Solo Button (CP Plus Double-Click / 1-Click Parity) */}
            {onMaximizeSlot && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMaximizeSlot(slotIndex);
                }}
                title={isMaximized ? 'Restore Grid (ESC)' : 'Maximize Camera (Double-Click)'}
                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-[#1f2937] transition-colors"
              >
                {isMaximized ? (
                  <Minimize2 className="w-4 h-4 text-[#4fc3f7]" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Clear Slot Button */}
            {onClearSlot && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearSlot(slotIndex);
                }}
                title="Remove Camera from Slot"
                className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-[#1f2937] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Video Content with Guard Double-Click Target */}
      <div
        onDoubleClick={() => onMaximizeSlot && onMaximizeSlot(slotIndex)}
        title={camera ? 'Double-click to expand or restore full view' : undefined}
        className="flex-1 w-full bg-black relative flex items-center justify-center cursor-pointer select-none"
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

            {/* Solar Amber Motion Alert Badge on Video */}
            {hasMotionAlert && (
              <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#fb923c] text-gray-950 font-bold text-xs shadow-xl animate-bounce">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping" />
                <span>MOTION ALERT</span>
              </div>
            )}

            {/* Floating PTZ Controls HUD */}
            {showPtzOverlay && canControlPtz && (
              <PtzControlsOverlay
                cameraId={camera.cameraId}
                cameraName={camera.name}
                onClose={() => setShowPtzOverlay(false)}
                isMaximized={isMaximized}
              />
            )}

            {/* Double-Click Hint on Maximized */}
            {isMaximized && (
              <div className="absolute bottom-3 left-3 z-20 px-2.5 py-1 rounded bg-[#090d16]/80 border border-[#4fc3f7]/40 text-[#4fc3f7] text-[11px] font-mono shadow-md backdrop-blur-sm">
                DOUBLE-CLICK TO EXIT FULLSCREEN
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-[#111827] border border-[#1f2937] flex items-center justify-center mb-3">
              <Video className="w-6 h-6 text-slate-500" />
            </div>
            <span className="text-xs font-medium text-slate-400 mb-3">
              Slot {slotIndex + 1} is empty
            </span>
            {availableCameras.length > 0 && onAssignCamera && (
              <select
                className="bg-[#111827] border border-[#1f2937] text-slate-200 text-xs rounded-md px-3 py-2 min-h-[40px] focus:outline-none focus:border-[#4fc3f7]"
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
                  + Assign camera to this slot...
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
