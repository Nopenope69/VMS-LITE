import { describe, it, expect, beforeEach } from 'vitest';
import { RetentionPolicy, RetentionHoldSource } from '../src/recordings/retention-policy.js';
import { StorageController } from '../src/recordings/storage-controller.js';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { EventBus } from '../src/events/event-bus.js';
import { TestClock } from '../src/recordings/clock.js';
import { RecordingDto } from '../src/recordings/recording.types.js';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const daysAgo = (d: number, minutes = 0) => new Date(NOW.getTime() - d * 86_400_000 + minutes * 60_000);

describe('Retention Policy', () => {
  let repository: InMemoryRecordingRepository;
  let bookmarks: Array<{ cameraId: string; timestamp: Date }>;
  let exports: Array<{ cameraId: string; startTime: Date; endTime: Date }>;
  let policy: RetentionPolicy;
  let n = 0;

  const holds: RetentionHoldSource = {
    bookmarks: async (from, to) => bookmarks.filter((b) => b.timestamp >= from && b.timestamp <= to),
    activeExports: async () => exports,
  };

  async function segment(start: Date, extra: Partial<Parameters<InMemoryRecordingRepository['createRecording']>[0]> = {}) {
    n++;
    return repository.createRecording({
      cameraId: 'cam-1',
      mediaMtxPath: 'cam1',
      filePath: `/var/recordings/cam1/${n}.mp4`,
      fileName: `${n}.mp4`,
      startTime: start,
      endTime: new Date(start.getTime() + 60_000),
      duration: 60,
      sizeBytes: 1000,
      ...extra,
    });
  }
  const ids = (rows: RecordingDto[]) => rows.map((r) => r.fileName);

  beforeEach(() => {
    repository = new InMemoryRecordingRepository();
    bookmarks = [];
    exports = [];
    policy = new RetentionPolicy({ repository, holds, clock: new TestClock(NOW), days: { continuous: 7, event: 15, incident: 60 } });
  });

  it('ages each tier by its own lifetime', async () => {
    const rows = [
      await segment(daysAgo(8)),
      await segment(daysAgo(8), { retentionTier: 'EVENT' }),
      await segment(daysAgo(16), { retentionTier: 'EVENT' }),
      await segment(daysAgo(30), { retentionTier: 'INCIDENT' }),
      await segment(daysAgo(61), { retentionTier: 'INCIDENT' }),
      await segment(daysAgo(8), { status: 'QUARANTINED' }),
    ];
    expect(ids(await policy.deletable(rows, 'age'))).toEqual(['1.mp4', '3.mp4', '5.mp4', '6.mp4']);
  });

  it('never lets a longer-lived tier expire sooner than a shorter one', () => {
    policy.setDays({ continuous: 30 });
    expect(policy.getDays()).toEqual({ continuous: 30, event: 30, incident: 60 });
  });

  it('keeps legal holds, bookmarked windows, running exports and the Motion Buffer whatever the pressure', async () => {
    const legal = await segment(daysAgo(90), { isProtected: true });
    const nearBookmark = await segment(daysAgo(90, 0));
    const farFromBookmark = await segment(daysAgo(90, 10));
    const exporting = await segment(daysAgo(89));
    const buffered = await segment(daysAgo(89, 30), { status: 'BUFFERED' });
    bookmarks.push({ cameraId: 'cam-1', timestamp: daysAgo(90, 2) }); // 1 min after the segment ends, within +/- 2 min
    exports.push({ cameraId: 'cam-1', startTime: daysAgo(89), endTime: daysAgo(89, 1) });

    const deletable = await policy.deletable([legal, nearBookmark, farFromBookmark, exporting, buffered], 'capacity');
    expect(ids(deletable)).toEqual([farFromBookmark.fileName]);
  });

  it('counts held bytes from the whole catalog, not a sample', async () => {
    for (let i = 0; i < 600; i++) await segment(daysAgo(1, i));
    await segment(daysAgo(40), { isProtected: true });
    bookmarks.push({ cameraId: 'cam-1', timestamp: daysAgo(20) });
    await segment(daysAgo(20, -1));

    expect(await policy.protectedBytes()).toBe(2000);
  });
});

describe('Storage Controller with the Retention Policy', () => {
  let repository: InMemoryRecordingRepository;
  let events: EventBus;
  let usedPercent: number;
  let protectedBytes: number;
  const deleted: string[] = [];

  const controller = () => {
    const catalog = new RecordingCatalog({
      repository,
      eventBus: events,
      recordingsDir: '/var/recordings',
      fsUnlinkFn: async (p) => {
        deleted.push(p.split('/').pop()!);
        usedPercent -= 5;
      },
    });
    const retention = new RetentionPolicy({ repository, holds: { bookmarks: async () => [], activeExports: async () => [] } });
    retention.protectedBytes = async () => protectedBytes;
    return new StorageController({
      catalog,
      eventBus: events,
      recordingsDir: '/var/recordings',
      retention,
      batchSize: 10,
      statfsFn: async () => ({ bsize: 1, blocks: 100, bfree: 100 - usedPercent }),
      canaryWriteFn: async () => ({ latencyMs: 5 }),
    });
  };

  beforeEach(() => {
    repository = new InMemoryRecordingRepository();
    events = new EventBus();
    usedPercent = 50;
    protectedBytes = 0;
    deleted.length = 0;
  });

  it('reclaims quarantined segments before the oldest good footage', async () => {
    for (let i = 0; i < 3; i++) {
      await repository.createRecording({
        cameraId: 'cam-1', mediaMtxPath: 'p', filePath: `/var/recordings/p/good${i}.mp4`, fileName: `good${i}.mp4`,
        startTime: daysAgo(10, i), endTime: daysAgo(10, i + 1), duration: 60, sizeBytes: 1,
      });
    }
    await repository.createRecording({
      cameraId: 'cam-1', mediaMtxPath: 'p', filePath: '/var/recordings/p/bad.mp4', fileName: 'bad.mp4',
      startTime: daysAgo(1), endTime: daysAgo(1, 1), duration: 60, sizeBytes: 1, status: 'QUARANTINED',
    });
    usedPercent = 92; // critical

    await controller().checkStorage();

    // Rollover re-checks the disk once per batch, so the whole batch goes; order is what matters
    expect(deleted).toEqual(['bad.mp4', 'good0.mp4', 'good1.mp4', 'good2.mp4']);
  });

  it('alerts once when protected footage crosses its share of the disk, and once when it recovers', async () => {
    const seen: string[] = [];
    events.subscribe('*', (e: any) => { if (e.type.startsWith('storage.protected')) seen.push(e.type); });
    const c = controller();

    protectedBytes = 30; // 30 % of 100
    await c.getStorageMetrics();
    await c.getStorageMetrics();
    protectedBytes = 10;
    await c.getStorageMetrics();

    expect(seen).toEqual(['storage.protected_overflow', 'storage.protected_recovered']);
  });
});
