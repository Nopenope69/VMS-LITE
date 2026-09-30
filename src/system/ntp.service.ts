/**
 * NTP Time-Sync Status Service
 *
 * Executes `timedatectl show --no-pager` via child_process.execFile and
 * parses the key=value output for NTP synchronization state.
 *
 * Graceful fallback: if `timedatectl` is not found (ENOENT from execFile),
 * returns { available: false, reason: '...' } instead of throwing.
 * This is the expected path on macOS dev machines.
 *
 * Zero new dependencies — uses only node:child_process.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface NtpStatusAvailable {
  available: true;
  ntpEnabled: boolean;
  synchronized: boolean;
  systemTimeUtc: string;
}

export interface NtpStatusUnavailable {
  available: false;
  reason: string;
}

export type NtpStatus = NtpStatusAvailable | NtpStatusUnavailable;

/**
 * Parse the key=value output of `timedatectl show --no-pager`.
 * Lines are in the form `Key=Value`, one per line.
 */
export function parseTimedatectlOutput(stdout: string): {
  ntpEnabled: boolean;
  synchronized: boolean;
  timeUSec: string | null;
} {
  const lines = stdout.split('\n');
  const map = new Map<string, string>();

  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx).trim();
    const value = line.substring(eqIdx + 1).trim();
    map.set(key, value);
  }

  return {
    ntpEnabled: map.get('NTP') === 'yes',
    synchronized: map.get('NTPSynchronized') === 'yes',
    timeUSec: map.get('TimeUSec') ?? null,
  };
}

/**
 * Convert a `TimeUSec` value from timedatectl (e.g. "Tue 2026-09-30 12:00:00 UTC")
 * into an ISO-8601 UTC string. Falls back to current time if parsing fails.
 */
function formatSystemTime(timeUSec: string | null): string {
  if (!timeUSec) return new Date().toISOString();

  // timedatectl TimeUSec format: "Tue 2026-09-30 12:00:00 UTC" or microsecond timestamp
  // Try parsing as a date string first
  const parsed = new Date(timeUSec);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // If it's a microsecond numeric timestamp
  const numeric = parseInt(timeUSec, 10);
  if (!isNaN(numeric)) {
    // timedatectl TimeUSec is in microseconds
    return new Date(numeric / 1000).toISOString();
  }

  return new Date().toISOString();
}

/**
 * Query NTP synchronization status from the host OS.
 *
 * @returns NtpStatus — either { available: true, ... } with sync details
 *          or { available: false, reason: '...' } on non-Linux hosts.
 */
export async function getNtpStatus(): Promise<NtpStatus> {
  try {
    const { stdout } = await execFileAsync('timedatectl', ['show', '--no-pager']);
    const parsed = parseTimedatectlOutput(stdout);

    return {
      available: true,
      ntpEnabled: parsed.ntpEnabled,
      synchronized: parsed.synchronized,
      systemTimeUtc: formatSystemTime(parsed.timeUSec),
    };
  } catch (err: any) {
    // Graceful fallback: timedatectl not found (macOS, containers without systemd)
    if (err?.code === 'ENOENT') {
      return {
        available: false,
        reason: 'timedatectl not found on this system',
      };
    }

    // All other errors are genuine failures — fail loud
    throw new Error(`Failed to query NTP status: ${err.message ?? err}`);
  }
}
