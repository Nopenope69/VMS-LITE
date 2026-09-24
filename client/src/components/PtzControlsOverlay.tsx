import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Square,
  Plus,
  Minus,
  Bookmark,
  Play,
  Pause,
  X,
  Crosshair,
  Compass,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export interface CameraPreset {
  token: string;
  name: string;
}

export interface PtzControlsOverlayProps {
  cameraId: string;
  cameraName: string;
  onClose?: () => void;
  isMaximized?: boolean;
}

export const PtzControlsOverlay: React.FC<PtzControlsOverlayProps> = ({
  cameraId,
  cameraName,
  onClose,
  isMaximized = false,
}) => {
  const { token, isAdmin } = useAuth();
  const [presets, setPresets] = useState<CameraPreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [activeDirection, setActiveDirection] = useState<string | null>(null);
  const [isTourActive, setIsTourActive] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isMovingRef = useRef(false);
  const tourIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Send PTZ Move Command
  const sendMove = useCallback(
    async (x: number, y: number, z: number, directionLabel?: string) => {
      if (!token) return;
      try {
        isMovingRef.current = true;
        if (directionLabel) setActiveDirection(directionLabel);
        await fetch(`/api/cameras/${cameraId}/ptz/move`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ x, y, z }),
        });
      } catch (err) {
        console.error('PTZ Move command failed:', err);
      }
    },
    [cameraId, token]
  );

  // Send PTZ Stop Command
  const sendStop = useCallback(async () => {
    if (!token || !isMovingRef.current) return;
    try {
      isMovingRef.current = false;
      setActiveDirection(null);
      await fetch(`/api/cameras/${cameraId}/ptz/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      console.error('PTZ Stop command failed:', err);
    }
  }, [cameraId, token]);

  // Fetch presets
  const fetchPresets = useCallback(async () => {
    if (!token) return;
    setIsLoadingPresets(true);
    try {
      const res = await fetch(`/api/cameras/${cameraId}/ptz/presets`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setPresets(data.presets || []);
      }
    } catch (err) {
      console.error('Failed to load presets:', err);
    } finally {
      setIsLoadingPresets(false);
    }
  }, [cameraId, token]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  // Go to preset
  const gotoPreset = async (presetToken: string, presetName: string) => {
    if (!token) return;
    try {
      setStatusMessage(`Navigating to ${presetName}...`);
      await fetch(`/api/cameras/${cameraId}/ptz/presets/${presetToken}/goto`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (err) {
      console.error('Failed to navigate to preset:', err);
      setStatusMessage('Preset navigation failed');
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  // Save new preset (Admin only)
  const savePreset = async () => {
    if (!token || !newPresetName.trim()) return;
    setIsSavingPreset(true);
    try {
      const res = await fetch(`/api/cameras/${cameraId}/ptz/presets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newPresetName.trim() }),
      });
      if (res.ok) {
        setShowSavePresetModal(false);
        setNewPresetName('');
        await fetchPresets();
        setStatusMessage(`Preset saved`);
        setTimeout(() => setStatusMessage(null), 2000);
      }
    } catch (err) {
      console.error('Failed to save preset:', err);
    } finally {
      setIsSavingPreset(false);
    }
  };

  // Preset Tour
  useEffect(() => {
    if (!isTourActive || presets.length === 0) {
      if (tourIntervalRef.current) {
        clearInterval(tourIntervalRef.current);
        tourIntervalRef.current = null;
      }
      return;
    }

    // Step immediately to current preset
    gotoPreset(presets[tourIndex].token, presets[tourIndex].name);

    tourIntervalRef.current = setInterval(() => {
      setTourIndex((prev) => {
        const next = (prev + 1) % presets.length;
        gotoPreset(presets[next].token, presets[next].name);
        return next;
      });
    }, 5000);

    return () => {
      if (tourIntervalRef.current) {
        clearInterval(tourIntervalRef.current);
      }
    };
  }, [isTourActive, presets, tourIndex]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          sendMove(0, 1, 0, 'UP');
          break;
        case 'ArrowDown':
          e.preventDefault();
          sendMove(0, -1, 0, 'DOWN');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          sendMove(-1, 0, 0, 'LEFT');
          break;
        case 'ArrowRight':
          e.preventDefault();
          sendMove(1, 0, 0, 'RIGHT');
          break;
        case '+':
        case '=':
          e.preventDefault();
          sendMove(0, 0, 1, 'ZOOM IN');
          break;
        case '-':
        case '_':
          e.preventDefault();
          sendMove(0, 0, -1, 'ZOOM OUT');
          break;
        case ' ':
        case 'Escape':
          e.preventDefault();
          sendStop();
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '_'].includes(e.key)) {
        e.preventDefault();
        sendStop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [sendMove, sendStop]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-30 flex flex-col bg-[#090d16]/95 backdrop-blur-md border border-[#4fc3f7]/40 rounded-xl shadow-2xl p-3 text-slate-100 select-none transition-all duration-200 ${
        isMaximized
          ? 'bottom-6 right-6 w-80'
          : 'bottom-2 right-2 w-72 max-w-[calc(100%-16px)]'
      }`}
    >
      {/* HUD Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1f2937]">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#4fc3f7]">
          <Compass className="w-4 h-4 animate-spin-slow text-[#4fc3f7]" />
          <span>PTZ CONTROLS</span>
          <span className="text-[10px] text-slate-400 font-mono font-normal truncate max-w-[120px]">
            ({cameraName})
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close PTZ Overlay"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Status / Active Direction Banner */}
      <div className="flex items-center justify-between h-5 px-2 mb-2 text-[10px] font-mono rounded bg-[#111827] border border-[#1f2937]">
        <span className="text-slate-400">WATCHDOG: <span className="text-emerald-400">1.5s AUTO-STOP</span></span>
        {activeDirection ? (
          <span className="font-bold text-[#fb923c] animate-pulse">MOVE: {activeDirection}</span>
        ) : statusMessage ? (
          <span className="font-bold text-[#4fc3f7] truncate">{statusMessage}</span>
        ) : (
          <span className="text-slate-500">IDLE</span>
        )}
      </div>

      {/* Main Control Pad & Zoom Bar */}
      <div className="flex items-center justify-around gap-2 my-1">
        {/* 8-Directional Virtual D-Pad */}
        <div className="relative w-36 h-36 bg-[#111827] border border-[#1f2937] rounded-full p-1.5 shadow-inner flex items-center justify-center">
          {/* North */}
          <button
            type="button"
            onPointerDown={() => sendMove(0, 1, 0, 'UP')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Tilt Up"
            className="absolute top-1.5 w-8 h-8 rounded-full bg-[#090d16] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] flex items-center justify-center text-slate-200 active:scale-95 transition-all"
          >
            <ChevronUp className="w-5 h-5 text-[#4fc3f7]" />
          </button>

          {/* North-East */}
          <button
            type="button"
            onPointerDown={() => sendMove(0.7, 0.7, 0, 'UP-RIGHT')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Tilt Up & Pan Right"
            className="absolute top-4 right-4 w-6 h-6 rounded-full bg-[#090d16] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] flex items-center justify-center text-slate-300 active:scale-95 transition-all"
          >
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 hover:text-[#4fc3f7]" />
          </button>

          {/* East (Right) */}
          <button
            type="button"
            onPointerDown={() => sendMove(1, 0, 0, 'RIGHT')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Pan Right"
            className="absolute right-1.5 w-8 h-8 rounded-full bg-[#090d16] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] flex items-center justify-center text-slate-200 active:scale-95 transition-all"
          >
            <ChevronRight className="w-5 h-5 text-[#4fc3f7]" />
          </button>

          {/* South-East */}
          <button
            type="button"
            onPointerDown={() => sendMove(0.7, -0.7, 0, 'DOWN-RIGHT')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Tilt Down & Pan Right"
            className="absolute bottom-4 right-4 w-6 h-6 rounded-full bg-[#090d16] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] flex items-center justify-center text-slate-300 active:scale-95 transition-all"
          >
            <ArrowDownRight className="w-3.5 h-3.5 text-slate-400 hover:text-[#4fc3f7]" />
          </button>

          {/* South */}
          <button
            type="button"
            onPointerDown={() => sendMove(0, -1, 0, 'DOWN')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Tilt Down"
            className="absolute bottom-1.5 w-8 h-8 rounded-full bg-[#090d16] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] flex items-center justify-center text-slate-200 active:scale-95 transition-all"
          >
            <ChevronDown className="w-5 h-5 text-[#4fc3f7]" />
          </button>

          {/* South-West */}
          <button
            type="button"
            onPointerDown={() => sendMove(-0.7, -0.7, 0, 'DOWN-LEFT')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Tilt Down & Pan Left"
            className="absolute bottom-4 left-4 w-6 h-6 rounded-full bg-[#090d16] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] flex items-center justify-center text-slate-300 active:scale-95 transition-all"
          >
            <ArrowDownLeft className="w-3.5 h-3.5 text-slate-400 hover:text-[#4fc3f7]" />
          </button>

          {/* West (Left) */}
          <button
            type="button"
            onPointerDown={() => sendMove(-1, 0, 0, 'LEFT')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Pan Left"
            className="absolute left-1.5 w-8 h-8 rounded-full bg-[#090d16] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] flex items-center justify-center text-slate-200 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-5 h-5 text-[#4fc3f7]" />
          </button>

          {/* North-West */}
          <button
            type="button"
            onPointerDown={() => sendMove(-0.7, 0.7, 0, 'UP-LEFT')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Tilt Up & Pan Left"
            className="absolute top-4 left-4 w-6 h-6 rounded-full bg-[#090d16] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] flex items-center justify-center text-slate-300 active:scale-95 transition-all"
          >
            <ArrowUpLeft className="w-3.5 h-3.5 text-slate-400 hover:text-[#4fc3f7]" />
          </button>

          {/* Center STOP Button */}
          <button
            type="button"
            onClick={sendStop}
            title="Emergency Stop"
            className="w-10 h-10 rounded-full bg-[#090d16] border-2 border-[#fb923c] text-[#fb923c] hover:bg-[#fb923c]/20 flex items-center justify-center active:scale-90 transition-all shadow-md"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        </div>

        {/* Optical Zoom Stepper */}
        <div className="flex flex-col items-center justify-between h-36 w-16 bg-[#111827] border border-[#1f2937] rounded-xl p-2">
          <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
            ZOOM
          </span>

          <button
            type="button"
            onPointerDown={() => sendMove(0, 0, 1, 'ZOOM IN')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Optical Zoom In (+)"
            className="w-11 h-11 rounded-lg bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7] text-[#4fc3f7] flex items-center justify-center active:scale-95 transition-all shadow-sm"
          >
            <Plus className="w-6 h-6" />
          </button>

          <Crosshair className="w-4 h-4 text-slate-500" />

          <button
            type="button"
            onPointerDown={() => sendMove(0, 0, -1, 'ZOOM OUT')}
            onPointerUp={sendStop}
            onPointerLeave={sendStop}
            title="Optical Zoom Out (-)"
            className="w-11 h-11 rounded-lg bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7] text-[#4fc3f7] flex items-center justify-center active:scale-95 transition-all shadow-sm"
          >
            <Minus className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Preset Section Header & Tour Action */}
      <div className="mt-2 pt-2 border-t border-[#1f2937]">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-300">
            <Bookmark className="w-3.5 h-3.5 text-[#4fc3f7]" />
            <span>PRESETS ({presets.length})</span>
          </div>

          <div className="flex items-center gap-1">
            {/* Tour Button */}
            {presets.length > 1 && (
              <button
                type="button"
                onClick={() => setIsTourActive(!isTourActive)}
                title={isTourActive ? 'Stop Preset Tour' : 'Start 5s Preset Tour'}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono transition-colors ${
                  isTourActive
                    ? 'bg-[#fb923c] text-gray-950 animate-pulse'
                    : 'bg-[#1f2937] text-slate-300 hover:text-white'
                }`}
              >
                {isTourActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>TOUR</span>
              </button>
            )}

            {/* Admin Save Preset Trigger */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowSavePresetModal(true)}
                title="Save current position as new preset"
                className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-[#4fc3f7]/20 text-[#4fc3f7] hover:bg-[#4fc3f7]/30 border border-[#4fc3f7]/40 transition-colors"
              >
                + SAVE
              </button>
            )}
          </div>
        </div>

        {/* Preset Pills List */}
        {isLoadingPresets ? (
          <div className="flex items-center justify-center py-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-[#4fc3f7] mr-1" />
            <span>Loading presets...</span>
          </div>
        ) : presets.length === 0 ? (
          <div className="py-1 text-[11px] text-slate-500 text-center font-mono">
            No presets configured
          </div>
        ) : (
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
            {presets.map((preset) => (
              <button
                key={preset.token}
                type="button"
                onClick={() => gotoPreset(preset.token, preset.name)}
                title={`Jump to preset: ${preset.name}`}
                className="px-2 py-1 rounded bg-[#111827] hover:bg-[#4fc3f7]/20 border border-[#1f2937] hover:border-[#4fc3f7] text-[11px] text-slate-200 hover:text-[#4fc3f7] font-mono transition-all truncate max-w-[120px]"
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Save Preset Dialog Modal */}
      {showSavePresetModal && (
        <div className="mt-2 p-2 bg-[#111827] border border-[#4fc3f7]/50 rounded-lg shadow-lg">
          <div className="text-[11px] font-semibold text-slate-200 mb-1.5">
            Save Current Position as Preset
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="e.g. Front Gate"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              className="flex-1 bg-[#090d16] border border-[#1f2937] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#4fc3f7]"
              autoFocus
            />
            <button
              type="button"
              onClick={savePreset}
              disabled={isSavingPreset || !newPresetName.trim()}
              className="px-2 py-1 rounded bg-[#4fc3f7] text-gray-950 font-bold text-xs hover:bg-[#4fc3f7]/90 disabled:opacity-50"
            >
              {isSavingPreset ? '...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowSavePresetModal(false)}
              className="px-1.5 py-1 rounded text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PtzControlsOverlay;
