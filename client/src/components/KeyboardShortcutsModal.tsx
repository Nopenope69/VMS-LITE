import React from 'react';
import { X, Keyboard, Video, History, HelpCircle } from 'lucide-react';

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const sections = [
    {
      title: 'Live Monitor Controls',
      icon: <Video className="w-4 h-4 text-[#4fc3f7]" />,
      shortcuts: [
        { keys: ['1', '2', '3'], desc: 'Switch Grid Layout (1x1, 2x2, 3x3)' },
        { keys: ['T'], desc: 'Toggle Guard Tour Layout Mode' },
        { keys: ['F', 'Double-Click'], desc: 'Toggle Maximize / Fullscreen Camera' },
        { keys: ['Shift', 'S'], desc: 'Instant 1-Click Camera Snapshot' },
        { keys: ['Shift', 'C'], desc: 'Snip Region Snapshot (Box Drag Gesture)' },
        { keys: ['M'], desc: 'Mute / Unmute Guard Notification Chime' },
        { keys: ['R'], desc: 'Refresh All Camera Video Feeds' },
        { keys: ['Right-Click'], desc: 'Open Surveillance Context Menu on Camera' },
      ],
    },
    {
      title: 'Playback & Investigation',
      icon: <History className="w-4 h-4 text-[#fb923c]" />,
      shortcuts: [
        { keys: ['Space'], desc: 'Play / Pause Recorded Video' },
        { keys: ['←', '→'], desc: 'Step Frame (-1s / +1s)' },
        { keys: ['Shift', '←', '→'], desc: 'Seek 10 Seconds Backward / Forward' },
        { keys: ['B'], desc: 'Create Bookmark at Playhead Time' },
        { keys: ['E'], desc: 'Open Section 65B Legal Clip Export Modal' },
        { keys: ['S'], desc: 'Open Smart Motion Search' },
      ],
    },
    {
      title: 'General & Navigation',
      icon: <HelpCircle className="w-4 h-4 text-emerald-400" />,
      shortcuts: [
        { keys: ['?'], desc: 'Show / Hide Keyboard Shortcuts' },
        { keys: ['Esc'], desc: 'Cancel Snip / Exit Fullscreen / Close Modals' },
        { keys: ['Shift', 'Drag'], desc: 'Mouse Gesture: Drag Box to Crop Snapshot' },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#090d16] border-b border-[#1f2937]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/30 text-[#4fc3f7]">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 font-mono tracking-wide">
                OPERATOR KEYBOARD SHORTCUTS
              </h2>
              <p className="text-[11px] text-slate-400">
                Rapid surveillance navigation for security desks
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {sections.map((sec, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex items-center gap-2 pb-1 border-b border-[#1f2937]/70 text-slate-300 font-semibold font-mono text-[11px]">
                {sec.icon}
                <span>{sec.title.toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {sec.shortcuts.map((sc, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 rounded-lg bg-[#090d16]/70 border border-[#1f2937] hover:border-[#4fc3f7]/40 transition-colors"
                  >
                    <span className="text-slate-300 pr-2">{sc.desc}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {sc.keys.map((k, ki) => (
                        <kbd
                          key={ki}
                          className="px-2 py-0.5 rounded bg-[#1f2937] text-[#4fc3f7] font-mono text-[10px] font-bold border border-slate-700 shadow-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#090d16] border-t border-[#1f2937] text-[11px] text-slate-400">
          <span>Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-[#1f2937] text-[#4fc3f7] font-mono text-[10px]">?</kbd> anywhere in the console to toggle this screen</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold rounded-lg text-xs transition-colors"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
