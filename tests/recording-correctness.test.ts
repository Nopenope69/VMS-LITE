import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { SegmentIndexer } from '../src/recordings/segment-indexer.js';
import { SegmentValidator } from '../src/recordings/segment-validator.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { EventBus } from '../src/events/event-bus.js';

import { TestClock } from '../src/recordings/clock.js';

describe('Phase 1: Recording Correctness (Segment Lifecycle & Dual-Path Reconciliation)', () => {
  let root: string;
  let repository: InMemoryRecordingRepository;
  let eventBus: EventBus;
  let validator: SegmentValidator;
  let catalog: RecordingCatalog;
  let clock: TestClock;
  let now: number;

  function createValidFmp4Buffer(size = 2048): Buffer {
    const buf = Buffer.alloc(size);
    buf.writeUInt32BE(24, 0);
    buf.write('ftyp', 4, 'ascii');
    buf.write('isom', 8, 'ascii');
    buf.writeUInt32BE(512, 12);
    buf.write('isom', 16, 'ascii');
    buf.write('mp42', 20, 'ascii');
    return buf;
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-phase1-'));
    await fs.mkdir(path.join(root, 'gate_primary'));
    await fs.mkdir(path.join(root, 'gate_sub'));

    now = Date.parse('2026-10-06T14:05:00.000Z');
    clock = new TestClock(new Date(now));
    repository = new InMemoryRecordingRepository();
    repository.registerCamera({
      id: 'cam-gate',
      name: 'Main Gate',
      mediaMtxPath: 'gate_primary',
      subMediaMtxPath: 'gate_sub',
    });

    eventBus = new EventBus();
    validator = new SegmentValidator({
      recordingsRoot: root,
      quietPeriodMs: 5_000,
      minSizeBytes: 1024,
      now: () => now,
    });

    catalog = new RecordingCatalog({
      repository,
      eventBus,
      recordingsDir: root,
      validator,
      clock,
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('validates and catalogues a primary fMP4 segment into AVAILABLE state', async () => {
    const segmentName = '2026-10-06_14-00-00.mp4';
    const filePath = path.join(root, 'gate_primary', segmentName);
    await fs.writeFile(filePath, createValidFmp4Buffer(4096));

    const mtime = new Date(now - 10_000);
    await fs.utimes(filePath, mtime, mtime);

    let emittedEvent: any = null;
    eventBus.subscribe('recording.segment_created', (evt) => {
      emittedEvent = evt;
    });

    const recording = await catalog.ingestSegment({
      mediaMtxPath: 'gate_primary',
      segmentPath: filePath,
      duration: 60,
    });

    expect(recording).toBeDefined();
    expect(recording.status).toBe('AVAILABLE');
    expect(recording.streamRole).toBe('PRIMARY');
    expect(recording.retentionTier).toBe('CONTINUOUS');
    expect(recording.isProtected).toBe(false);

    expect(emittedEvent).not.toBeNull();
    expect(emittedEvent.metadata.recordingId).toBe(recording.id);
    expect(emittedEvent.metadata.streamRole).toBe('PRIMARY');
    expect(emittedEvent.metadata.status).toBe('AVAILABLE');
  });

  it('recognizes SUB streamRole when ingested from subMediaMtxPath', async () => {
    const segmentName = '2026-10-06_14-00-00.mp4';
    const filePath = path.join(root, 'gate_sub', segmentName);
    await fs.writeFile(filePath, createValidFmp4Buffer(2048));

    const mtime = new Date(now - 10_000);
    await fs.utimes(filePath, mtime, mtime);

    const recording = await catalog.ingestSegment({
      mediaMtxPath: 'gate_sub',
      segmentPath: filePath,
      duration: 60,
    });

    expect(recording.streamRole).toBe('SUB');
    expect(recording.status).toBe('AVAILABLE');
  });

  it('indexer reconciles missed segments and self-heals past quarantined files', async () => {
    // Write a corrupt segment
    const corruptFile = path.join(root, 'gate_primary', '2026-10-06_14-01-00.mp4');
    await fs.writeFile(corruptFile, Buffer.from('GARBAGE_NOT_MP4'));
    const t1 = new Date(now - 200_000);
    await fs.utimes(corruptFile, t1, t1);

    // Write a subsequent valid segment
    const validFile = path.join(root, 'gate_primary', '2026-10-06_14-02-00.mp4');
    await fs.writeFile(validFile, createValidFmp4Buffer(4096));
    const t2 = new Date(now - 100_000);
    await fs.utimes(validFile, t2, t2);

    const indexer = new SegmentIndexer({
      repository,
      recordingsRoot: root,
      quietPeriodMs: 5_000,
      now: () => now,
      ingest: async (payload) => {
        await catalog.ingestSegment(payload);
      },
    });

    // Scan should index the valid file and advance watermark past the corrupt one without throwing
    const count = await indexer.scanCamera('cam-gate', 'gate_primary');
    expect(count).toBe(1);

    const recordings = await repository.queryRecordings({ cameraId: 'cam-gate' });
    expect(recordings.length).toBe(1);
    expect(recordings[0].fileName).toBe('2026-10-06_14-02-00.mp4');
  });
});
