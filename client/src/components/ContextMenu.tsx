import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick?: () => void;
  divider?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  title?: string;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  items,
  onClose,
  title,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss on click outside or Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onClose]);

  // Adjust position so it doesn't overflow viewport boundaries
  const adjustedX = Math.min(x, window.innerWidth - 240);
  const adjustedY = Math.min(y, window.innerHeight - 380);

  return createPortal(
    <div
      ref={menuRef}
      style={{ left: `${Math.max(8, adjustedX)}px`, top: `${Math.max(8, adjustedY)}px` }}
      className="fixed z-[99999] min-w-[220px] bg-[#111827]/95 border border-[#1f2937] rounded-xl shadow-2xl py-1.5 backdrop-blur-md text-xs text-slate-200 select-none animate-in fade-in zoom-in-95 duration-100 ring-1 ring-white/10"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {title && (
        <div className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider text-[#4fc3f7] uppercase border-b border-[#1f2937]/80 mb-1 flex items-center justify-between">
          <span>{title}</span>
          <span className="text-slate-500 font-normal">ESC to close</span>
        </div>
      )}

      {items.map((item) => {
        if (item.divider) {
          return <div key={item.id} className="h-px bg-[#1f2937] my-1" />;
        }

        return (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            className={`w-full flex items-center justify-between px-3 py-1.5 transition-colors text-left ${
              item.disabled
                ? 'opacity-40 cursor-not-allowed text-slate-500'
                : item.danger
                ? 'text-red-400 hover:bg-red-950/40 hover:text-red-300'
                : 'hover:bg-[#4fc3f7]/15 hover:text-[#4fc3f7] text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {item.icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{item.icon}</span>}
              <span className="font-medium">{item.label}</span>
            </div>
            {item.shortcut && (
              <span className="text-[10px] font-mono text-slate-400 bg-[#090d16] px-1.5 py-0.5 rounded border border-[#1f2937] ml-3">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
