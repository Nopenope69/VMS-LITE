import React, { useEffect, useState } from 'react';

export interface FloatingHudBadgeProps {
  /**
   * The text label to display on the HUD badge (e.g. '[ +5s ]', '[ Frame +1 ]', '[ 2x ⏩ ]', '[ Paused ]').
   * If null, undefined, or empty string, the badge is hidden.
   */
  text?: string | null;
  /**
   * Auto-fade duration in milliseconds (default: 1500ms = 1.5s).
   */
  durationMs?: number;
  /**
   * Optional callback when badge auto-dismisses.
   */
  onDismiss?: () => void;
  /**
   * Optional custom styling overrides.
   */
  className?: string;
}

/**
 * Accessible Heads-Up Display (HUD) Transient Badge for CCTV Operators.
 * Renders over active camera tiles / playback viewport with role="status" and aria-live="polite".
 * Automatically fades after 1.5s.
 */
export const FloatingHudBadge: React.FC<FloatingHudBadgeProps> = ({
  text,
  durationMs = 1500,
  onDismiss,
  className = '',
}) => {
  const [visibleText, setVisibleText] = useState<string | null>(text || null);
  const [isVisible, setIsVisible] = useState<boolean>(Boolean(text));

  useEffect(() => {
    if (!text) {
      setIsVisible(false);
      return;
    }

    setVisibleText(text);
    setIsVisible(true);

    const timer = setTimeout(() => {
      setIsVisible(false);
      onDismiss?.();
    }, durationMs);

    return () => clearTimeout(timer);
  }, [text, durationMs, onDismiss]);

  if (!visibleText || !isVisible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center transition-all duration-200 ease-out animate-in fade-in zoom-in-95 ${className}`}
    >
      <div className="flex items-center gap-2 px-4 py-2 bg-[#090d16]/90 backdrop-blur-md border border-[#4fc3f7]/60 rounded-lg shadow-[0_0_20px_rgba(79,195,247,0.35)] text-slate-100 font-mono text-sm sm:text-base font-bold tracking-wider select-none">
        <span className="w-2 h-2 rounded-full bg-[#4fc3f7] animate-ping shrink-0" />
        <span className="text-[#4fc3f7] drop-shadow-[0_0_8px_rgba(79,195,247,0.5)]">
          {visibleText}
        </span>
      </div>
    </div>
  );
};

export default FloatingHudBadge;
