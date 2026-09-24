import { describe, it, expect } from 'vitest';
import { getTodayString } from '../client/src/hooks/usePlaybackSession.js';

describe('usePlaybackSession Headless Module (Candidate 5)', () => {
  it('formats getTodayString deterministically in YYYY-MM-DD format', () => {
    const fixedDate = new Date('2026-09-24T15:30:00.000Z');
    const result = getTodayString(fixedDate);
    expect(result).toBe('2026-09-24');
  });

  it('correctly pads month and day with leading zeroes', () => {
    const janDate = new Date('2026-01-05T08:00:00.000Z');
    const result = getTodayString(janDate);
    expect(result).toBe('2026-01-05');
  });
});
