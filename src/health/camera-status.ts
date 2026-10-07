import { CameraHealthStatus, NetworkCheckResult } from './health.types.js';

/** One health poll of a camera. */
export interface HealthSample {
  networkCheck: NetworkCheckResult;
  latencyMs: number | null;
  networkError?: string;
  streamReady: boolean;
  /** null on the first sample after start or a counter reset (warm-up) */
  bitrateKbps: number | null;
}

export interface StatusMemory {
  status: CameraHealthStatus;
  consecutiveFailures: number;
  unhealthySince: number | null;
  offlineSince: number | null;
}

export const INITIAL_STATUS: StatusMemory = { status: 'UNKNOWN', consecutiveFailures: 0, unhealthySince: null, offlineSince: null };

const HIGH_LATENCY_MS = 500;
const MIN_BITRATE_KBPS = 50;
const OFFLINE_AFTER_MS = 30_000;

/**
 * The camera status state machine, pure: same memory, sample and time, same answer.
 *
 * - One fully healthy sample (reachable < 500 ms or not checkable, stream ready,
 *   bitrate > 50 kbps or warming up) recovers to ONLINE at once.
 * - Unreachable for 30 s and at least 2 samples: OFFLINE; before that, from the 2nd
 *   failing sample, DEGRADED.
 * - Reachable but slow, not streaming or starved: DEGRADED from the 2nd failing sample.
 * - A single bad sample never changes the status (anti-flap).
 */
export function nextCameraStatus(
  memory: StatusMemory,
  sample: HealthSample,
  now: number
): { memory: StatusMemory; reason?: string; outageDurationMs: number | null } {
  const checkable = sample.networkCheck !== 'NOT_APPLICABLE';
  const reachable = !checkable || sample.networkCheck === 'PASSED';
  const fastEnough = !checkable || (reachable && sample.latencyMs !== null && sample.latencyMs < HIGH_LATENCY_MS);
  const starved = sample.bitrateKbps !== null && sample.bitrateKbps <= MIN_BITRATE_KBPS;

  if (fastEnough && sample.streamReady && !starved) {
    return {
      memory: { status: 'ONLINE', consecutiveFailures: 0, unhealthySince: null, offlineSince: null },
      outageDurationMs: memory.unhealthySince !== null ? now - memory.unhealthySince : null,
    };
  }

  let reason: string;
  if (!reachable) reason = sample.networkError || 'TCP handshake connection failed';
  else if (sample.latencyMs !== null && sample.latencyMs >= HIGH_LATENCY_MS)
    reason = `High network latency (${sample.latencyMs}ms >= ${HIGH_LATENCY_MS}ms)`;
  else if (!sample.streamReady) reason = 'MediaMTX stream path not ready / no video packet feed';
  else reason = `Low stream bitrate (${sample.bitrateKbps} kbps <= ${MIN_BITRATE_KBPS} kbps)`;

  const failures = memory.consecutiveFailures + 1;
  const unhealthySince = memory.unhealthySince ?? now;
  const confirmed = failures >= 2;

  if (!reachable) {
    const offlineSince = memory.offlineSince ?? now;
    const status: CameraHealthStatus =
      confirmed && now - offlineSince >= OFFLINE_AFTER_MS ? 'OFFLINE' : confirmed ? 'DEGRADED' : memory.status;
    return { memory: { status, consecutiveFailures: failures, unhealthySince, offlineSince }, reason, outageDurationMs: null };
  }

  return {
    memory: { status: confirmed ? 'DEGRADED' : memory.status, consecutiveFailures: failures, unhealthySince, offlineSince: null },
    reason,
    outageDurationMs: null,
  };
}
