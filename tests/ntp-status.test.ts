import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mock child_process.execFile before any imports that use it.
 * We mock the entire node:child_process module so getNtpStatus()
 * doesn't actually shell out to timedatectl (unavailable on macOS).
 */
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Also mock node:util promisify to work with our mocked execFile
vi.mock('node:util', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    promisify: (fn: any) => {
      // Return a function that wraps the mock execFile in a promise
      return (...args: any[]) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          });
        });
      };
    },
  };
});

import { execFile } from 'node:child_process';
import { getNtpStatus, parseTimedatectlOutput } from '../src/system/ntp.service.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

describe('NTP Time-Sync Status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseTimedatectlOutput', () => {
    it('parses NTP=yes and NTPSynchronized=yes correctly', () => {
      const output = [
        'Timezone=UTC',
        'LocalRTC=no',
        'NTP=yes',
        'NTPSynchronized=yes',
        'TimeUSec=Tue 2026-09-30 12:00:00 UTC',
      ].join('\n');

      const result = parseTimedatectlOutput(output);
      expect(result.ntpEnabled).toBe(true);
      expect(result.synchronized).toBe(true);
      expect(result.timeUSec).toBe('Tue 2026-09-30 12:00:00 UTC');
    });

    it('parses NTP=no and NTPSynchronized=no correctly', () => {
      const output = 'NTP=no\nNTPSynchronized=no\n';
      const result = parseTimedatectlOutput(output);
      expect(result.ntpEnabled).toBe(false);
      expect(result.synchronized).toBe(false);
    });

    it('handles missing keys gracefully', () => {
      const output = 'SomeOtherKey=value\n';
      const result = parseTimedatectlOutput(output);
      expect(result.ntpEnabled).toBe(false);
      expect(result.synchronized).toBe(false);
      expect(result.timeUSec).toBeNull();
    });

    it('handles empty output', () => {
      const result = parseTimedatectlOutput('');
      expect(result.ntpEnabled).toBe(false);
      expect(result.synchronized).toBe(false);
      expect(result.timeUSec).toBeNull();
    });
  });

  describe('getNtpStatus', () => {
    it('returns NTP sync status from system', async () => {
      const fakeOutput = [
        'Timezone=UTC',
        'NTP=yes',
        'NTPSynchronized=yes',
        'TimeUSec=Tue 2026-09-30 12:00:00 UTC',
      ].join('\n');

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, fakeOutput, '');
        }
      );

      const result = await getNtpStatus();
      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.ntpEnabled).toBe(true);
        expect(result.synchronized).toBe(true);
        expect(result.systemTimeUtc).toBeDefined();
      }

      // Verify execFile was called with correct arguments
      expect(mockExecFile).toHaveBeenCalledWith(
        'timedatectl',
        ['show', '--no-pager'],
        expect.any(Function)
      );
    });

    it('returns unsynchronized status when NTP is disabled', async () => {
      const fakeOutput = 'NTP=no\nNTPSynchronized=no\n';

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, fakeOutput, '');
        }
      );

      const result = await getNtpStatus();
      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.ntpEnabled).toBe(false);
        expect(result.synchronized).toBe(false);
      }
    });

    it('handles timedatectl not available gracefully (ENOENT)', async () => {
      const enoentError = new Error('spawn timedatectl ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error) => void) => {
          cb(enoentError);
        }
      );

      const result = await getNtpStatus();
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.reason).toBe('timedatectl not found on this system');
      }
    });

    it('throws on unexpected errors (fail-loud)', async () => {
      const otherError = new Error('permission denied');

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error) => void) => {
          cb(otherError);
        }
      );

      await expect(getNtpStatus()).rejects.toThrow('Failed to query NTP status');
    });
  });
});
