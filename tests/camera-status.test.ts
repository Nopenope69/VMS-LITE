import { describe, it, expect } from 'vitest';
import { HealthSample, INITIAL_STATUS, nextCameraStatus, StatusMemory } from '../src/health/camera-status.js';

const healthy: HealthSample = { networkCheck: 'PASSED', latencyMs: 20, streamReady: true, bitrateKbps: 2000 };
const unreachable: HealthSample = { networkCheck: 'FAILED', latencyMs: null, networkError: 'ECONNREFUSED', streamReady: false, bitrateKbps: 0 };
const notStreaming: HealthSample = { networkCheck: 'PASSED', latencyMs: 20, streamReady: false, bitrateKbps: 0 };

/** Feeds samples at the given second offsets; returns the status after each. */
function run(samples: Array<[number, HealthSample]>, start: StatusMemory = { ...INITIAL_STATUS, status: 'ONLINE' }) {
  let memory = start;
  return samples.map(([second, sample]) => {
    const next = nextCameraStatus(memory, sample, second * 1000);
    memory = next.memory;
    return { status: memory.status, reason: next.reason, outage: next.outageDurationMs };
  });
}

describe('Camera status state machine', () => {
  it('ignores a single bad sample', () => {
    expect(run([[0, notStreaming], [10, healthy]]).map((r) => r.status)).toEqual(['ONLINE', 'ONLINE']);
  });

  it('degrades on the second failing sample while reachable', () => {
    const [, second] = run([[0, notStreaming], [10, notStreaming]]);
    expect(second.status).toBe('DEGRADED');
    expect(second.reason).toMatch(/not ready/);
  });

  it('goes offline only after 30 s unreachable, degrading meanwhile', () => {
    expect(run([[0, unreachable], [10, unreachable], [20, unreachable], [30, unreachable]]).map((r) => r.status)).toEqual([
      'ONLINE', 'DEGRADED', 'DEGRADED', 'OFFLINE',
    ]);
  });

  it('recovers on one healthy sample and reports how long it was unhealthy', () => {
    const results = run([[0, unreachable], [10, unreachable], [40, unreachable], [55, healthy]]);
    expect(results[3]).toMatchObject({ status: 'ONLINE', outage: 55_000, reason: undefined });
  });

  it('treats a warming-up bitrate and an uncheckable network as healthy', () => {
    const warmUp: HealthSample = { networkCheck: 'NOT_APPLICABLE', latencyMs: null, streamReady: true, bitrateKbps: null };
    expect(run([[0, warmUp]], INITIAL_STATUS)[0].status).toBe('ONLINE');
  });

  it('flags high latency and a starved stream as degradation reasons', () => {
    expect(run([[0, { ...healthy, latencyMs: 800 }]])[0].reason).toMatch(/High network latency/);
    expect(run([[0, { ...healthy, bitrateKbps: 30 }]])[0].reason).toMatch(/Low stream bitrate/);
  });
});
