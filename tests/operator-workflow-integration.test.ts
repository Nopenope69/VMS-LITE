import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { resolveStreamProfile } from '../client/src/utils/streamProfileManager.js';
import { resolveShuttleTransition, evaluateCctvKeyEvent } from '../client/src/hooks/useCctvHotkeys.js';
import { calculatePlayerAlignment } from '../client/src/context/PlaybackSyncContext.js';

describe('Sub-Project A: Operator Workflow & Stream Polish End-to-End', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Task 1 & 3: Dual-Stream Resolution ───────────────────────────────

  it('resolves SUB stream in GRID mode with AUTO override', () => {
    const result = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'AUTO',
      mainPath: 'cam1',
      subPath: 'cam1_sub',
    });
    expect(result.path).toBe('cam1_sub');
    expect(result.isHdOnly).toBe(false);
  });

  it('resolves MAIN stream in FOCUSED mode with AUTO override', () => {
    const result = resolveStreamProfile({
      viewMode: 'FOCUSED',
      operatorOverride: 'AUTO',
      mainPath: 'cam1',
      subPath: 'cam1_sub',
    });
    expect(result.path).toBe('cam1');
  });

  it('falls back to MAIN with HD-only badge when no sub-stream exists', () => {
    const result = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'AUTO',
      mainPath: 'cam1',
    });
    expect(result.path).toBe('cam1');
    expect(result.isHdOnly).toBe(true);
  });

  it('respects operator HD override regardless of view mode', () => {
    const result = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'HD',
      mainPath: 'cam1',
      subPath: 'cam1_sub',
    });
    expect(result.path).toBe('cam1');
    expect(result.isHdOnly).toBe(false);
  });

  // ─── Task 4: Synchronized Playback Alignment ──────────────────────────

  it('detects drift requiring reseek when skew exceeds tolerance', () => {
    const result = calculatePlayerAlignment({
      segmentStartMs: 1000000,
      currentTimeSec: 5.0,
      targetTimestampMs: 1010000,
      toleranceMs: 200,
    });
    expect(result.skewMs).toBe(5000);
    expect(result.needsReseek).toBe(true);
    expect(result.suggestedSeekSec).toBe(10);
  });

  it('reports no reseek needed when player is aligned within tolerance', () => {
    const result = calculatePlayerAlignment({
      segmentStartMs: 1000000,
      currentTimeSec: 5.0,
      targetTimestampMs: 1005100,
      toleranceMs: 200,
    });
    expect(result.skewMs).toBe(100);
    expect(result.needsReseek).toBe(false);
  });

  // ─── Task 5: Jog-Shuttle State Machine ────────────────────────────────

  it('walks the full forward shuttle ladder: 0 → 1 → 2 → 4 → 8', () => {
    let speed = 0;
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'l' });
    expect(speed).toBe(1);
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'l' });
    expect(speed).toBe(2);
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'l' });
    expect(speed).toBe(4);
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'l' });
    expect(speed).toBe(8);
    // Capped at 8
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'l' });
    expect(speed).toBe(8);
  });

  it('K immediately resets shuttle to 0 from any speed', () => {
    expect(resolveShuttleTransition({ currentSpeed: 4, key: 'k' })).toBe(0);
    expect(resolveShuttleTransition({ currentSpeed: -8, key: 'k' })).toBe(0);
  });

  it('reversal via J from forward steps back: 8 → 4 → 2 → 1 → 0', () => {
    let speed = 8;
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'j' });
    expect(speed).toBe(4);
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'j' });
    expect(speed).toBe(2);
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'j' });
    expect(speed).toBe(1);
    speed = resolveShuttleTransition({ currentSpeed: speed, key: 'j' });
    expect(speed).toBe(0);
  });

  // ─── Task 5: Two-Context Keymap Safety ────────────────────────────────

  it('LIVE mode: ignores playback-only keys (Space, J, K, L, arrows)', () => {
    for (const key of [' ', 'j', 'k', 'l', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const result = evaluateCctvKeyEvent({ mode: 'LIVE', key });
      expect(result.action).toBe('IGNORED');
    }
  });

  it('PLAYBACK mode: maps 1-4 to slots but ignores 5-9', () => {
    for (const key of ['1', '2', '3', '4']) {
      const result = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key });
      expect(result.action).toBe('FOCUS_PLAYBACK_SLOT');
    }
    for (const key of ['5', '6', '7', '8', '9']) {
      const result = evaluateCctvKeyEvent({ mode: 'PLAYBACK', key });
      expect(result.action).toBe('IGNORED');
    }
  });

  it('ignores hotkeys when target is an input element', () => {
    const result = evaluateCctvKeyEvent({ mode: 'LIVE', key: '1', targetTagName: 'INPUT' });
    expect(result.action).toBe('IGNORED');
  });

  // ─── Server Integration ───────────────────────────────────────────────

  it('health endpoint returns 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('snapshot endpoint requires authentication (rejects unauthenticated)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      payload: { image: 'dGVzdA==', cameraId: 'test', timestampUtc: new Date().toISOString() },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});
