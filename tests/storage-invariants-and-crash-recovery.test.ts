import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { SegmentIndexer } from '../src/recordings/segment-indexer.js';
import { StorageController } from '../src/recordings/storage-controller.js';
import { StorageInvariantsService } from '../src/recordings/storage-invariants.service.js';
import { EventBus } from '../src/events/event-bus.js';
import { SegmentValidator, validateMp4ContainerHeader } from '../src/recordings/segment-validator.js';
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
      validator: new SegmentValidator({
        recordingsRoot: RECORDINGS_DIR,
        quietPeriodMs: 0,
      }),
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
      subMediaMtxPath: 'gate_01_sub',
    });
  });

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
    const fileName = '2026-10-06_14-30-00-000000.mp4';
    const filePath = path.join(RECORDINGS_DIR, 'gate_01', fileName);

    const recording = await catalog.ingestSegment({
      mediaMtxPath: 'gate_01',
      segmentPath: filePath,
      duration: 60,
      size: 5000000,
    });

    expect(recording.id).toBeDefined();
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

    const fileName = '2026-10-06_14-31-00-000000.mp4';
    const filePath = path.join(RECORDINGS_DIR, 'gate_01', fileName);

    await catalog.ingestSegment({
      mediaMtxPath: 'gate_01',
      segmentPath: filePath,
      duration: 60,
      size: 4500000,
    });

    expect(emittedEvent).not.toBeNull();
    expect(emittedEvent.metadata.streamRole).toBe('PRIMARY');
    expect(emittedEvent.metadata.status).toBe('AVAILABLE');
    expect(emittedEvent.metadata.recordingId).toBeDefined();
  });

  // 4. DB write fails
  it('Matrix 4: handles DB write failure gracefully without corrupting media or crashing', async () => {
    const errorRepo = new InMemoryRecordingRepository();
    errorRepo.registerCamera({
      id: 'cam-gate-01',
      name: 'Gate 01',
      mediaMtxPath: 'gate_01',
    });
    // Simulate DB failure
    errorRepo.createRecording = async () => {
      throw new Error('PostgreSQL connection timeout: pool exhausted');
    };

    const failCatalog = new RecordingCatalog({
      repository: errorRepo,
      recordingsDir: RECORDINGS_DIR,
      eventBus,
      validator: new SegmentValidator({
        recordingsRoot: RECORDINGS_DIR,
        quietPeriodMs: 0,
      }),
    });

    await expect(
      failCatalog.ingestSegment({
        mediaMtxPath: 'gate_01',
        segmentPath: path.join(RECORDINGS_DIR, 'gate_01', '2026-10-06_14-35-00-000000.mp4'),
        duration: 60,
      })
    ).rejects.toThrow('PostgreSQL connection timeout');

    // System state remains clean, no partial records
    const all = await errorRepo.queryRecordings({});
    expect(all.length).toBe(0);
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

    const all = await repository.queryRecordings({});
    expect(all.every((r) => r.status === 'MISSING')).toBe(true);
  });

  // 12. recordings restored without database
  it('Matrix 12: reconstructs entire catalog from on-disk media when database is empty (Invariant 6)', async () => {
    const emptyRepo = new InMemoryRecordingRepository();
    emptyRepo.registerCamera({
      id: 'cam-gate-01',
      name: 'Gate 01',
      mediaMtxPath: 'gate_01',
    });

    const filesOnDisk = [
      '2026-10-06_08-00-00-000000.mp4',
      '2026-10-06_08-01-00-000000.mp4',
      '2026-10-06_08-02-00-000000.mp4',
    ];

    const catalogForIndexer = new RecordingCatalog({
      repository: emptyRepo,
      recordingsDir: RECORDINGS_DIR,
      eventBus,
      validator: new SegmentValidator({
        recordingsRoot: RECORDINGS_DIR,
        quietPeriodMs: 0,
      }),
    });

    const indexer = new SegmentIndexer({
      recordingsRoot: RECORDINGS_DIR,
      repository: emptyRepo,
      quietPeriodMs: 0,
      ingest: (p) => catalogForIndexer.ingestSegment(p),
      fsReaddirFn: async (dir) => {
        if (dir.endsWith('gate_01')) return filesOnDisk;
        return ['gate_01'];
      },
      fsStatFn: async () => ({
        size: 2048,
        mtimeMs: Date.now() - 10000,
      }),
    });

    const indexedCount = await indexer.scanAll();
    expect(indexedCount).toBe(3);

    const catalogued = await emptyRepo.queryRecordings({});
    expect(catalogued.length).toBe(3);
    expect(catalogued.every((r) => r.status === 'AVAILABLE')).toBe(true);
    expect(catalogued[0].mediaMtxPath).toBe('gate_01');
  });

  // 13. duplicate segment notification
  it('Matrix 13: ensures duplicate segment notifications are completely idempotent (Invariant 1)', async () => {
    const filePath = path.join(RECORDINGS_DIR, 'gate_01', '2026-10-06_15-00-00-000000.mp4');

    const first = await catalog.ingestSegment({
      mediaMtxPath: 'gate_01',
      segmentPath: filePath,
      duration: 60,
      size: 3000000,
    });

    // Replay same notification
    const second = await catalog.ingestSegment({
      mediaMtxPath: 'gate_01',
      segmentPath: filePath,
      duration: 60,
      size: 3000000,
    });

    expect(second.id).toBe(first.id);

    const all = await repository.queryRecordings({});
    expect(all.length).toBe(1); // Exactly one catalog row (Invariant 1)
  });

  // 14. segment notification missed
  it('Matrix 14: discovers and catalogues missed segments via background reconciliation sweep', async () => {
    const unnotifiedFile = '2026-10-06_16-00-00-000000.mp4';
    const indexer = new SegmentIndexer({
      recordingsRoot: RECORDINGS_DIR,
      repository,
      quietPeriodMs: 0,
      ingest: (p) => catalog.ingestSegment(p),
      fsReaddirFn: async (dir) => {
        if (dir.endsWith('gate_01')) return [unnotifiedFile];
        return ['gate_01'];
      },
      fsStatFn: async () => ({
        size: 3000,
        mtimeMs: Date.now() - 5000,
      }),
    });

    const before = await repository.queryRecordings({});
    expect(before.length).toBe(0);

    const count = await indexer.scanAll();
    expect(count).toBe(1);

    const after = await repository.queryRecordings({});
    expect(after.length).toBe(1);
    expect(after[0].fileName).toBe(unnotifiedFile);
    expect(after[0].status).toBe('AVAILABLE');
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
