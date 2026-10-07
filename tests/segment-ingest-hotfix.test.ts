import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { SegmentIndexer } from '../src/recordings/segment-indexer.js';
import { SegmentValidator } from '../src/recordings/segment-validator.js';
import { StorageController } from '../src/recordings/storage-controller.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { EventBus } from '../src/events/event-bus.js';
import { TestClock } from '../src/recordings/clock.js';

function validFmp4(size = 4096): Buffer {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write('isom', 8, 'ascii');
  return buf;
}

/** Runs fn as if the app were in production: the Prisma global is still set, NODE_ENV is not 'test'. */
async function inProduction<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = previous;
  }
}

describe('Segment ingest hotfix', () => {
  let root: string;
  let repository: InMemoryRecordingRepository;
  let eventBus: EventBus;
  let catalog: RecordingCatalog;
  const now = Date.parse('2026-10-06T14:05:00.000Z');

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-ingest-hotfix-'));
    await fs.mkdir(path.join(root, 'gate'));
    repository = new InMemoryRecordingRepository();
    repository.registerCamera({ id: 'cam-gate', name: 'Main Gate', mediaMtxPath: 'gate' });
    eventBus = new EventBus();
    catalog = new RecordingCatalog({
      repository,
      eventBus,
      recordingsDir: root,
      clock: new TestClock(new Date(now)),
      validator: new SegmentValidator({ recordingsRoot: root, minSizeBytes: 1024, now: () => now }),
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('never catalogues a missing segment file as AVAILABLE in production', async () => {
    expect((globalThis as any).prismaGlobal).toBeTruthy();
    const missing = path.join(root, 'gate', '2026-10-06_14-00-00.mp4');

    await expect(
      inProduction(() => catalog.ingestSegment({ mediaMtxPath: 'gate', segmentPath: missing, duration: 60 }))
    ).rejects.toThrow(/FILE_NOT_FOUND/);
    expect(await repository.findRecordingByFilePath(missing)).toBeNull();
  });

  it('catalogues a corrupt segment as QUARANTINED, hidden from playback but reclaimable', async () => {
    const corrupt = path.join(root, 'gate', '2026-10-06_14-00-00.mp4');
    await fs.writeFile(corrupt, Buffer.alloc(4096, 0x41));
    const created: any[] = [];
    eventBus.subscribe('recording.segment_created', (evt) => { created.push(evt); });

    const row = await catalog.ingestSegment({ mediaMtxPath: 'gate', segmentPath: corrupt, duration: 60 });

    expect(row.status).toBe('QUARANTINED');
    expect(row.errorReason).toMatch(/INVALID_CONTAINER/);
    expect(new Date(row.startTime).toISOString()).toBe('2026-10-06T14:00:00.000Z');
    expect(created).toHaveLength(0);
    expect(await catalog.queryRecordings({ cameraId: 'cam-gate' })).toHaveLength(0);
    expect(
      await repository.findRecordingsInRange('cam-gate', new Date('2026-10-06T13:00:00Z'), new Date('2026-10-06T15:00:00Z'))
    ).toHaveLength(0);
    expect((await repository.findOldestRecordings(10)).map((r) => r.id)).toContain(row.id);
  });

  it('indexer catalogues corrupt segments so a restart neither re-reads nor leaks them', async () => {
    const dir = path.join(root, 'gate');
    await fs.writeFile(path.join(dir, '2026-10-06_14-00-00.mp4'), Buffer.alloc(4096, 0x41));
    await fs.writeFile(path.join(dir, '2026-10-06_14-01-00.mp4'), validFmp4());
    await fs.writeFile(path.join(dir, '2026-10-06_14-02-00.mp4'), validFmp4());
    for (const [name, end] of [['14-00-00', '14:01:00'], ['14-01-00', '14:02:00'], ['14-02-00', '14:03:00']]) {
      const mtime = new Date(`2026-10-06T${end}.000Z`);
      await fs.utimes(path.join(dir, `2026-10-06_${name}.mp4`), mtime, mtime);
    }

    const indexer = () =>
      new SegmentIndexer({
        repository,
        recordingsRoot: root,
        ingest: (payload) => catalog.ingestSegment(payload),
        now: () => now,
      });

    expect(await indexer().scanCamera('cam-gate', 'gate')).toBe(3);
    const statuses = (await repository.findOldestRecordings(10)).map((r) => r.status);
    expect(statuses).toEqual(['QUARANTINED', 'AVAILABLE', 'AVAILABLE']);

    expect(await indexer().scanCamera('cam-gate', 'gate')).toBe(0);
  });

  it('write canary reports failure when the recordings root is not writable in production', async () => {
    const controller = new StorageController({
      catalog,
      eventBus,
      recordingsDir: path.join(root, 'does-not-exist'),
    } as any);

    const result = await inProduction(() => controller.runWriteCanary());
    expect(result.success).toBe(false);
  });
});
