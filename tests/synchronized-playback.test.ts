import { describe, it, expect } from 'vitest';
import {
  calculatePlayerAlignment,
  PlaybackSyncContext,
  PlaybackSyncProvider,
  usePlaybackSync,
} from '../client/src/context/PlaybackSyncContext.js';

describe('Synchronized Playback Engine Time Alignment', () => {
  const segmentStart = new Date('2026-10-01T12:00:00.000Z').getTime();

  it('maps media currentTime to absolute UTC time correctly', () => {
    const currentTimeSec = 15.2;
    const absTimeMs = segmentStart + currentTimeSec * 1000;
    const targetTimestampMs = new Date('2026-10-01T12:00:15.300Z').getTime();

    const alignment = calculatePlayerAlignment({
      segmentStartMs: segmentStart,
      currentTimeSec,
      targetTimestampMs,
      toleranceMs: 200,
    });

    expect(alignment.skewMs).toBe(100);
    expect(alignment.needsReseek).toBe(false);
  });

  it('triggers re-seek when skew exceeds 200ms threshold', () => {
    const currentTimeSec = 10.0;
    const targetTimestampMs = new Date('2026-10-01T12:00:10.500Z').getTime(); // 500ms ahead

    const alignment = calculatePlayerAlignment({
      segmentStartMs: segmentStart,
      currentTimeSec,
      targetTimestampMs,
      toleranceMs: 200,
    });

    expect(alignment.skewMs).toBe(500);
    expect(alignment.needsReseek).toBe(true);
    expect(alignment.suggestedSeekSec).toBe(10.5);
  });

  it('uses default 200ms tolerance when toleranceMs is omitted', () => {
    const currentTimeSec = 10.0;
    // 150ms skew -> within 200ms
    const targetWithin = segmentStart + 10150;
    const resWithin = calculatePlayerAlignment({
      segmentStartMs: segmentStart,
      currentTimeSec,
      targetTimestampMs: targetWithin,
    });
    expect(resWithin.needsReseek).toBe(false);

    // 250ms skew -> exceeds 200ms
    const targetExceed = segmentStart + 10250;
    const resExceed = calculatePlayerAlignment({
      segmentStartMs: segmentStart,
      currentTimeSec,
      targetTimestampMs: targetExceed,
    });
    expect(resExceed.needsReseek).toBe(true);
  });

  it('handles player ahead of target timestamp', () => {
    const currentTimeSec = 20.0;
    const targetTimestampMs = segmentStart + 19000; // player is 1000ms ahead
    const alignment = calculatePlayerAlignment({
      segmentStartMs: segmentStart,
      currentTimeSec,
      targetTimestampMs,
      toleranceMs: 200,
    });

    expect(alignment.skewMs).toBe(1000);
    expect(alignment.needsReseek).toBe(true);
    expect(alignment.suggestedSeekSec).toBe(19.0);
  });

  it('clamps suggestedSeekSec to 0 when target is before segment start', () => {
    const currentTimeSec = 1.0;
    const targetTimestampMs = segmentStart - 5000;
    const alignment = calculatePlayerAlignment({
      segmentStartMs: segmentStart,
      currentTimeSec,
      targetTimestampMs,
      toleranceMs: 200,
    });

    expect(alignment.suggestedSeekSec).toBe(0);
    expect(alignment.needsReseek).toBe(true);
  });

  it('exports PlaybackSyncContext, PlaybackSyncProvider, and usePlaybackSync', () => {
    expect(PlaybackSyncContext).toBeDefined();
    expect(PlaybackSyncProvider).toBeDefined();
    expect(typeof usePlaybackSync).toBe('function');
  });
});
