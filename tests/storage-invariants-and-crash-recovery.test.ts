import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { SegmentIngest } from '../src/recordings/segment-ingest.js';
import { TestClock } from '../src/recordings/clock.js';
import { StorageController } from '../src/recordings/storage-controller.js';
import { StorageInvariantsService } from '../src/recordings/storage-invariants.service.js';
import { EventBus } from '../src/events/event-bus.js';
import { validateMp4ContainerHeader } from '../src/recordings/segment-validator.js';
import { diagnosticsLogger } from '../src/diagnostics/diagnostics-logger.js';

describe('Storage Invariants & Crash Recovery Matrix (Moonfire NVR Principles)', () => {
  let repository: InMemoryRecordingRepository;
  let catalog: RecordingCatalog;
  let eventBus: EventBus;
  let invariantsService: StorageInvariantsService;

  const RECORDINGS_DIR = '/mock/recordings';

  beforeEach(() => {
    repository = new InMemoryRecordingRepository();
    eventBus = new EventBus();
    catalog = new RecordingCatalog({
      repository,
      recordingsDir: RECORDINGS_DIR,
      eventBus,
    });
    invariantsService = new StorageInvariantsService({
      catalog,
      repository,
      eventBus,
      recordingsDir: RECORDINGS_DIR,
    });

    repository.registerCamera({
      id: 'cam-gate-01',
      name: 'Gate 01',
      mediaMtxPath: 'gate_01',
    });
  });

  // Segments that Segment Ingest finds on a real recordings volume
  let diskRoot: string;
  const clock = new TestClock(new Date('2026-10-06T18:00:00.000Z'));

  beforeEach(async () => {
    diskRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-crash-matrix-'));
    await fs.mkdir(path.join(diskRoot, 'gate_01'));
  });

  afterEach(async () => {
    await fs.rm(diskRoot, { recursive: true, force: true });
  });

  async function writeSegment(fileName: string, durationSeconds = 60): Promise<string> {
    const header = Buffer.alloc(4096);
    header.writeUInt32BE(24, 0);
    header.write('ftyp', 4, 'ascii');
    const filePath = path.join(diskRoot, 'gate_01', fileName);
    await fs.writeFile(filePath, header);
    const start = Date.parse(fileName.slice(0, 10) + 'T' + fileName.slice(11, 19).replace(/-/g, ':') + 'Z');
    const end = new Date(start + durationSeconds * 1000);
    await fs.utimes(filePath, end, end);
    return filePath;
  }

  function ingestFor(repo: InMemoryRecordingRepository): SegmentIngest {
    const diskCatalog = new RecordingCatalog({ repository: repo, recordingsDir: diskRoot, eventBus });
    return new SegmentIngest({
      repository: repo,
      recordingsRoot: diskRoot,
      deleteSegment: (r) => diskCatalog.deleteSegmentInternal(r.id, r.filePath, Number(r.sizeBytes)),
      eventBus,
      clock,
    });
  }

  // 1. segment written
  it('Matrix 1: validates segment written by MediaMTX for valid fMP4 container atoms', () => {
    const validHeader = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftypisom', 'ascii'),
      Buffer.alloc(24, 0),
      Buffer.from([0x00, 0x00, 0x00, 0x08]),
      Buffer.from('moov', 'ascii'),
      Buffer.alloc(2000, 0x11),
    ]);

    const boxRes = validateMp4ContainerHeader(validHeader);
    expect(boxRes.valid).toBe(true);
    expect(boxRes.primaryBox).toBe('ftyp');
  });

  // 2. segment discovered
  it('Matrix 2: discovers segment on disk and extracts accurate timestamp and path', async () => {
    await writeSegment('2026-10-06_14-30-00-000000.mp4');

    expect(await ingestFor(repository).scan()).toBe(1);

    const [recording] = await repository.findOldestRecordings(10);
    expect(recording.cameraId).toBe('cam-gate-01');
    expect(recording.status).toBe('AVAILABLE');
    expect(recording.duration).toBe(60);
    expect(new Date(recording.startTime).toISOString()).toBe('2026-10-06T14:30:00.000Z');
  });

  // 3. segment catalogued
  it('Matrix 3: catalogues segment with AVAILABLE status and emits contract event', async () => {
    let emittedEvent: any = null;
    eventBus.subscribe('recording.segment_created', (evt) => {
      emittedEvent = evt;
    });
    await writeSegment('2026-10-06_14-31-00-000000.mp4');

    await ingestFor(repository).scan();

    expect(emittedEvent).not.toBeNull();
    expect(emittedEvent.metadata.streamRole).toBe('PRIMARY');
    expect(emittedEvent.metadata.status).toBe('AVAILABLE');
    expect(emittedEvent.metadata.recordingId).toBeDefined();
  });

  // 4. DB write fails
  it('Matrix 4: handles DB write failure without touching media, and catalogues it once the DB recovers', async () => {
    const filePath = await writeSegment('2026-10-06_14-35-00-000000.mp4');
    const realCreate = repository.createRecording.bind(repository);
    repository.createRecording = async () => {
      throw new Error('PostgreSQL connection timeout: pool exhausted');
    };
    const ingest = ingestFor(repository);

    expect(await ingest.scan()).toBe(0);
    expect(await repository.findOldestRecordings(10)).toHaveLength(0);
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    repository.createRecording = realCreate;
    expect(await ingest.scan()).toBe(1);
  });

  // 5. file disappears
  it('Matrix 5: detects missing physical files, marks them MISSING, and removes from timeline (Invariant 2)', async () => {
    const filePath = path.join(RECORDINGS_DIR, 'gate_01', 'vanished.mp4');
    const rec = await repository.createRecording({
      cameraId: 'cam-gate-01',
      mediaMtxPath: 'gate_01',
      filePath,
      fileName: 'vanished.mp4',
      startTime: new Date('2026-10-06T10:00:00Z'),
      endTime: new Date('2026-10-06T10:01:00Z'),
      duration: 60,
      sizeBytes: 1000,
      status: 'AVAILABLE',
    });

    // Invariants auditor detects file is missing
    const auditService = new StorageInvariantsService({
      catalog,
      repository,
      eventBus,
      recordingsDir: RECORDINGS_DIR,
      fsAccessFn: async () => {
        throw new Error('ENOENT: no such file or directory');
      },
    });

    const report = await auditService.auditAndReconcile();
    expect(report.missingCount).toBe(1);

    const updated = await repository.findRecordingById(rec.id);
    expect(updated?.status).toBe('MISSING');

    // Timeline query strictly excludes MISSING segments
    const timeline = await catalog.getTimelineSpans(
      { cameraId: 'cam-gate-01', date: '2026-10-06' },
      '/api/media/playback'
    );
    expect(timeline.spans.length).toBe(0);
  });

  // 6. file deletion fails
  it('Matrix 6: transitions segment to GARBAGE when file unlink fails (Invariant 4: 2-phase deletion)', async () => {
    const filePath = path.join(RECORDINGS_DIR, 'gate_01', 'locked.mp4');
    const rec = await repository.createRecording({
      cameraId: 'cam-gate-01',
      mediaMtxPath: 'gate_01',
      filePath,
      fileName: 'locked.mp4',
      startTime: new Date('2026-10-06T10:00:00Z'),
      endTime: new Date('2026-10-06T10:01:00Z'),
      duration: 60,
      sizeBytes: 2000,
      status: 'AVAILABLE',
    });

    const errorCatalog = new RecordingCatalog({
      repository,
      recordingsDir: RECORDINGS_DIR,
      eventBus,
      fsUnlinkFn: async () => {
        const err: any = new Error('EPERM: operation not permitted, unlink');
        err.code = 'EPERM';
        throw err;
      },
    });

    const res = await errorCatalog.deleteSegmentInternal(rec.id, filePath, 2000);
    expect(res.success).toBe(false);

    // Segment is in GARBAGE state with recorded error
    const updated = await repository.findRecordingById(rec.id);
    expect(updated?.status).toBe('GARBAGE');
    expect(updated?.errorReason).toContain('EPERM');

    // Segment is immediately hidden from timeline playback
    const timeline = await errorCatalog.getTimelineSpans(
      { cameraId: 'cam-gate-01', date: '2026-10-06' },
      '/api/media/playback'
    );
    expect(timeline.spans.length).toBe(0);
  });

  // 7. power loss / process crash during delete
  it('Matrix 7: recovers crash-interrupted DELETE_PENDING segments on next sweep', async () => {
    const filePath = path.join(RECORDINGS_DIR, 'gate_01', 'crashed_mid_delete.mp4');
    const rec = await repository.createRecording({
      cameraId: 'cam-gate-01',
      mediaMtxPath: 'gate_01',
      filePath,
      fileName: 'crashed_mid_delete.mp4',
      startTime: new Date('2026-10-06T10:00:00Z'),
      endTime: new Date('2026-10-06T10:01:00Z'),
      duration: 60,
      sizeBytes: 1500,
      status: 'DELETE_PENDING', // Crash occurred right after marking DELETE_PENDING
    });

    let unlinkedPath: string | null = null;
    const recoveringCatalog = new RecordingCatalog({
      repository,
      recordingsDir: RECORDINGS_DIR,
      eventBus,
      fsAccessFn: async () => {}, // File still on disk
      fsUnlinkFn: async (p) => {
        unlinkedPath = p;
      },
    });

    const recovery = await recoveringCatalog.reconcilePendingDeletions();
    expect(recovery.recoveredCount).toBe(1);
    expect(unlinkedPath).toBe(path.resolve(filePath));

    // DB row is now purged
    const after = await repository.findRecordingById(rec.id);
    expect(after).toBeNull();
  });

  // 8. process crash during segment capture (partial / truncated file)
  it('Matrix 8: rejects corrupted / partial segment from crash before capture finished', () => {
    const truncated = Buffer.from([0x00, 0x00, 0x00]);
    const result = validateMp4ContainerHeader(truncated);
    expect(result.valid).toBe(false);
  });

  // 9. disk becomes read-only
  it('Matrix 9: detects read-only disk via canary probe and halts FIFO rollover and purge (Invariant 7)', async () => {
    let statfsCalls = 0;
    const controller = new StorageController({
      catalog,
      eventBus,
      recordingsDir: RECORDINGS_DIR,
      statfsFn: async () => {
        statfsCalls++;
        return { bsize: 4096, blocks: 1000, bfree: 50 }; // 95% full
      },
    });

    // Mock write canary to fail with EROFS (Read-only file system)
    controller.runWriteCanary = async () => ({
      success: false,
      latencyMs: null,
      error: 'EROFS: read-only file system',
    });

    let healthEvent: any = null;
    eventBus.subscribe('storage.health_changed', (evt) => {
      healthEvent = evt;
    });

    const res = await controller.checkStorage();
    expect(res.status).toBe('write_failed');
    expect(res.triggered).toBe(false);
    expect(res.deletedSegmentsCount).toBe(0); // Deletions strictly halted
    expect(healthEvent?.metadata?.status).toBe('WRITE_FAILED');
  });

  // 10. disk disappears / mount missing
  it('Matrix 10: detects missing mount and avoids deleting catalog records', async () => {
    const controller = new StorageController({
      catalog,
      eventBus,
      recordingsDir: '/nonexistent/mount',
      statfsFn: async () => {
        throw new Error('ENOENT: mount point missing');
      },
    });

    controller.runWriteCanary = async () => ({
      success: true,
      latencyMs: 10,
    });

    const res = await controller.checkStorage();
    expect(res.status).toBe('mount_missing');
    expect(res.triggered).toBe(false);
    expect(res.deletedSegmentsCount).toBe(0);
  });

  // 11. database restored without recordings
  it('Matrix 11: reconciles safely when database is restored without matching recordings', async () => {
    for (let i = 0; i < 5; i++) {
      await repository.createRecording({
        cameraId: 'cam-gate-01',
        mediaMtxPath: 'gate_01',
        filePath: path.join(RECORDINGS_DIR, 'gate_01', `restored_${i}.mp4`),
        fileName: `restored_${i}.mp4`,
        startTime: new Date(`2026-10-06T12:0${i}:00Z`),
        endTime: new Date(`2026-10-06T12:0${i + 1}:00Z`),
        duration: 60,
        sizeBytes: 1000,
        status: 'AVAILABLE',
      });
    }

    const auditService = new StorageInvariantsService({
      catalog,
      repository,
      eventBus,
      recordingsDir: RECORDINGS_DIR,
      fsAccessFn: async () => {
        throw new Error('ENOENT: no files present on restored appliance');
      },
    });

    const report = await auditService.auditAndReconcile();
    expect(report.totalCatalogued).toBe(5);
    expect(report.missingCount).toBe(5);
    expect(report.availableCount).toBe(0);

    expect(await repository.queryRecordings({})).toHaveLength(0);
    expect(await repository.findRecordingsByStatus('MISSING')).toHaveLength(5);
  });

  // 12. recordings restored without database
  it('Matrix 12: reconstructs entire catalog from on-disk media when database is empty (Invariant 6)', async () => {
    await writeSegment('2026-10-06_08-00-00-000000.mp4');
    await writeSegment('2026-10-06_08-01-00-000000.mp4');
    await writeSegment('2026-10-06_08-02-00-000000.mp4');

    expect(await ingestFor(repository).scan()).toBe(3);

    const catalogued = await repository.findOldestRecordings(10);
    expect(catalogued.map((r) => r.status)).toEqual(['AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
    expect(catalogued[0].mediaMtxPath).toBe('gate_01');
  });

  // 13. the same segment seen twice
  it('Matrix 13: scanning the same files again never duplicates catalog rows (Invariant 1)', async () => {
    await writeSegment('2026-10-06_15-00-00-000000.mp4');

    await ingestFor(repository).scan();
    await ingestFor(repository).scan();

    expect(await repository.findOldestRecordings(10)).toHaveLength(1);
  });

  // 14. segments written while the control plane was down
  it('Matrix 14: catalogues segments written while the control plane was down', async () => {
    await writeSegment('2026-10-06_16-00-00-000000.mp4');
    await ingestFor(repository).scan();

    await writeSegment('2026-10-06_16-01-00-000000.mp4');
    await writeSegment('2026-10-06_16-02-00-000000.mp4');

    expect(await ingestFor(repository).scan()).toBe(2);
    expect((await repository.findOldestRecordings(10)).map((r) => r.fileName)).toEqual([
      '2026-10-06_16-00-00-000000.mp4',
      '2026-10-06_16-01-00-000000.mp4',
      '2026-10-06_16-02-00-000000.mp4',
    ]);
  });

  // Structured Logging Verification
  it('Matrix 15: logs structured diagnostics with operational context and detects slow operations', () => {
    diagnosticsLogger.clearHistory();

    // Fast operation
    diagnosticsLogger.logOperation({
      camera: 'gate-01',
      stream: 'primary',
      operation: 'fsync',
      durationMs: 45,
      path: '/mock/file.mp4',
    });

    // Slow operation exceeding 1000ms threshold
    diagnosticsLogger.logOperation({
      camera: 'gate-01',
      stream: 'primary',
      operation: 'fsync',
      durationMs: 1450,
      path: '/mock/file.mp4',
    });

    const logs = diagnosticsLogger.getRecentLogs(10);
    expect(logs.length).toBe(2);
    expect(logs[0].level).toBe('info');
    expect(logs[1].level).toBe('warn');
    expect(logs[1].reason).toBe('slow_io_threshold_exceeded');
  });
});
