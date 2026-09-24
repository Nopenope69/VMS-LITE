import React, { useState } from 'react';
import { Maximize2, Minimize2, Video, X, Layers } from 'lucide-react';
import { WhepHlsPlayer } from './WhepHlsPlayer.js';

export interface CameraStreamInfo {
  cameraId: string;
  name: string;
  mediaMtxPath: string;
  subStreamPath?: string | null;
  whepUrl: string;
  subStreamWhepUrl?: string | null;
  hlsUrl: string;
  subStreamHlsUrl?: string | null;
}

export interface LiveCameraTileProps {
  slotIndex: number;
  camera?: CameraStreamInfo | null;
  availableCameras?: CameraStreamInfo[];
  onAssignCamera?: (slotIndex: number, camera: CameraStreamInfo) => void;
  onClearSlot?: (slotIndex: number) => void;
  onMaximizeSlot?: (slotIndex: number) => void;
  isMaximized?: boolean;
  forceSubStream?: boolean;
  hasMotionAlert?: boolean;
  iceServers?: RTCIceServer[];
}

export const LiveCameraTile: React.FC<LiveCameraTileProps> = ({
  slotIndex,
  camera,
  availableCameras = [],
  onAssignCamera,
  onClearSlot,
  onMaximizeSlot,
  isMaximized = false,
  forceSubStream = false,
  hasMotionAlert = false,
  iceServers,
}) => {
  const [streamQuality, setStreamQuality] = useState<'main' | 'sub'>('main');

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
        </div>

        {camera && (
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Main / Sub Quality Switcher */}
            {camera.subStreamWhepUrl && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setStreamQuality(activeQuality === 'main' ? 'sub' : 'main');
                }}
                title="Toggle Main HD / Sub Stream"
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider transition-colors ${
                  activeQuality === 'main'
                    ? 'bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/50'
                    : 'bg-[#1f2937] text-slate-300 hover:text-white'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>{activeQuality.toUpperCase()}</span>
              </button>
            )}

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
              key={`${camera.cameraId}-${activeQuality}`}
              whepUrl={whepUrl}
              hlsUrl={hlsUrl}
              iceServers={iceServers}
              cameraName={camera.name}
            />

            {/* Solar Amber Motion Alert Badge on Video */}
            {hasMotionAlert && (
              <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#fb923c] text-gray-950 font-bold text-xs shadow-xl animate-bounce">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping" />
                <span>MOTION ALERT</span>
              </div>
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
    </div>
  );
};

export default LiveCameraTile;
