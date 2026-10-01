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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in"
    >
      <div className="w-full max-w-3xl alert-glass border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] glass-bar">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg hud-chip flex items-center justify-center text-emerald-400">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="text-sm sm:text-base font-semibold text-zinc-100 font-sans">
                CCTV Keyboard Shortcuts & Jog-Shuttle Engine
              </h2>
              <p className="text-[11px] text-zinc-400 font-mono">
                Direct hardware-style operator hotkeys for high-speed surveillance operations
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts modal"
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-Column Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#090a0f]/60">
          {/* Column 1: Live Monitoring */}
          <div className="flex flex-col rounded-xl border border-white/[0.08] hud-chip p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <Video className="w-4 h-4" />
              <span>Live Monitoring Hotkeys</span>
            </div>
            <ul className="space-y-2.5">
              {LIVE_SHORTCUTS.map((item, i) => (
                <li key={i} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-300 font-sans text-xs">{item.description}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    {item.keys.map((k, ki) => (
                      <kbd
                        key={ki}
                        className="px-2 py-0.5 hud-chip rounded text-zinc-200 font-mono text-[11px] shadow-sm"
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
          <div className="flex flex-col rounded-xl border border-white/[0.08] hud-chip p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <Film className="w-4 h-4" />
              <span>Playback & Jog-Shuttle Hotkeys</span>
            </div>
            <ul className="space-y-2.5">
              {PLAYBACK_SHORTCUTS.map((item, i) => (
                <li key={i} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-300 font-sans text-xs">{item.description}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    {item.keys.map((k, ki) => (
                      <kbd
                        key={ki}
                        className="px-2 py-0.5 hud-chip rounded text-zinc-200 font-mono text-[11px] shadow-sm"
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
        <div className="px-6 py-3 glass-bar border-t border-white/[0.08] flex items-center justify-between text-xs text-zinc-400 font-sans">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Info className="w-3.5 h-3.5 text-emerald-400" />
            <span>Keymap safety: Hotkeys are paused while entering text into input fields.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs rounded-lg transition-colors"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsModal;
