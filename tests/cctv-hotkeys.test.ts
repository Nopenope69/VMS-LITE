import { describe, it, expect } from 'vitest';
import {
  resolveShuttleTransition,
  evaluateCctvKeyEvent,
} from '../client/src/hooks/useCctvHotkeys.js';

describe('CCTV Jog-Shuttle State Machine Transitions', () => {
  it('increments forward shuttle speeds with L (1x -> 2x -> 4x -> 8x)', () => {
    expect(resolveShuttleTransition({ currentSpeed: 0, key: 'l' })).toBe(1);
    expect(resolveShuttleTransition({ currentSpeed: 1, key: 'l' })).toBe(2);
    expect(resolveShuttleTransition({ currentSpeed: 2, key: 'l' })).toBe(4);
    expect(resolveShuttleTransition({ currentSpeed: 4, key: 'l' })).toBe(8);
    expect(resolveShuttleTransition({ currentSpeed: 8, key: 'l' })).toBe(8); // Capped
  });

  it('increments reverse shuttle speeds with J (-1x -> -2x -> -4x -> -8x)', () => {
    expect(resolveShuttleTransition({ currentSpeed: 0, key: 'j' })).toBe(-1);
    expect(resolveShuttleTransition({ currentSpeed: -1, key: 'j' })).toBe(-2);
    expect(resolveShuttleTransition({ currentSpeed: -2, key: 'j' })).toBe(-4);
    expect(resolveShuttleTransition({ currentSpeed: -4, key: 'j' })).toBe(-8);
    expect(resolveShuttleTransition({ currentSpeed: -8, key: 'j' })).toBe(-8); // Capped
  });

  it('steps reverse speed back toward zero when pressing L while in reverse', () => {
    expect(resolveShuttleTransition({ currentSpeed: -8, key: 'l' })).toBe(-4);
    expect(resolveShuttleTransition({ currentSpeed: -4, key: 'l' })).toBe(-2);
    expect(resolveShuttleTransition({ currentSpeed: -2, key: 'l' })).toBe(-1);
    expect(resolveShuttleTransition({ currentSpeed: -1, key: 'l' })).toBe(0);
  });

  it('steps forward speed back toward zero when pressing J while in forward', () => {
    expect(resolveShuttleTransition({ currentSpeed: 8, key: 'j' })).toBe(4);
    expect(resolveShuttleTransition({ currentSpeed: 4, key: 'j' })).toBe(2);
    expect(resolveShuttleTransition({ currentSpeed: 2, key: 'j' })).toBe(1);
    expect(resolveShuttleTransition({ currentSpeed: 1, key: 'j' })).toBe(0);
  });

  it('immediately stops shuttle and resets speed to 0 when pressing K', () => {
    expect(resolveShuttleTransition({ currentSpeed: 4, key: 'k' })).toBe(0);
    expect(resolveShuttleTransition({ currentSpeed: -8, key: 'k' })).toBe(0);
    expect(resolveShuttleTransition({ currentSpeed: 1, key: 'k' })).toBe(0);
    expect(resolveShuttleTransition({ currentSpeed: 0, key: 'k' })).toBe(0);
  });

  it('handles uppercase keys (J, K, L)', () => {
    expect(resolveShuttleTransition({ currentSpeed: 0, key: 'L' })).toBe(1);
    expect(resolveShuttleTransition({ currentSpeed: 0, key: 'J' })).toBe(-1);
    expect(resolveShuttleTransition({ currentSpeed: 4, key: 'K' })).toBe(0);
  });

  it('preserves currentSpeed for unrecognized keys', () => {
    expect(resolveShuttleTransition({ currentSpeed: 2, key: 'x' })).toBe(2);
    expect(resolveShuttleTransition({ currentSpeed: -4, key: 'Space' })).toBe(-4);
  });
});

describe('Two-Context Keymap Safety & Event Evaluation', () => {
  it('ignores hotkey events targeting form input elements or contenteditable elements', () => {
    const fromInput = evaluateCctvKeyEvent({
      mode: 'LIVE',
      key: '1',
      targetTagName: 'INPUT',
    });
    expect(fromInput.action).toBe('IGNORED');
    expect(fromInput.preventDefault).toBe(false);

    const fromTextarea = evaluateCctvKeyEvent({
      mode: 'PLAYBACK',
      key: ' ',
      targetTagName: 'TEXTAREA',
    });
    expect(fromTextarea.action).toBe('IGNORED');

    const fromEditable = evaluateCctvKeyEvent({
      mode: 'LIVE',
      key: 'g',
      isContentEditable: true,
    });
    expect(fromEditable.action).toBe('IGNORED');
  });

  it('passes through browser system combinations (Ctrl, Meta/Cmd, Alt)', () => {
    const withCmd = evaluateCctvKeyEvent({
      mode: 'LIVE',
      key: '1',
      metaKey: true,
    });
    expect(withCmd.action).toBe('IGNORED');
    expect(withCmd.preventDefault).toBe(false);

    const withCtrl = evaluateCctvKeyEvent({
      mode: 'PLAYBACK',
      key: 'k',
      ctrlKey: true,
    });
    expect(withCtrl.action).toBe('IGNORED');

    const withAlt = evaluateCctvKeyEvent({
      mode: 'LIVE',
      key: 'f',
      altKey: true,
    });
    expect(withAlt.action).toBe('IGNORED');
  });

  it('evaluates global ? hotkey for shortcuts cheat sheet in any mode', () => {
    const liveHelp = evaluateCctvKeyEvent({ mode: 'LIVE', key: '?' });
    expect(liveHelp.action).toBe('TOGGLE_SHORTCUTS');
    expect(liveHelp.preventDefault).toBe(true);

    const playbackHelp = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: '?' });
    expect(playbackHelp.action).toBe('TOGGLE_SHORTCUTS');
    expect(playbackHelp.preventDefault).toBe(true);
  });

  describe('Mode LIVE Keymap Actions', () => {
    it('maps 1-9 to channel focus', () => {
      for (let i = 1; i <= 9; i++) {
        const res = evaluateCctvKeyEvent({ mode: 'LIVE', key: i.toString() });
        expect(res.action).toBe('FOCUS_CHANNEL');
        expect(res.channelNumber).toBe(i);
        expect(res.preventDefault).toBe(true);
      }
    });

    it('maps 0 and Escape to return to grid view', () => {
      const res0 = evaluateCctvKeyEvent({ mode: 'LIVE', key: '0' });
      expect(res0.action).toBe('RETURN_TO_GRID');
      expect(res0.preventDefault).toBe(true);

      const resEsc = evaluateCctvKeyEvent({ mode: 'LIVE', key: 'Escape' });
      expect(resEsc.action).toBe('RETURN_TO_GRID');
      expect(resEsc.preventDefault).toBe(true);
    });

    it('maps G/g to toggle quick channel switcher modal', () => {
      expect(evaluateCctvKeyEvent({ mode: 'LIVE', key: 'g' }).action).toBe('TOGGLE_CHANNEL_SWITCHER');
      expect(evaluateCctvKeyEvent({ mode: 'LIVE', key: 'G' }).action).toBe('TOGGLE_CHANNEL_SWITCHER');
    });

    it('maps F/f to toggle fullscreen', () => {
      expect(evaluateCctvKeyEvent({ mode: 'LIVE', key: 'f' }).action).toBe('TOGGLE_FULLSCREEN');
      expect(evaluateCctvKeyEvent({ mode: 'LIVE', key: 'F' }).action).toBe('TOGGLE_FULLSCREEN');
    });
  });

  describe('Mode PLAYBACK Keymap Actions', () => {
    it('maps Space to toggle play/pause with preventDefault', () => {
      const res = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: ' ' });
      expect(res.action).toBe('TOGGLE_PLAY_PAUSE');
      expect(res.preventDefault).toBe(true);
    });

    it('maps J, K, L to shuttle transitions with current speed state', () => {
      const forwardRes = evaluateCctvKeyEvent({
        mode: 'PLAYBACK',
        key: 'l',
        currentShuttleSpeed: 1,
      });
      expect(forwardRes.action).toBe('SHUTTLE_TRANSITION');
      expect(forwardRes.newSpeed).toBe(2);

      const stopRes = evaluateCctvKeyEvent({
        mode: 'PLAYBACK',
        key: 'k',
        currentShuttleSpeed: 4,
      });
      expect(stopRes.action).toBe('SHUTTLE_TRANSITION');
      expect(stopRes.newSpeed).toBe(0);

      const reverseRes = evaluateCctvKeyEvent({
        mode: 'PLAYBACK',
        key: 'j',
        currentShuttleSpeed: 0,
      });
      expect(reverseRes.action).toBe('SHUTTLE_TRANSITION');
      expect(reverseRes.newSpeed).toBe(-1);
    });

    it('maps Left/Right arrows to 5s seeks and Shift+Arrows to 30s seeks', () => {
      const left5s = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: 'ArrowLeft' });
      expect(left5s.action).toBe('SEEK_RELATIVE');
      expect(left5s.deltaMs).toBe(-5000);

      const right5s = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: 'ArrowRight' });
      expect(right5s.action).toBe('SEEK_RELATIVE');
      expect(right5s.deltaMs).toBe(5000);

      const left30s = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: 'ArrowLeft', shiftKey: true });
      expect(left30s.action).toBe('SEEK_RELATIVE');
      expect(left30s.deltaMs).toBe(-30000);

      const right30s = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: 'ArrowRight', shiftKey: true });
      expect(right30s.action).toBe('SEEK_RELATIVE');
      expect(right30s.deltaMs).toBe(30000);
    });

    it('maps Up/Down arrows to single frame stepping (~33ms)', () => {
      const frameUp = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: 'ArrowUp' });
      expect(frameUp.action).toBe('STEP_FRAME');
      expect(frameUp.frameCount).toBe(1);
      expect(frameUp.deltaMs).toBe(33);

      const frameDown = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: 'ArrowDown' });
      expect(frameDown.action).toBe('STEP_FRAME');
      expect(frameDown.frameCount).toBe(-1);
      expect(frameDown.deltaMs).toBe(-33);
    });

    it('maps 1-4 to focus playback camera slots', () => {
      for (let s = 1; s <= 4; s++) {
        const res = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: s.toString() });
        expect(res.action).toBe('FOCUS_PLAYBACK_SLOT');
        expect(res.slotNumber).toBe(s);
      }
    });

    it('maps B/b to add incident bookmark', () => {
      expect(evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: 'b' }).action).toBe('ADD_BOOKMARK');
      expect(evaluateCctvKeyEvent({ mode: 'PLAYBACK', key: 'B' }).action).toBe('ADD_BOOKMARK');
    });
  });
});
