import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Video, X, CornerDownLeft, Hash, ArrowUpDown } from 'lucide-react';

export interface ChannelItem {
  id: string;
  name: string;
  channelNumber?: number;
  ipAddress?: string;
  status?: string;
}

export interface ChannelSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: ChannelItem[];
  onSelectCamera: (camera: ChannelItem, channelIndex: number) => void;
  activeCameraId?: string;
}

/**
 * Accessible Channel Switcher Modal for CCTV fleets (Hotkey: 'G').
 * Enables rapid keyboard-driven navigation (Arrow keys + Enter, Esc to close)
 * and real-time filtering across camera fleets with > 9 channels.
 */
export const ChannelSwitcherModal: React.FC<ChannelSwitcherModalProps> = ({
  isOpen,
  onClose,
  cameras,
  onSelectCamera,
  activeCameraId,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter cameras by search query (matches channel number, camera name, or IP)
  const filteredCameras = useMemo(() => {
    if (!searchQuery.trim()) {
      return cameras;
    }
    const q = searchQuery.toLowerCase().trim();
    return cameras.filter((cam, idx) => {
      const channelNum = cam.channelNumber ?? idx + 1;
      return (
        cam.name.toLowerCase().includes(q) ||
        channelNum.toString().includes(q) ||
        (cam.ipAddress && cam.ipAddress.toLowerCase().includes(q))
      );
    });
  }, [cameras, searchQuery]);

  // Reset search and selection when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keep selectedIndex within bounds when filter changes
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredCameras.length === 0) return 0;
      return Math.min(prev, filteredCameras.length - 1);
    });
  }, [filteredCameras]);

  // Ensure highlighted item stays scrolled into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Keyboard navigation handler inside the modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredCameras.length > 0 ? (prev + 1) % filteredCameras.length : 0));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredCameras.length > 0 ? (prev - 1 + filteredCameras.length) % filteredCameras.length : 0
      );
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCameras.length > 0 && filteredCameras[selectedIndex]) {
        const chosen = filteredCameras[selectedIndex];
        const originalIndex = cameras.findIndex((c) => c.id === chosen.id);
        onSelectCamera(chosen, originalIndex >= 0 ? originalIndex : selectedIndex);
        onClose();
      }
      return;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-switcher-title"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-lg bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1f2937] bg-[#090d16]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/30 flex items-center justify-center">
              <ArrowUpDown className="w-4 h-4 text-[#4fc3f7]" />
            </div>
            <div>
              <h2 id="channel-switcher-title" className="text-sm font-bold text-slate-100 font-sans">
                Quick Channel Switcher
              </h2>
              <p className="text-[10px] text-slate-400 font-mono">
                Press ↑ / ↓ to navigate, Enter to switch, Esc to close
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close channel switcher"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-[#1f2937] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search input field */}
        <div className="p-3 bg-[#090d16]/50 border-b border-[#1f2937]">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search channel number, camera name, or IP..."
              className="w-full pl-9 pr-4 py-2 bg-[#111827] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
            />
          </div>
        </div>

        {/* Camera channel list */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredCameras.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 font-mono">
              No matching channels found
            </div>
          ) : (
            filteredCameras.map((camera, idx) => {
              const channelNumber = camera.channelNumber ?? cameras.findIndex((c) => c.id === camera.id) + 1;
              const isSelected = idx === selectedIndex;
              const isActive = camera.id === activeCameraId;

              return (
                <button
                  key={camera.id}
                  type="button"
                  data-index={idx}
                  onClick={() => {
                    const originalIndex = cameras.findIndex((c) => c.id === camera.id);
                    onSelectCamera(camera, originalIndex >= 0 ? originalIndex : idx);
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors font-mono ${
                    isSelected
                      ? 'bg-[#4fc3f7]/20 border border-[#4fc3f7]/60 text-white font-bold'
                      : 'border border-transparent text-slate-300 hover:bg-[#1f2937]'
                  }`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        isSelected
                          ? 'bg-[#4fc3f7] text-[#090d16]'
                          : 'bg-[#1f2937] text-slate-300'
                      }`}
                    >
                      CH {channelNumber.toString().padStart(2, '0')}
                    </span>
                    <Video className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{camera.name}</span>
                    {camera.ipAddress && (
                      <span className="text-[10px] text-slate-500 hidden sm:inline">
                        ({camera.ipAddress})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isActive && (
                      <span className="px-1.5 py-0.5 bg-[#4fc3f7]/20 text-[#4fc3f7] text-[10px] rounded border border-[#4fc3f7]/40">
                        ACTIVE
                      </span>
                    )}
                    {isSelected && <CornerDownLeft className="w-3.5 h-3.5 text-[#4fc3f7]" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="px-4 py-2 bg-[#090d16] border-t border-[#1f2937] flex items-center justify-between text-[10px] font-mono text-slate-500">
          <span>{filteredCameras.length} of {cameras.length} channels available</span>
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 bg-[#1f2937] rounded text-slate-300">↑↓</kbd> Select</span>
            <span><kbd className="px-1 py-0.5 bg-[#1f2937] rounded text-slate-300">Enter</kbd> Switch</span>
            <span><kbd className="px-1 py-0.5 bg-[#1f2937] rounded text-slate-300">Esc</kbd> Exit</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChannelSwitcherModal;
