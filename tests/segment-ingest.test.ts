import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SegmentIngest } from '../src/recordings/segment-ingest.js';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { EventBus } from '../src/events/event-bus.js';
import { TestClock } from '../src/recordings/clock.js';

const at = (hms: string) => new Date(`2026-10-06T${hms}.000Z`);

function validFmp4(size = 4096): Buffer {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write('isom', 8, 'ascii');
  return buf;
}

describe('Segment Ingest', () => {
  let root: string;
  let repository: InMemoryRecordingRepository;
  let eventBus: EventBus;
  let clock: TestClock;
  let created: any[];
  let ingest: SegmentIngest;

  const newIngest = () => {
    const catalog = new RecordingCatalog({ repository, eventBus, clock, recordingsDir: root });
    return new SegmentIngest({
      repository,
      recordingsRoot: root,
      deleteSegment: (s) => catalog.deleteSegmentInternal(s.id, s.filePath, Number(s.sizeBytes)),
      eventBus,
      clock,
      preBufferSeconds: 10,
      postBufferSeconds: 30,
      lateMotionGraceSeconds: 30,
    });
  };

  /** Writes a segment named after `start`, last written at `end` (60 s later by default). */
  async function writeSegment(
    start: string,
    opts: { camera?: string; content?: Buffer; end?: Date } = {}
  ): Promise<string> {
    const startDate = at(start);
    const filePath = path.join(root, opts.camera ?? 'gate', `2026-10-06_${start.replace(/:/g, '-')}.mp4`);
    await fs.writeFile(filePath, opts.content ?? validFmp4());
    const end = opts.end ?? new Date(startDate.getTime() + 60_000);
    await fs.utimes(filePath, end, end);
    return filePath;
  }

  const statuses = async () =>
    (await repository.findOldestRecordings(100)).map((r) => [r.fileName.slice(11, 19), r.status]);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-segment-ingest-'));
    await fs.mkdir(path.join(root, 'gate'));
    repository = new InMemoryRecordingRepository();
    repository.registerCamera({ id: 'cam-gate', name: 'Main Gate', mediaMtxPath: 'gate' });
    eventBus = new EventBus();
    created = [];
    eventBus.subscribe('recording.segment_created', (evt) => { created.push(evt); });
    clock = new TestClock(at('14:10:00'));
    ingest = newIngest();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('cataloguing', () => {
    it('catalogues finished segments as AVAILABLE with start from the name and end from the last write', async () => {
      await writeSegment('14:00:00');
      await writeSegment('14:01:00', { end: new Date('2026-10-06T14:01:59.500Z') });

      expect(await ingest.scan()).toBe(2);

      const [first, second] = await repository.findOldestRecordings(10);
      expect(first.status).toBe('AVAILABLE');
      expect(first.startTime).toBe('2026-10-06T14:00:00.000Z');
      expect(first.endTime).toBe('2026-10-06T14:01:00.000Z');
      expect(second.duration).toBe(59.5);
      expect(created.map((e) => e.metadata.recordingId)).toEqual([first.id, second.id]);
    });

    it('leaves the newest file alone while MediaMTX may still be writing it', async () => {
      await writeSegment('14:00:00');
      await writeSegment('14:09:00', { end: at('14:09:55') }); // written 5 s ago, no newer sibling

      expect(await ingest.scan()).toBe(1);
      clock.setTime(at('14:10:30'));
      expect(await ingest.scan()).toBe(1);
      expect(await statuses()).toEqual([['14-00-00', 'AVAILABLE'], ['14-09-00', 'AVAILABLE']]);
    });

    it('quarantines corrupt and empty files so FIFO rollover can reclaim them, without publishing them', async () => {
      await writeSegment('14:00:00', { content: Buffer.alloc(4096, 0x41) });
      await writeSegment('14:01:00', { content: Buffer.alloc(0) });
      await writeSegment('14:02:00');

      expect(await ingest.scan()).toBe(3);

      expect(await statuses()).toEqual([
        ['14-00-00', 'QUARANTINED'],
        ['14-01-00', 'QUARANTINED'],
        ['14-02-00', 'AVAILABLE'],
      ]);
      const [corrupt] = await repository.findRecordingsByStatus('QUARANTINED');
      expect(corrupt.errorReason).toMatch(/INVALID_CONTAINER/);
      expect(created).toHaveLength(1);
      expect(await repository.queryRecordings({ cameraId: 'cam-gate' })).toHaveLength(1);
    });

    it('resumes from the catalog after a restart and picks up segments written while down', async () => {
      await writeSegment('14:00:00', { content: Buffer.alloc(4096, 0x41) });
      await writeSegment('14:01:00');
      await ingest.scan();

      await writeSegment('14:02:00');
      await writeSegment('14:03:00');
      const restarted = newIngest();

      expect(await restarted.scan()).toBe(2);
      expect((await repository.findOldestRecordings(10)).map((r) => r.fileName.slice(11, 19))).toEqual([
        '14-00-00', '14-01-00', '14-02-00', '14-03-00',
      ]);
    });

    it('ignores unrelated files and cameras that have not recorded yet', async () => {
      repository.registerCamera({ id: 'cam-yard', name: 'Yard', mediaMtxPath: 'yard' });
      await fs.writeFile(path.join(root, 'gate', 'notes.txt'), 'hello');
      await writeSegment('14:00:00');

      expect(await ingest.scan()).toBe(1);
    });
  });

  describe('Motion Buffer (MOTION_ONLY cameras)', () => {
    beforeEach(async () => {
      await repository.saveCameraSchedule('cam-gate', 'MOTION_ONLY', []);
    });

    it('holds segments with no motion nearby as BUFFERED, unpublished and off the timeline', async () => {
      clock.setTime(at('14:00:40'));
      await writeSegment('14:00:00', { end: at('14:00:10') });
      await writeSegment('14:00:10', { end: at('14:00:20') });

      expect(await ingest.scan()).toBe(2);

      expect(await statuses()).toEqual([['14-00-00', 'BUFFERED'], ['14-00-10', 'BUFFERED']]);
      expect(created).toHaveLength(0);
      expect(await repository.findRecordingsInRange('cam-gate', at('13:00:00'), at('15:00:00'))).toHaveLength(0);
      const status = await ingest.bufferStatus();
      expect(status.totalBufferedSegments).toBe(2);
      expect(status.totalBufferedBytes).toBe(8192);
    });

    it('keeps the segment containing the motion even when it finishes long after the post-buffer', async () => {
      // Motion 10 s into a 60 s segment: the segment is only scanned ~50 s later
      repository.recordMotion('cam-gate', at('14:00:10'));
      clock.setTime(at('14:01:20'));
      await writeSegment('14:00:00');
      await writeSegment('14:01:00', { end: at('14:01:20') });

      await ingest.scan();

      expect(await statuses()).toEqual([['14-00-00', 'AVAILABLE']]);
      expect(created).toHaveLength(1);
    });

    it('keeps already-buffered segments within the pre-buffer when motion arrives', async () => {
      clock.setTime(at('14:00:45'));
      await writeSegment('14:00:00', { end: at('14:00:10') });
      await writeSegment('14:00:10', { end: at('14:00:20') });
      await writeSegment('14:00:20', { end: at('14:00:30') });
      await ingest.scan();

      // Motion 5 s after the last segment ended: only that segment ends within the 10 s pre-buffer
      repository.recordMotion('cam-gate', at('14:00:35'));
      expect(await ingest.onMotion('cam-gate', at('14:00:35'))).toBe(1);

      expect(await statuses()).toEqual([
        ['14-00-00', 'BUFFERED'],
        ['14-00-10', 'BUFFERED'],
        ['14-00-20', 'AVAILABLE'],
      ]);
      expect(created.map((e) => e.metadata.status)).toEqual(['AVAILABLE']);
    });

    it('keeps segments starting within the post-buffer after the motion', async () => {
      repository.recordMotion('cam-gate', at('13:59:45'));
      clock.setTime(at('14:02:20'));
      await writeSegment('14:00:00');
      await writeSegment('14:01:00');

      await ingest.scan();

      expect(await statuses()).toEqual([['14-00-00', 'AVAILABLE'], ['14-01-00', 'BUFFERED']]);
    });

    it('expires buffered segments no late motion can still keep, through the two-phase delete', async () => {
      clock.setTime(at('14:01:20'));
      const old = await writeSegment('14:00:00');
      await writeSegment('14:01:00', { end: at('14:01:10') });
      await ingest.scan();
      expect(await statuses()).toEqual([['14-00-00', 'BUFFERED']]);

      // 14:00 ended at 14:01:00; it may be kept until 14:01:40 (pre-buffer 10 s + grace 30 s)
      clock.setTime(at('14:01:39'));
      await ingest.scan();
      await expect(fs.access(old)).resolves.toBeUndefined();

      clock.setTime(at('14:01:41'));
      await ingest.scan();
      await expect(fs.access(old)).rejects.toThrow();
      expect((await statuses()).map(([name]) => name)).toEqual(['14-01-00']);
    });

    it('reports an active incident for a camera with recent motion', async () => {
      repository.recordMotion('cam-gate', at('14:09:50'));

      const status = await ingest.bufferStatus('cam-gate');

      expect(status.activeIncidentsCount).toBe(1);
      expect(status.cameras[0].postBufferRemainingSeconds).toBe(20);
    });
  });
});
