import React, { useEffect } from 'react';
import { Keyboard, X, Video, Film, Shield, Info } from 'lucide-react';

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

const LIVE_SHORTCUTS: ShortcutItem[] = [
  { keys: ['1', '–', '9'], description: 'Focus camera channel 1 through 9' },
  { keys: ['0', 'Esc'], description: 'Return to multi-camera grid view' },
  { keys: ['G'], description: 'Open quick channel switcher (Fleets > 9)' },
  { keys: ['F'], description: 'Toggle kiosk fullscreen view' },
  { keys: ['?'], description: 'Toggle keyboard shortcuts cheat sheet' },
];

const PLAYBACK_SHORTCUTS: ShortcutItem[] = [
  { keys: ['Space'], description: 'Toggle play / pause' },
  { keys: ['J'], description: 'Shuttle reverse (-1x → -2x → -4x → -8x)' },
  { keys: ['K'], description: 'Shuttle stop / reset speed to 0' },
  { keys: ['L'], description: 'Shuttle forward (1x → 2x → 4x → 8x)' },
  { keys: ['←', '→'], description: 'Seek ±5 seconds (60ms coalescing)' },
  { keys: ['Shift', '+', '← / →'], description: 'Seek ±30 seconds' },
  { keys: ['↑', '↓'], description: 'Step single frame ±1 (~33ms)' },
  { keys: ['1', '–', '4'], description: 'Select / focus playback slot 1–4' },
  { keys: ['B'], description: 'Add incident bookmark at playhead' },
  { keys: ['?'], description: 'Toggle keyboard shortcuts cheat sheet' },
];

/**
 * Accessible Keyboard Shortcuts Modal Cheat Sheet for CCTV Operators (Hotkey: '?').
 * Presents a clear two-column layout: Live Monitoring vs Synchronized Playback.
 */
export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-3xl bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2937] bg-[#090d16]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/30 flex items-center justify-center">
              <Keyboard className="w-4 h-4 text-[#4fc3f7]" />
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="text-sm sm:text-base font-bold text-slate-100 font-sans">
                CCTV Keyboard Shortcuts & Jog-Shuttle Engine
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                Direct hardware-style operator hotkeys for high-speed surveillance operations
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts modal"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-[#1f2937] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-Column Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#090d16]/30">
          {/* Column 1: Live Monitoring */}
          <div className="flex flex-col rounded-lg border border-[#1f2937] bg-[#111827]/80 p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#1f2937] text-xs font-bold uppercase tracking-wider text-[#4fc3f7]">
              <Video className="w-4 h-4" />
              <span>Live Monitoring Hotkeys</span>
            </div>
            <ul className="space-y-2.5">
              {LIVE_SHORTCUTS.map((item, i) => (
                <li key={i} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 font-sans text-xs">{item.description}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    {item.keys.map((k, ki) => (
                      <kbd
                        key={ki}
                        className="px-2 py-0.5 bg-[#090d16] border border-[#1f2937] rounded text-slate-200 font-bold text-[11px] shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 2: Playback & Timeline */}
          <div className="flex flex-col rounded-lg border border-[#1f2937] bg-[#111827]/80 p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#1f2937] text-xs font-bold uppercase tracking-wider text-[#4fc3f7]">
              <Film className="w-4 h-4" />
              <span>Playback & Jog-Shuttle Hotkeys</span>
            </div>
            <ul className="space-y-2.5">
              {PLAYBACK_SHORTCUTS.map((item, i) => (
                <li key={i} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 font-sans text-xs">{item.description}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    {item.keys.map((k, ki) => (
                      <kbd
                        key={ki}
                        className="px-2 py-0.5 bg-[#090d16] border border-[#1f2937] rounded text-slate-200 font-bold text-[11px] shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-[#090d16] border-t border-[#1f2937] flex items-center justify-between text-xs text-slate-400 font-sans">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Info className="w-3.5 h-3.5 text-[#4fc3f7]" />
            <span>Keymap safety: Hotkeys are paused while entering text into input fields.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#1f2937] hover:bg-[#374151] text-slate-200 font-semibold text-xs rounded-md transition-colors"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsModal;
