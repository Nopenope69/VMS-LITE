import { describe, it, expect } from 'vitest';
import { parsePlaybackLink } from '../client/src/utils/playback-link.js';

describe('Playback deep link (alert e-mails)', () => {
  it('reads the camera and moment from /playback links', () => {
    expect(parsePlaybackLink('/playback', '?cameraId=cam-1&t=2026-10-02T08%3A00%3A00.000Z')).toEqual({
      cameraId: 'cam-1',
      timestampMs: Date.parse('2026-10-02T08:00:00.000Z'),
    });
    expect(parsePlaybackLink('/playback/', '?cameraId=cam-1')).toEqual({ cameraId: 'cam-1', timestampMs: null });
    expect(parsePlaybackLink('/playback', '?t=not-a-date')).toEqual({ cameraId: null, timestampMs: null });
  });

  it('ignores other addresses', () => {
    expect(parsePlaybackLink('/', '?cameraId=cam-1')).toBeNull();
    expect(parsePlaybackLink('/live', '')).toBeNull();
  });
});
