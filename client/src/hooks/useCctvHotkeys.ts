import { useEffect, useRef, useState, useCallback } from 'react';

export type CctvMode = 'LIVE' | 'PLAYBACK';

/**
 * Shuttle speed state machine transition resolver.
 * Follows the standard CCTV Jog-Shuttle progression:
 * - 'k': Immediately stops shuttle (resets to 0)
 * - 'l': In forward (>=0), increments 1 -> 2 -> 4 -> 8 (capped at 8)
 *        In reverse (<0), steps back -8 -> -4 -> -2 -> -1 -> 0
 * - 'j': In reverse (<=0), increments -1 -> -2 -> -4 -> -8 (capped at -8)
 *        In forward (>0), steps back 8 -> 4 -> 2 -> 1 -> 0
 */
export function resolveShuttleTransition({
  currentSpeed,
  key,
}: {
  currentSpeed: number;
  key: string;
}): number {
  const normalizedKey = key.toLowerCase();
  const forwardLadder = [1, 2, 4, 8];
  const reverseLadder = [-1, -2, -4, -8];

  if (normalizedKey === 'k') return 0;

  if (normalizedKey === 'l') {
    if (currentSpeed < 0) {
      // Step back toward zero
      const idx = reverseLadder.indexOf(currentSpeed);
      return idx > 0 ? reverseLadder[idx - 1] : 0;
    }
    const idx = forwardLadder.indexOf(currentSpeed);
    return idx === -1 ? 1 : Math.min(8, forwardLadder[Math.min(forwardLadder.length - 1, idx + 1)]);
  }

  if (normalizedKey === 'j') {
    if (currentSpeed > 0) {
      // Step back toward zero
      const idx = forwardLadder.indexOf(currentSpeed);
      return idx > 0 ? forwardLadder[idx - 1] : 0;
    }
    const idx = reverseLadder.indexOf(currentSpeed);
    return idx === -1 ? -1 : Math.max(-8, reverseLadder[Math.min(reverseLadder.length - 1, idx + 1)]);
  }

  return currentSpeed;
}

export type CctvActionType =
  | 'IGNORED'
  | 'FOCUS_CHANNEL'
  | 'RETURN_TO_GRID'
  | 'TOGGLE_CHANNEL_SWITCHER'
  | 'TOGGLE_FULLSCREEN'
  | 'TOGGLE_SHORTCUTS'
  | 'TOGGLE_PLAY_PAUSE'
  | 'SHUTTLE_TRANSITION'
  | 'SEEK_RELATIVE'
  | 'STEP_FRAME'
  | 'FOCUS_PLAYBACK_SLOT'
  | 'ADD_BOOKMARK'
  | 'ESCAPE';

export interface EvaluateKeyEventInput {
  mode: CctvMode;
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  targetTagName?: string;
  isContentEditable?: boolean;
  currentShuttleSpeed?: number;
}

export interface EvaluateKeyEventResult {
  action: CctvActionType;
  preventDefault: boolean;
  channelNumber?: number;
  slotNumber?: number;
  newSpeed?: number;
  deltaMs?: number;
  frameCount?: number;
}

/**
 * Pure evaluator for CCTV keyboard events.
 * Implements keymap safety guards (ignoring inputs/textareas/editable content and system modifier keys)
 * and determines the exact CCTV action according to current context mode.
 */
export function evaluateCctvKeyEvent(input: EvaluateKeyEventInput): EvaluateKeyEventResult {
  const {
    mode,
    key,
    code,
    shiftKey = false,
    ctrlKey = false,
    altKey = false,
    metaKey = false,
    targetTagName,
    isContentEditable = false,
    currentShuttleSpeed = 0,
  } = input;

  // 1. Keymap safety guard: Ignore events when typing in inputs/textareas/select or editable content
  if (isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTagName?.toUpperCase() || '')) {
    return { action: 'IGNORED', preventDefault: false };
  }

  // 2. Pass through browser system combinations (Ctrl, Meta/Cmd, Alt)
  if (ctrlKey || metaKey || altKey) {
    return { action: 'IGNORED', preventDefault: false };
  }

  // 3. Global hotkey: '?' toggles shortcut cheat sheet
  if (key === '?') {
    return { action: 'TOGGLE_SHORTCUTS', preventDefault: true };
  }

  // 4. Mode-specific hotkey maps
  if (mode === 'LIVE') {
    // '1'-'9': Focus channel 1-9
    if (/^[1-9]$/.test(key)) {
      return {
        action: 'FOCUS_CHANNEL',
        channelNumber: parseInt(key, 10),
        preventDefault: true,
      };
    }

    // '0' or 'Escape': Return to grid view
    if (key === '0' || key === 'Escape') {
      return {
        action: 'RETURN_TO_GRID',
        preventDefault: true,
      };
    }

    // 'G' / 'g': Toggle quick channel switcher modal
    if (key === 'g' || key === 'G') {
      return {
        action: 'TOGGLE_CHANNEL_SWITCHER',
        preventDefault: true,
      };
    }

    // 'F' / 'f': Toggle fullscreen
    if (key === 'f' || key === 'F') {
      return {
        action: 'TOGGLE_FULLSCREEN',
        preventDefault: true,
      };
    }
  } else if (mode === 'PLAYBACK') {
    // Space: Toggle play/pause
    if (key === ' ' || code === 'Space') {
      return {
        action: 'TOGGLE_PLAY_PAUSE',
        preventDefault: true,
      };
    }

    // 'J', 'K', 'L': Jog-shuttle state machine transitions
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'j' || lowerKey === 'k' || lowerKey === 'l') {
      const nextSpeed = resolveShuttleTransition({
        currentSpeed: currentShuttleSpeed,
        key: lowerKey,
      });
      return {
        action: 'SHUTTLE_TRANSITION',
        newSpeed: nextSpeed,
        preventDefault: true,
      };
    }

    // Left / Right arrows: 5s seek (or 30s with Shift) with 60ms seek-coalescing
    if (key === 'ArrowLeft') {
      return {
        action: 'SEEK_RELATIVE',
        deltaMs: shiftKey ? -30000 : -5000,
        preventDefault: true,
      };
    }

    if (key === 'ArrowRight') {
      return {
        action: 'SEEK_RELATIVE',
        deltaMs: shiftKey ? 30000 : 5000,
        preventDefault: true,
      };
    }

    // Up / Down arrows: 1 frame step (~33ms = 1/30th sec)
    if (key === 'ArrowUp') {
      return {
        action: 'STEP_FRAME',
        frameCount: 1,
        deltaMs: Math.round(1000 / 30),
        preventDefault: true,
      };
    }

    if (key === 'ArrowDown') {
      return {
        action: 'STEP_FRAME',
        frameCount: -1,
        deltaMs: -Math.round(1000 / 30),
        preventDefault: true,
      };
    }

    // '1'-'4': Focus playback camera slot 1–4
    if (/^[1-4]$/.test(key)) {
      return {
        action: 'FOCUS_PLAYBACK_SLOT',
        slotNumber: parseInt(key, 10),
        preventDefault: true,
      };
    }

    // 'B' / 'b': Add bookmark
    if (key === 'b' || key === 'B') {
      return {
        action: 'ADD_BOOKMARK',
        preventDefault: true,
      };
    }

    // '0' or 'Escape'
    if (key === '0' || key === 'Escape') {
      return {
        action: 'ESCAPE',
        preventDefault: false,
      };
    }
  }

  return { action: 'IGNORED', preventDefault: false };
}

export interface UseCctvHotkeysOptions {
  mode: CctvMode;
  enabled?: boolean;

  // LIVE mode callbacks
  onFocusChannel?: (channelNumber: number) => void; // 1-9
  onReturnToGrid?: () => void; // 0 or Escape
  onToggleChannelSwitcher?: () => void; // G
  onToggleFullscreen?: () => void; // F

  // PLAYBACK mode callbacks
  onTogglePlayPause?: () => void; // Space
  onShuttleChange?: (newSpeed: number) => void; // J, K, L
  currentShuttleSpeed?: number;
  onSeekRelativeMs?: (deltaMs: number) => void; // Arrows (debounced 60ms)
  onStepFrame?: (frameCount: number) => void; // Up (+1 frame = ~33ms) / Down (-1 frame = -33ms)
  onFocusPlaybackSlot?: (slotNumber: number) => void; // 1-4
  onAddBookmark?: () => void; // B

  // Common callbacks
  onToggleShortcutsModal?: () => void; // ?
  onEscape?: () => void;
  onHudNotification?: (badgeText: string) => void;
}

export interface UseCctvHotkeysReturn {
  isChannelSwitcherOpen: boolean;
  setIsChannelSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isShortcutsOpen: boolean;
  setIsShortcutsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hudBadgeText: string | null;
  triggerHud: (text: string) => void;
}

/**
 * Two-Context CCTV Keyboard Hotkeys Engine.
 * Supports Mode LIVE and Mode PLAYBACK with keymap safety guards,
 * 60ms seek-coalescing debounce, and accessible HUD badges.
 */
export function useCctvHotkeys(options: UseCctvHotkeysOptions): UseCctvHotkeysReturn {
  const { mode, enabled = true } = options;

  const [isChannelSwitcherOpen, setIsChannelSwitcherOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);
  const [hudBadgeText, setHudBadgeText] = useState<string | null>(null);

  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeekDeltaRef = useRef<number>(0);
  const seekDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep options in a ref to avoid stale closures in window event listeners
  const optionsRef = useRef<UseCctvHotkeysOptions>(options);
  optionsRef.current = options;

  const triggerHud = useCallback((text: string) => {
    setHudBadgeText(text);
    if (optionsRef.current.onHudNotification) {
      optionsRef.current.onHudNotification(text);
    }
    if (hudTimerRef.current) {
      clearTimeout(hudTimerRef.current);
    }
    hudTimerRef.current = setTimeout(() => {
      setHudBadgeText(null);
      hudTimerRef.current = null;
    }, 1500);
  }, []);

  // 60ms seek-coalescing queue for high-frequency Left/Right arrow keypresses
  const queueSeek = useCallback(
    (deltaMs: number, customLabel?: string) => {
      pendingSeekDeltaRef.current += deltaMs;
      const totalDelta = pendingSeekDeltaRef.current;

      if (customLabel) {
        triggerHud(customLabel);
      } else {
        const totalSec = Math.round(totalDelta / 1000);
        const sign = totalSec >= 0 ? '+' : '';
        triggerHud(`[ ${sign}${totalSec}s ]`);
      }

      if (seekDebounceTimerRef.current) {
        clearTimeout(seekDebounceTimerRef.current);
      }

      seekDebounceTimerRef.current = setTimeout(() => {
        const finalDelta = pendingSeekDeltaRef.current;
        pendingSeekDeltaRef.current = 0;
        seekDebounceTimerRef.current = null;
        if (finalDelta !== 0) {
          optionsRef.current.onSeekRelativeMs?.(finalDelta);
        }
      }, 60);
    },
    [triggerHud]
  );

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;

      const evalResult = evaluateCctvKeyEvent({
        mode,
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        targetTagName: target?.tagName,
        isContentEditable: target?.isContentEditable,
        currentShuttleSpeed: optionsRef.current.currentShuttleSpeed,
      });

      if (evalResult.preventDefault) {
        e.preventDefault();
      }

      switch (evalResult.action) {
        case 'TOGGLE_SHORTCUTS':
          if (optionsRef.current.onToggleShortcutsModal) {
            optionsRef.current.onToggleShortcutsModal();
          } else {
            setIsShortcutsOpen((prev) => !prev);
          }
          break;

        case 'FOCUS_CHANNEL':
          if (evalResult.channelNumber) {
            triggerHud(`[ Channel ${evalResult.channelNumber} ]`);
            optionsRef.current.onFocusChannel?.(evalResult.channelNumber);
          }
          break;

        case 'RETURN_TO_GRID':
          triggerHud('[ Grid View ]');
          optionsRef.current.onReturnToGrid?.();
          break;

        case 'TOGGLE_CHANNEL_SWITCHER':
          if (optionsRef.current.onToggleChannelSwitcher) {
            optionsRef.current.onToggleChannelSwitcher();
          } else {
            setIsChannelSwitcherOpen((prev) => !prev);
          }
          break;

        case 'TOGGLE_FULLSCREEN':
          triggerHud('[ Fullscreen ]');
          if (optionsRef.current.onToggleFullscreen) {
            optionsRef.current.onToggleFullscreen();
          } else {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            } else {
              document.exitFullscreen().catch(() => {});
            }
          }
          break;

        case 'TOGGLE_PLAY_PAUSE':
          optionsRef.current.onTogglePlayPause?.();
          break;

        case 'SHUTTLE_TRANSITION': {
          const speed = evalResult.newSpeed ?? 0;
          if (speed === 0) {
            triggerHud('[ Paused ]');
          } else if (speed > 0) {
            triggerHud(`[ ${speed}x ⏩ ]`);
          } else {
            triggerHud(`[ ${speed}x ⏪ ]`);
          }
          optionsRef.current.onShuttleChange?.(speed);
          break;
        }

        case 'SEEK_RELATIVE':
          if (evalResult.deltaMs !== undefined) {
            queueSeek(evalResult.deltaMs);
          }
          break;

        case 'STEP_FRAME':
          if (evalResult.frameCount && evalResult.frameCount > 0) {
            triggerHud('[ Frame +1 ]');
          } else {
            triggerHud('[ Frame -1 ]');
          }
          if (optionsRef.current.onStepFrame && evalResult.frameCount) {
            optionsRef.current.onStepFrame(evalResult.frameCount);
          } else if (evalResult.deltaMs !== undefined) {
            optionsRef.current.onSeekRelativeMs?.(evalResult.deltaMs);
          }
          break;

        case 'FOCUS_PLAYBACK_SLOT':
          if (evalResult.slotNumber) {
            triggerHud(`[ Slot ${evalResult.slotNumber} ]`);
            optionsRef.current.onFocusPlaybackSlot?.(evalResult.slotNumber);
          }
          break;

        case 'ADD_BOOKMARK':
          optionsRef.current.onAddBookmark?.();
          break;

        case 'ESCAPE':
          if (isChannelSwitcherOpen) {
            setIsChannelSwitcherOpen(false);
          } else if (isShortcutsOpen) {
            setIsShortcutsOpen(false);
          } else {
            optionsRef.current.onEscape?.();
          }
          break;

        case 'IGNORED':
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (seekDebounceTimerRef.current) {
        clearTimeout(seekDebounceTimerRef.current);
      }
      if (hudTimerRef.current) {
        clearTimeout(hudTimerRef.current);
      }
    };
  }, [mode, enabled, isChannelSwitcherOpen, isShortcutsOpen, queueSeek, triggerHud]);

  return {
    isChannelSwitcherOpen,
    setIsChannelSwitcherOpen,
    isShortcutsOpen,
    setIsShortcutsOpen,
    hudBadgeText,
    triggerHud,
  };
}
