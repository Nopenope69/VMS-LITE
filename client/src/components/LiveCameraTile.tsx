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
    <div className="relative flex flex-col w-full h-full bg-zinc-950 border border-zinc-800 rounded overflow-hidden shadow-md group">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-300">
        <div className="flex items-center gap-2 truncate">
          <Video className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="font-medium truncate select-none text-zinc-100">
            {camera ? camera.name : `Slot ${slotIndex + 1}: No Camera Assigned`}
          </span>
        </div>

        {camera && (
          <div className="flex items-center gap-1 shrink-0">
            {/* Main / Sub Quality Switcher */}
            {camera.subStreamWhepUrl && (
              <button
                type="button"
                onClick={() => setStreamQuality(activeQuality === 'main' ? 'sub' : 'main')}
                title="Toggle Main / Sub Stream"
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wider transition-colors ${
                  activeQuality === 'main'
                    ? 'bg-blue-950 text-blue-300 border border-blue-800'
                    : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>{activeQuality.toUpperCase()}</span>
              </button>
            )}

            {/* Maximize / Solo Button */}
            {onMaximizeSlot && (
              <button
                type="button"
                onClick={() => onMaximizeSlot(slotIndex)}
                title={isMaximized ? 'Restore Grid' : 'Maximize Tile'}
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
              >
                {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            )}

            {/* Clear Slot Button */}
            {onClearSlot && (
              <button
                type="button"
                onClick={() => onClearSlot(slotIndex)}
                title="Remove from Slot"
                className="p-1 text-zinc-400 hover:text-red-400 rounded hover:bg-zinc-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Video Content */}
      <div className="flex-1 w-full bg-black relative flex items-center justify-center">
        {camera ? (
          <WhepHlsPlayer
            key={`${camera.cameraId}-${activeQuality}`}
            whepUrl={whepUrl}
            hlsUrl={hlsUrl}
            iceServers={iceServers}
            cameraName={camera.name}
          />
        ) : (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <Video className="w-10 h-10 text-zinc-700 mb-2" />
            <span className="text-xs text-zinc-500 mb-3">No camera selected for this slot</span>
            {availableCameras.length > 0 && onAssignCamera && (
              <select
                className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-zinc-500"
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
                  Assign camera...
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
