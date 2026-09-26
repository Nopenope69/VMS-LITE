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
  Scissors,
  FastForward,
  Check,
  Radio,
  Film,
} from 'lucide-react';
import { WhepHlsPlayer } from './WhepHlsPlayer.js';
import { PtzControlsOverlay } from './PtzControlsOverlay.js';
import { MotionZoneEditorModal } from './MotionZoneEditorModal.js';
import { useAuth } from '../context/AuthContext.js';
import { CameraHealthTelemetry } from '../hooks/useCameraHealth.js';
import { captureVideoSnapshot, CropRect } from '../utils/snapshot-helper.js';
import { ContextMenu, ContextMenuItem } from './ContextMenu.js';

export interface CameraStreamInfo {
  cameraId: string;
  name: string;
  mediaMtxPath: string;
  subStreamPath?: string | null;
  whepUrl: string;
  subStreamWhepUrl?: string | null;
  hlsUrl: string;
  subStreamHlsUrl?: string | null;
  mediaSource?: string | null;
  mediaUrl?: string | null;
}

export interface LiveCameraTileProps {
  slotIndex: number;
  camera?: CameraStreamInfo | null;
  telemetry?: CameraHealthTelemetry | null;
  availableCameras?: CameraStreamInfo[];
  onAssignCamera?: (slotIndex: number, camera: CameraStreamInfo) => void;
  onClearSlot?: (slotIndex: number) => void;
  onMaximizeSlot?: (slotIndex: number) => void;
  onInstantPlayback?: (cameraId: string) => void;
  onToggleEmergencyRecord?: (cameraId: string) => void;
  isEmergencyRecording?: boolean;
  isMaximized?: boolean;
  forceSubStream?: boolean;
  targetFps?: number;
  isThrottled?: boolean;
  hasMotionAlert?: boolean;
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
  onInstantPlayback,
  onToggleEmergencyRecord,
  isEmergencyRecording = false,
  isMaximized = false,
  forceSubStream = false,
  targetFps,
  isThrottled = false,
  hasMotionAlert = false,
  canControlPtz = true,
  isAdmin,
  iceServers,
}) => {
  const { isAdmin: authIsAdmin } = useAuth();
  const canEditZones = isAdmin !== undefined ? isAdmin : authIsAdmin;
  const [streamQuality, setStreamQuality] = useState<'main' | 'sub'>('main');
  const [showPtzOverlay, setShowPtzOverlay] = useState(false);
  const [showZoneModal, setShowZoneModal] = useState(false);

  // Custom video loop source state
  const [availableClips, setAvailableClips] = useState<Array<{ id: string; filename: string; title: string }>>([]);
  const [showClipSelector, setShowClipSelector] = useState(false);
  const [localMediaSource, setLocalMediaSource] = useState<string | null>(camera?.mediaSource || null);

  useEffect(() => {
    setLocalMediaSource(camera?.mediaSource || null);
  }, [camera?.mediaSource]);

  const loadClips = async () => {
    try {
      const res = await fetch('/api/media/clips');
      if (res.ok) {
        const data = await res.json();
        setAvailableClips(data.clips || []);
      }
    } catch {}
  };

  const handleSelectClip = async (filename: string) => {
    setLocalMediaSource(filename);
    setShowClipSelector(false);
    if (camera) {
      try {
        await fetch(`/api/cameras/${camera.cameraId}/media-source`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaSource: filename }),
        });
      } catch {}
    }
  };

  // Snapshot, Snip & Context Menu state
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [isSnipMode, setIsSnipMode] = useState<boolean>(false);
  const [boxDrag, setBoxDrag] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const [flashSuccess, setFlashSuccess] = useState<boolean>(false);
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Trigger full-frame snapshot
  const handleFullSnapshot = async () => {
    if (!videoElementRef.current || !camera) return;
    try {
      const res = await captureVideoSnapshot(videoElementRef.current, {
        cameraName: camera.name,
      });
      setFlashSuccess(true);
      setSnapshotToast(`Snapshot: ${res.filename}`);
      setTimeout(() => setFlashSuccess(false), 300);
      setTimeout(() => setSnapshotToast(null), 3000);
    } catch (err: any) {
      console.error('Snapshot failed:', err);
    }
  };

  // Execute cropped box snapshot
  const executeCropCapture = async (crop: CropRect) => {
    if (!videoElementRef.current || !camera || !videoContainerRef.current) return;
    try {
      const res = await captureVideoSnapshot(videoElementRef.current, {
        cameraName: camera.name,
        crop,
        containerWidth: videoContainerRef.current.clientWidth,
        containerHeight: videoContainerRef.current.clientHeight,
      });
      setFlashSuccess(true);
      setSnapshotToast(`Region crop: ${res.filename}`);
      setTimeout(() => setFlashSuccess(false), 300);
      setTimeout(() => setSnapshotToast(null), 3000);
    } catch (err: any) {
      console.error('Crop snapshot failed:', err);
    } finally {
      setIsSnipMode(false);
      setBoxDrag(null);
    }
  };

  // Keyboard shortcut listener for Esc to cancel snip mode
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSnipMode) {
        setIsSnipMode(false);
        setBoxDrag(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isSnipMode]);

  // If grid forces sub-stream (2x2, 3x3) and sub-stream is available, use it (T-04-03)
  const activeQuality =
    camera?.subStreamWhepUrl && (forceSubStream || streamQuality === 'sub')
      ? 'sub'
      : 'main';

  const whepUrl =
    activeQuality === 'sub' && camera?.subStreamWhepUrl
      ? camera.subStreamWhepUrl
      : camera?.whepUrl || '';

  const hlsUrl =
    activeQuality === 'sub' && camera?.subStreamHlsUrl
      ? camera.subStreamHlsUrl
      : camera?.hlsUrl || '';

  return (
    <div
      onContextMenu={(e) => {
        if (camera) {
          e.preventDefault();
          e.stopPropagation();
          setContextMenuPos({ x: e.clientX, y: e.clientY });
        }
      }}
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
                    : 'bg-rose-500 animate-ping shadow-[0_0_6px_rgba(239,68,68,0.8)]'
                }`}
              />
              <span
                className={`text-[9px] font-bold uppercase tracking-wider ${
                  telemetry.status === 'ONLINE'
                    ? 'text-emerald-400'
                    : telemetry.status === 'DEGRADED'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {telemetry.status}
              </span>
            </div>
          )}
        </div>

        {camera && (
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 1-Click Instant Full Snapshot */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleFullSnapshot();
              }}
              title="Take Instant Snapshot (Shift+S)"
              className="p-1.5 text-slate-400 hover:text-[#4fc3f7] hover:bg-[#1f2937] rounded transition-colors"
            >
              <Camera className="w-4 h-4" />
            </button>

            {/* Region Crop Snip Tool Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSnipMode(!isSnipMode);
                setBoxDrag(null);
              }}
              title={isSnipMode ? 'Cancel Snip Mode (ESC)' : 'Snip Region Snapshot (Shift+Drag)'}
              className={`p-1.5 rounded transition-colors ${
                isSnipMode
                  ? 'bg-[#4fc3f7] text-[#090d16] font-bold shadow-md'
                  : 'text-slate-400 hover:text-[#4fc3f7] hover:bg-[#1f2937]'
              }`}
            >
              <Scissors className="w-4 h-4" />
            </button>

            {/* Dual-Stream Cloud Proxy Quality Switcher */}
            {camera.subStreamWhepUrl ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setStreamQuality(activeQuality === 'main' ? 'sub' : 'main');
                }}
                title={
                  isThrottled
                    ? 'Bandwidth Choked (< 5 Mbps): Auto-throttled to 10 FPS Sub-Stream'
                    : `Dual-Stream Cloud Proxy: Click to switch between 1080p HD and 360p Sub-Stream`
                }
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider transition-colors ${
                  isThrottled
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 animate-pulse'
                    : activeQuality === 'main'
                    ? 'bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/50'
                    : 'bg-[#1f2937] text-slate-300 hover:text-white border border-[#374151]'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>
                  {isThrottled
                    ? '10 FPS (CHOKED)'
                    : activeQuality === 'main'
                    ? '1080p HD'
                    : '360p SUB'}
                </span>
              </button>
            ) : isThrottled ? (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
                10 FPS
              </span>
            ) : null}

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

            {/* Custom Video Loop Source Selector */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                loadClips();
                setShowClipSelector(!showClipSelector);
              }}
              title="Select / Change Video Clip Loop (MP4)"
              className={`p-1.5 rounded transition-colors ${
                showClipSelector
                  ? 'bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/50'
                  : 'text-slate-400 hover:text-[#10b981] rounded hover:bg-[#1f2937]'
              }`}
            >
              <Film className="w-4 h-4" />
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

      {/* Video Content with Guard Double-Click Target, Snip Box Gesture & Context Menu */}
      <div
        ref={videoContainerRef}
        onDoubleClick={() => !isSnipMode && onMaximizeSlot && onMaximizeSlot(slotIndex)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (camera) {
            setContextMenuPos({ x: e.clientX, y: e.clientY });
          }
        }}
        onMouseDown={(e) => {
          if (!camera) return;
          if ((isSnipMode || e.shiftKey) && e.button === 0) {
            e.preventDefault();
            e.stopPropagation();
            const rect = videoContainerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const startX = e.clientX - rect.left;
            const startY = e.clientY - rect.top;
            setBoxDrag({ startX, startY, curX: startX, curY: startY });
          }
        }}
        onMouseMove={(e) => {
          if (boxDrag && videoContainerRef.current) {
            const rect = videoContainerRef.current.getBoundingClientRect();
            const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
            setBoxDrag((prev) => (prev ? { ...prev, curX, curY } : null));
          }
        }}
        onMouseUp={() => {
          if (boxDrag) {
            const x = Math.min(boxDrag.startX, boxDrag.curX);
            const y = Math.min(boxDrag.startY, boxDrag.curY);
            const width = Math.abs(boxDrag.curX - boxDrag.startX);
            const height = Math.abs(boxDrag.curY - boxDrag.startY);

            if (width > 15 && height > 15) {
              executeCropCapture({ x, y, width, height });
            } else {
              setBoxDrag(null);
            }
          }
        }}
        title={
          camera
            ? isSnipMode
              ? 'Snip Mode: Drag box to crop region (ESC to cancel)'
              : 'Double-click to expand | Right-click for options | Shift+Drag to snip'
            : undefined
        }
        className={`flex-1 w-full bg-black relative flex items-center justify-center select-none ${
          isSnipMode || boxDrag ? 'cursor-crosshair' : 'cursor-pointer'
        }`}
      >
        {camera ? (
          <>
            <WhepHlsPlayer
              key={`${camera.cameraId}-${activeQuality}-${localMediaSource || ''}`}
              whepUrl={whepUrl}
              hlsUrl={hlsUrl}
              iceServers={iceServers}
              cameraName={camera.name}
              mediaSource={localMediaSource || camera.mediaSource}
              mediaUrl={localMediaSource ? `/media/${encodeURIComponent(localMediaSource)}` : camera.mediaUrl}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenuPos({ x: e.clientX, y: e.clientY });
              }}
              onVideoElementReady={(el) => {
                videoElementRef.current = el;
              }}
            />

            {/* Glowing Crop Selection Box */}
            {boxDrag && (
              <div
                style={{
                  left: Math.min(boxDrag.startX, boxDrag.curX),
                  top: Math.min(boxDrag.startY, boxDrag.curY),
                  width: Math.abs(boxDrag.curX - boxDrag.startX),
                  height: Math.abs(boxDrag.curY - boxDrag.startY),
                }}
                className="absolute z-30 border-2 border-dashed border-[#4fc3f7] bg-[#4fc3f7]/20 pointer-events-none shadow-2xl backdrop-contrast-125 flex items-start justify-end p-1"
              >
                <span className="bg-[#090d16]/90 text-[#4fc3f7] text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#4fc3f7]/40 shadow-sm">
                  {Math.round(Math.abs(boxDrag.curX - boxDrag.startX))} ×{' '}
                  {Math.round(Math.abs(boxDrag.curY - boxDrag.startY))} px [CROP ROI]
                </span>
              </div>
            )}

            {/* Snip Mode Instructions Banner */}
            {isSnipMode && !boxDrag && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-[#090d16]/90 border border-[#4fc3f7] text-[#4fc3f7] text-[11px] font-mono shadow-2xl backdrop-blur-md flex items-center gap-2 animate-bounce">
                <Scissors className="w-3.5 h-3.5" />
                <span>DRAG BOX OVER SUBJECT TO CROP (ESC TO CANCEL)</span>
              </div>
            )}

            {/* Camera Flash Effect */}
            {flashSuccess && (
              <div className="absolute inset-0 bg-white/60 z-40 pointer-events-none animate-out fade-out duration-300" />
            )}

            {/* Snapshot Toast Feedback */}
            {snapshotToast && (
              <div className="absolute bottom-3 right-3 z-30 px-3 py-1.5 rounded-lg bg-[#090d16]/95 border border-[#4fc3f7]/60 text-slate-100 text-xs font-mono shadow-xl backdrop-blur-md flex items-center gap-2 animate-in fade-in duration-150">
                <Check className="w-4 h-4 text-[#4fc3f7]" />
                <span>{snapshotToast}</span>
              </div>
            )}

            {/* Flashing Emergency Live Recording Badge */}
            {isEmergencyRecording && (
              <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-950/90 border border-red-500 text-red-200 text-xs font-mono font-bold shadow-2xl animate-pulse">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                <span>● REC EMERGENCY</span>
              </div>
            )}

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

      {/* Desktop VMS Surveillance Context Menu */}
      {contextMenuPos && camera && (
        <ContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          title={`CAM: ${camera.name}`}
          onClose={() => setContextMenuPos(null)}
          items={[
            {
              id: 'maximize',
              label: isMaximized ? 'Restore Grid View' : 'Enlarge / Focus View',
              icon: isMaximized ? <Minimize2 className="w-4 h-4 text-[#4fc3f7]" /> : <Maximize2 className="w-4 h-4 text-[#4fc3f7]" />,
              shortcut: 'Double-Click',
              onClick: () => onMaximizeSlot?.(slotIndex),
            },
            {
              id: 'snapshot',
              label: 'Take Full Snapshot',
              icon: <Camera className="w-4 h-4 text-[#4fc3f7]" />,
              shortcut: 'Shift+S',
              onClick: handleFullSnapshot,
            },
            {
              id: 'snip',
              label: 'Snip Region (Box Crop)',
              icon: <Scissors className="w-4 h-4 text-[#4fc3f7]" />,
              shortcut: 'Shift+Drag',
              onClick: () => {
                setIsSnipMode(true);
                setBoxDrag(null);
              },
            },
            { divider: true, id: 'd1', label: '' },
            {
              id: 'replay',
              label: 'Instant Replay (Rewind 5 Mins)',
              icon: <FastForward className="w-4 h-4 text-[#fb923c]" />,
              onClick: () => onInstantPlayback?.(camera.cameraId),
            },
            ...(canControlPtz
              ? [
                  {
                    id: 'ptz',
                    label: showPtzOverlay ? 'Hide PTZ Controls' : 'Open PTZ Controls HUD',
                    icon: <Compass className="w-4 h-4 text-[#4fc3f7]" />,
                    onClick: () => setShowPtzOverlay(!showPtzOverlay),
                  },
                ]
              : []),
            ...(canEditZones
              ? [
                  {
                    id: 'zones',
                    label: 'Configure Motion Zones',
                    icon: <ShieldAlert className="w-4 h-4 text-emerald-400" />,
                    onClick: () => setShowZoneModal(true),
                  },
                ]
              : []),
            {
              id: 'emergency-record',
              label: isEmergencyRecording ? 'Stop Emergency Recording' : 'Start Emergency Recording (Protected)',
              icon: <Radio className="w-4 h-4 text-red-500" />,
              onClick: () => onToggleEmergencyRecord?.(camera.cameraId),
            },
            { divider: true, id: 'd2', label: '' },
            {
              id: 'clips',
              label: 'Select Video Clip (MP4 Loop)...',
              icon: <Film className="w-4 h-4 text-[#10b981]" />,
              onClick: () => {
                loadClips();
                setShowClipSelector(true);
              },
            },
            {
              id: 'clear',
              label: 'Remove from Slot',
              icon: <X className="w-4 h-4 text-red-400" />,
              danger: true,
              onClick: () => onClearSlot?.(slotIndex),
            },
          ]}
        />
      )}

      {/* Floating Video Clip Selector Dropdown */}
      {showClipSelector && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-10 right-2 z-40 w-64 bg-[#111827]/95 border border-[#1f2937] rounded-xl shadow-2xl p-2.5 backdrop-blur-md text-xs select-none ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1f2937]">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5 text-[#10b981]" />
              Video Clip Source
            </span>
            <button
              type="button"
              onClick={() => setShowClipSelector(false)}
              className="text-slate-400 hover:text-white text-xs px-1 rounded hover:bg-[#1f2937]"
            >
              ✕
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto space-y-1 pr-0.5">
            {availableClips.map((clip) => {
              const isSelected = localMediaSource === clip.filename;
              return (
                <button
                  key={clip.filename}
                  type="button"
                  onClick={() => handleSelectClip(clip.filename)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-colors ${
                    isSelected
                      ? 'bg-[#10b981]/20 text-[#10b981] font-bold border border-[#10b981]/40'
                      : 'text-slate-300 hover:bg-[#1f2937] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Film className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-[#10b981]' : 'text-slate-400'}`} />
                    <span className="truncate">{clip.filename}</span>
                  </div>
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-[#10b981] shrink-0" />
                  )}
                </button>
              );
            })}
            {availableClips.length === 0 && (
              <div className="text-slate-500 text-center py-3 text-[11px]">
                No MP4 clips found in media/ folder
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveCameraTile;
