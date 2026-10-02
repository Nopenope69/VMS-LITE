import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SegmentIndexer } from '../src/recordings/segment-indexer.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { SegmentCompleteWebhookPayload } from '../src/recordings/recording.types.js';

describe('SegmentIndexer (filesystem cataloguing of MediaMTX segments)', () => {
  let root: string;
  let repository: InMemoryRecordingRepository;
  let ingested: SegmentCompleteWebhookPayload[];
  let now: number;

  const writeSegment = async (name: string, mtime: Date, bytes = 1000) => {
    const file = path.join(root, 'gate', name);
    await fs.writeFile(file, Buffer.alloc(bytes));
    await fs.utimes(file, mtime, mtime);
  };

  const makeIndexer = () =>
    new SegmentIndexer({
      repository,
      recordingsRoot: root,
      now: () => now,
      ingest: async (payload) => {
        ingested.push(payload);
      },
    });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-idx-'));
    await fs.mkdir(path.join(root, 'gate'));
    repository = new InMemoryRecordingRepository();
    repository.registerCamera({ id: 'cam-1', name: 'Gate', mediaMtxPath: 'gate' });
    ingested = [];
    now = Date.parse('2026-10-01T10:05:00.000Z');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('indexes finished segments with start from the name and duration from the last write', async () => {
    await writeSegment('2026-10-01_10-00-00-250000.mp4', new Date('2026-10-01T10:01:00.250Z'));
    await writeSegment('2026-10-01_10-01-00-250000.mp4', new Date('2026-10-01T10:02:00.250Z'));
    // Newest file still being written (modified 2s ago): must wait
    now = Date.parse('2026-10-01T10:02:02.000Z');
    await writeSegment('2026-10-01_10-02-00-250000.mp4', new Date('2026-10-01T10:02:00.000Z'));

    expect(await makeIndexer().scanAll()).toBe(2);
    expect(ingested.map((p) => p.startTime)).toEqual([
      '2026-10-01T10:00:00.250Z',
      '2026-10-01T10:01:00.250Z',
    ]);
    expect(ingested[0].duration).toBeCloseTo(60, 1);
    expect(ingested[0].mediaMtxPath).toBe('gate');
  });

  it('is incremental and picks up segments written while the app was down', async () => {
    const indexer = makeIndexer();
    await writeSegment('2026-10-01_10-00-00-000000.mp4', new Date('2026-10-01T10:01:00Z'));
    expect(await indexer.scanAll()).toBe(1);
    expect(await indexer.scanAll()).toBe(0);

    await writeSegment('2026-10-01_10-01-00-000000.mp4', new Date('2026-10-01T10:02:00Z'));
    expect(await indexer.scanAll()).toBe(1);
  });

  it('resumes from the newest catalogued segment after a restart', async () => {
    await repository.createRecording({
      cameraId: 'cam-1',
      mediaMtxPath: 'gate',
      filePath: path.join(root, 'gate', '2026-10-01_10-00-00-000000.mp4'),
      fileName: 'x',
      startTime: new Date('2026-10-01T10:00:00Z'),
      endTime: new Date('2026-10-01T10:01:00Z'),
      duration: 60,
      sizeBytes: 1,
    });
    await writeSegment('2026-10-01_10-00-00-000000.mp4', new Date('2026-10-01T10:01:00Z'));
    await writeSegment('2026-10-01_10-01-00-000000.mp4', new Date('2026-10-01T10:02:00Z'));

    expect(await makeIndexer().scanAll()).toBe(1);
    expect(ingested[0].startTime).toBe('2026-10-01T10:01:00.000Z');
  });

  it('ignores unrelated files and cameras that have not recorded yet', async () => {
    await fs.writeFile(path.join(root, 'gate', 'notes.txt'), 'x');
    repository.registerCamera({ id: 'cam-2', name: 'New', mediaMtxPath: 'never_recorded' });
    expect(await makeIndexer().scanAll()).toBe(0);
  });
});
