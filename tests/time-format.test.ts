import { describe, it, expect, afterEach } from 'vitest';
import { applianceTimeZone, formatLocalTimestamp } from '../src/system/time-format.js';

describe('Local timestamps', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('formats in the appliance timezone and names the zone', () => {
    const at = new Date('2026-09-25T08:15:22Z');
    process.env.TZ = 'Asia/Kolkata';
    expect(formatLocalTimestamp(at)).toBe('25 Sept 2026, 13:45:22 IST');
    process.env.TZ = 'UTC';
    expect(formatLocalTimestamp(at)).toBe('25 Sept 2026, 08:15:22 UTC');
    expect(formatLocalTimestamp(at, 'Asia/Singapore')).toBe('25 Sept 2026, 16:15:22 GMT+8');
  });

  it('falls back instead of throwing on an invalid zone', () => {
    process.env.TZ = 'Not/AZone';
    expect(applianceTimeZone()).not.toBe('Not/AZone');
    expect(formatLocalTimestamp(new Date('2026-09-25T08:15:22Z'), 'Bad/Zone')).toBe('25 Sept 2026, 08:15:22 UTC');
  });
});

describe('Wizard timezone', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('applies the timezone chosen in the first-boot wizard and rejects unknown zones', async () => {
    const { SetupService } = await import('../src/system/setup.service.js');
    const { createMockPrisma } = await import('../src/db/mock-prisma.js');
    const service = new SetupService(createMockPrisma() as any);
    process.env.TZ = 'Asia/Kolkata';

    await expect(service.completeSetup({ timezone: 'Mars/Olympus' })).rejects.toThrow(/Unknown timezone/);
    expect(process.env.TZ).toBe('Asia/Kolkata');

    await service.completeSetup({ timezone: 'Asia/Dubai' });
    expect(process.env.TZ).toBe('Asia/Dubai');
    expect(formatLocalTimestamp(new Date('2026-09-25T08:15:22Z'))).toContain('GST');

    // Boot re-applies the stored choice
    process.env.TZ = 'UTC';
    await service.applyStoredTimeZone();
    expect(process.env.TZ).toBe('Asia/Dubai');
  });
});
