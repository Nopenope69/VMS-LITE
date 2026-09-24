import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../src/events/event-bus.js';
import { TestClock } from '../src/recordings/clock.js';
import { RecordingEngine, RecordingEngineOptions } from '../src/recordings/recording-engine.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';

describe('RecordingEngine Architecture Tests', () => {
  let repository: InMemoryRecordingRepository;
  let mediaMtx: MediaMtxClient;
  let eventBus: EventBus;
  let clock: TestClock;
  let mockUnlink: ReturnType<typeof vi.fn>;
  let mockStat: ReturnType<typeof vi.fn>;
  let mockStatfs: ReturnType<typeof vi.fn>;

  const defaultBsize = 4096n;
  // 100 GB total
  const defaultBlocks = 26214400n;

  beforeEach(() => {
    repository = new InMemoryRecordingRepository();
    mediaMtx = new MediaMtxClient({ mockMode: true });
    eventBus = new EventBus({} as any);
    clock = new TestClock(new Date('2026-09-24T12:00:00.000Z'));

    mockUnlink = vi.fn().mockResolvedValue(undefined);
    mockStat = vi.fn().mockResolvedValue({ size: 1048576 });
    // Default 50% used
    mockStatfs = vi.fn().mockResolvedValue({
      bsize: defaultBsize,
      blocks: defaultBlocks,
      bfree: defaultBlocks / 2n,
    });
  });

  const createEngine = (opts: Partial<RecordingEngineOptions> = {}) => {
    return new RecordingEngine({
      repository,
      mediaMtx,
      eventBus,
      clock,
      recordingsDir: '/var/recordings',
      fsUnlinkFn: mockUnlink,
      fsStatFn: mockStat,
      statfsFn: mockStatfs,
      scheduleIntervalMs: 60_000,
      storageIntervalMs: 60_000,
      ...opts,
    });
  };

  describe('1. Ingestion & Deterministic Timestamp Parsing', () => {
    it('ingests segment with filename timestamp deterministically', async () => {
      repository.registerCamera({
        id: 'cam-1',
        name: 'Front Door',
        mediaMtxPath: 'front_door_1',
      });

      const engine = createEngine();
      const emittedEvents: any[] = [];
      eventBus.subscribe('recording.segment_created', (e) => emittedEvents.push(e));

      const recording = await engine.ingestSegment({
        mediaMtxPath: 'front_door_1',
        segmentPath: '/var/recordings/front_door_1/2026-09-24_16-30-00.mp4',
        duration: 60,
      });

      expect(recording.cameraId).toBe('cam-1');
      expect(recording.startTime).toBe('2026-09-24T16:30:00.000Z');
      expect(recording.endTime).toBe('2026-09-24T16:31:00.000Z');
      expect(recording.duration).toBe(60);
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].metadata.mediaMtxPath).toBe('front_door_1');
    });

    it('accepts MediaMTX payload using "path" alias', async () => {
      repository.registerCamera({
        id: 'cam-2',
        name: 'Backyard',
        mediaMtxPath: 'backyard_stream',
      });

      const engine = createEngine();
      const recording = await engine.ingestSegment({
        path: 'backyard_stream',
        segmentPath: '/var/recordings/backyard_stream/2026-09-24_10-00-00.mp4',
        duration: 30,
      } as any);

      expect(recording.cameraId).toBe('cam-2');
      expect(recording.mediaMtxPath).toBe('backyard_stream');
    });
  });

  describe('2. Schedule Evaluation & Overnight Wrap-Around', () => {
    it('correctly evaluates standard daytime schedule window', async () => {
      const engine = createEngine();
      // Thursday (day 4), 09:00 to 18:00
      await engine.setSchedule('cam-3', 'SCHEDULED', [
        { dayOfWeek: 4, startHour: 9, startMin: 0, endHour: 18, endMin: 0 },
      ]);

      // Thursday 12:00 -> active
      clock.setTime(new Date('2026-09-24T12:00:00.000Z'));
      const schedule = await engine.getSchedule('cam-3');
      expect((engine as any).scheduler.isCameraActiveAt(schedule, clock.now())).toBe(true);

      // Thursday 20:00 -> inactive
      clock.setTime(new Date('2026-09-24T20:00:00.000Z'));
      expect((engine as any).scheduler.isCameraActiveAt(schedule, clock.now())).toBe(false);
    });

    it('handles overnight schedule window spanning midnight into next day', async () => {
      const engine = createEngine();
      // Monday (day 1) 22:00 to 06:00
      await engine.setSchedule('cam-overnight', 'SCHEDULED', [
        { dayOfWeek: 1, startHour: 22, startMin: 0, endHour: 6, endMin: 0 },
      ]);

      const schedule = await engine.getSchedule('cam-overnight');

      // Monday 23:00 -> active
      const monEvening = new Date('2026-09-21T23:00:00.000'); // Day 1
      expect((engine as any).scheduler.isCameraActiveAt(schedule, monEvening)).toBe(true);

      // Tuesday 05:30 -> active (morning continuation from Monday's overnight)
      const tueMorning = new Date('2026-09-22T05:30:00.000'); // Day 2
      expect((engine as any).scheduler.isCameraActiveAt(schedule, tueMorning)).toBe(true);

      // Tuesday 06:01 -> inactive
      const tuePast = new Date('2026-09-22T06:01:00.000'); // Day 2
      expect((engine as any).scheduler.isCameraActiveAt(schedule, tuePast)).toBe(false);
    });

    it('handles week-boundary wrap (Sunday night into Monday morning)', async () => {
      const engine = createEngine();
      // Sunday (day 0) 22:00 to 06:00
      await engine.setSchedule('cam-weekwrap', 'SCHEDULED', [
        { dayOfWeek: 0, startHour: 22, startMin: 0, endHour: 6, endMin: 0 },
      ]);

      const schedule = await engine.getSchedule('cam-weekwrap');

      // Sunday 23:30 -> active
      const sunNight = new Date('2026-09-20T23:30:00.000'); // Day 0
      expect((engine as any).scheduler.isCameraActiveAt(schedule, sunNight)).toBe(true);

      // Monday 04:30 -> active
      const monEarly = new Date('2026-09-21T04:30:00.000'); // Day 1
      expect((engine as any).scheduler.isCameraActiveAt(schedule, monEarly)).toBe(true);

      // Monday 07:00 -> inactive
      const monLate = new Date('2026-09-21T07:00:00.000'); // Day 1
      expect((engine as any).scheduler.isCameraActiveAt(schedule, monLate)).toBe(false);
    });

    it('patches MediaMTX and emits events on recording state transitions', async () => {
      repository.registerCamera({
        id: 'cam-toggle',
        name: 'Lobby',
        mediaMtxPath: 'lobby_cam',
      });

      const patchSpy = vi.spyOn(mediaMtx, 'patchPath');
      const engine = createEngine();

      const events: any[] = [];
      eventBus.subscribe('recording.started', (e) => events.push(e));
      eventBus.subscribe('recording.stopped', (e) => events.push(e));

      // 1. Set continuous -> records
      await engine.setSchedule('cam-toggle', 'CONTINUOUS', []);
      expect(patchSpy).toHaveBeenCalledWith('lobby_cam', { record: true });
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('recording.started');

      // 2. Set manual off -> stops recording
      await engine.setSchedule('cam-toggle', 'MANUAL_OFF', []);
      expect(patchSpy).toHaveBeenCalledWith('lobby_cam', { record: false });
      expect(events.length).toBe(2);
      expect(events[1].type).toBe('recording.stopped');
    });
  });

  describe('3. Lifecycle & Boot Reconciliation', () => {
    it('is idempotent on start() and stop()', async () => {
      const engine = createEngine();

      await engine.start();
      expect(engine.isActive()).toBe(true);
      expect(clock.hasActiveIntervals()).toBe(true);

      // Calling start a second time should not duplicate intervals
      await engine.start();
      expect(engine.isActive()).toBe(true);

      await engine.stop();
      expect(engine.isActive()).toBe(false);
      expect(clock.hasActiveIntervals()).toBe(false);

      // Calling stop a second time is safe
      await engine.stop();
      expect(engine.isActive()).toBe(false);
    });

    it('performs immediate reconciliation on boot', async () => {
      repository.registerCamera({
        id: 'cam-reconcile',
        name: 'Gate',
        mediaMtxPath: 'gate_cam',
      });
      await repository.saveCameraSchedule('cam-reconcile', 'CONTINUOUS', []);

      const patchSpy = vi.spyOn(mediaMtx, 'patchPath');
      const engine = createEngine();

      // At start(), camera is evaluated immediately without waiting for interval
      await engine.start();
      expect(patchSpy).toHaveBeenCalledWith('gate_cam', { record: true });
      expect(engine.isCameraRecording('cam-reconcile')).toBe(true);

      await engine.stop();
    });

    it('protects against overlapping ticks with single-flight guard', async () => {
      const engine = createEngine();

      // Access internal tick
      const tickPromise1 = (engine as any).tickSchedule();
      const tickPromise2 = (engine as any).tickSchedule();

      await Promise.all([tickPromise1, tickPromise2]);
      expect((engine as any).isEvaluatingSchedule).toBe(false);
    });
  });

  describe('4. Storage Thresholds & Deletion Semantics', () => {
    it('returns storage metrics against configured root only', async () => {
      const engine = createEngine();
      const status = await engine.getStorageStatus();

      expect(status.mountPath).toBe('/var/recordings');
      expect(status.usedPercent).toBe(50);
      expect(mockStatfs).toHaveBeenCalledWith('/var/recordings');
    });

    it('emits warning event when usage is between warning and critical thresholds', async () => {
      // 85% used (above 80% warning, below 90% critical)
      mockStatfs.mockResolvedValue({
        bsize: defaultBsize,
        blocks: 100n,
        bfree: 15n,
      });

      const engine = createEngine();
      const warnings: any[] = [];
      eventBus.subscribe('storage.warning', (e) => warnings.push(e));

      const result = await engine.runStorageCleanup();
      expect(result.triggered).toBe(false);
      expect(warnings.length).toBe(1);
      expect(warnings[0].metadata.usedPercent).toBe(85);
    });

    it('triggers FIFO rollover and prunes oldest segments when critical threshold reached', async () => {
      // Setup 3 recordings
      const r1 = await repository.createRecording({
        cameraId: 'c1',
        mediaMtxPath: 'p1',
        filePath: '/var/recordings/p1/seg1.mp4',
        fileName: 'seg1.mp4',
        startTime: new Date('2026-09-24T01:00:00.000Z'),
        endTime: new Date('2026-09-24T01:01:00.000Z'),
        duration: 60,
        sizeBytes: 10_000_000,
      });

      const r2 = await repository.createRecording({
        cameraId: 'c1',
        mediaMtxPath: 'p1',
        filePath: '/var/recordings/p1/seg2.mp4',
        fileName: 'seg2.mp4',
        startTime: new Date('2026-09-24T02:00:00.000Z'),
        endTime: new Date('2026-09-24T02:01:00.000Z'),
        duration: 60,
        sizeBytes: 10_000_000,
      });

      // Simulate 95% usage initially, dropping to 75% after deletion
      let calls = 0;
      mockStatfs.mockImplementation(async () => {
        calls++;
        if (calls <= 2) {
          return { bsize: defaultBsize, blocks: 100n, bfree: 5n }; // 95%
        }
        return { bsize: defaultBsize, blocks: 100n, bfree: 25n }; // 75%
      });

      const engine = createEngine();
      const rollovers: any[] = [];
      eventBus.subscribe('storage.rollover', (e) => rollovers.push(e));

      const result = await engine.runStorageCleanup();

      expect(result.triggered).toBe(true);
      expect(result.deletedSegmentsCount).toBeGreaterThan(0);
      expect(mockUnlink).toHaveBeenCalledWith('/var/recordings/p1/seg1.mp4');
      expect(rollovers.length).toBe(1);

      // r1 was the oldest, so it was deleted from repo
      const checkR1 = await repository.findRecordingById(r1.id);
      expect(checkR1).toBeNull();
    });

    it('handles ENOENT by removing stale catalog row without error', async () => {
      const r = await repository.createRecording({
        cameraId: 'c1',
        mediaMtxPath: 'p1',
        filePath: '/var/recordings/p1/missing.mp4',
        fileName: 'missing.mp4',
        startTime: new Date('2026-09-24T01:00:00.000Z'),
        endTime: new Date('2026-09-24T01:01:00.000Z'),
        duration: 60,
        sizeBytes: 5_000_000,
      });

      // Filesystem says ENOENT
      const enoentError: any = new Error('File not found');
      enoentError.code = 'ENOENT';
      mockUnlink.mockRejectedValue(enoentError);

      const engine = createEngine();
      const res = await (engine as any).catalog.deleteSegmentInternal(r.id, r.filePath);

      expect(res.success).toBe(true);
      expect(res.wasStale).toBe(true);

      // Stale row removed from catalog
      const check = await repository.findRecordingById(r.id);
      expect(check).toBeNull();
    });

    it('does NOT delete database catalog row if filesystem unlink fails with non-ENOENT error', async () => {
      const r = await repository.createRecording({
        cameraId: 'c1',
        mediaMtxPath: 'p1',
        filePath: '/var/recordings/p1/locked.mp4',
        fileName: 'locked.mp4',
        startTime: new Date('2026-09-24T01:00:00.000Z'),
        endTime: new Date('2026-09-24T01:01:00.000Z'),
        duration: 60,
        sizeBytes: 5_000_000,
      });

      // Permission error
      const epermError: any = new Error('Permission denied');
      epermError.code = 'EPERM';
      mockUnlink.mockRejectedValue(epermError);

      const engine = createEngine();
      const res = await (engine as any).catalog.deleteSegmentInternal(r.id, r.filePath);

      expect(res.success).toBe(false);
      // Catalog row is preserved for consistency
      const check = await repository.findRecordingById(r.id);
      expect(check).not.toBeNull();
    });

    it('blocks directory traversal attempts during deletion', async () => {
      const engine = createEngine();
      await expect(
        (engine as any).catalog.deleteSegmentInternal('r-bad', '/etc/passwd')
      ).rejects.toThrow('Directory traversal denied');
    });
  });

  describe('7. Playback & Timeline Spans (PLAY-01, PLAY-03)', () => {
    it('retrieves chronological timeline spans and calculates total duration', async () => {
      repository.registerCamera({
        id: 'cam_yard',
        name: 'Backyard',
        mediaMtxPath: 'cam_yard',
      });

      await repository.createRecording({
        cameraId: 'cam_yard',
        mediaMtxPath: 'cam_yard',
        filePath: '/var/recordings/cam_yard/2026-09-24_10-00-00.mp4',
        fileName: '2026-09-24_10-00-00.mp4',
        startTime: new Date('2026-09-24T10:00:00.000Z'),
        endTime: new Date('2026-09-24T10:02:00.000Z'),
        duration: 120,
        sizeBytes: 10_000_000,
      });

      await repository.createRecording({
        cameraId: 'cam_yard',
        mediaMtxPath: 'cam_yard',
        filePath: '/var/recordings/cam_yard/2026-09-24_10-05-00.mp4',
        fileName: '2026-09-24_10-05-00.mp4',
        startTime: new Date('2026-09-24T10:05:00.000Z'),
        endTime: new Date('2026-09-24T10:07:30.000Z'),
        duration: 150,
        sizeBytes: 12_000_000,
      });

      const engine = createEngine({ playbackBaseUrl: 'http://test-server:9996' });
      const timeline = await engine.getTimelineSpans({
        cameraId: 'cam_yard',
        date: '2026-09-24',
      });

      expect(timeline.cameraId).toBe('cam_yard');
      expect(timeline.date).toBe('2026-09-24');
      expect(timeline.playbackBaseUrl).toBe('http://test-server:9996');
      expect(timeline.totalDurationSeconds).toBe(270);
      expect(timeline.spans).toHaveLength(2);
      expect(timeline.spans[0].durationSeconds).toBe(120);
      expect(timeline.spans[1].durationSeconds).toBe(150);
      // Ensure sorted ascending by start time
      expect(new Date(timeline.spans[0].startTime).getTime()).toBeLessThan(
        new Date(timeline.spans[1].startTime).getTime()
      );
    });

    it('resolves MediaMTX fMP4 stream URL for camera and timestamp', async () => {
      repository.registerCamera({
        id: 'cam_yard',
        name: 'Backyard',
        mediaMtxPath: 'cam_yard',
      });

      const engine = createEngine({ playbackBaseUrl: 'http://test-server:9996' });
      const streamInfo = await engine.getPlaybackStreamUrl('cam_yard', '2026-09-24T10:00:00.000Z', 600);

      expect(streamInfo.cameraId).toBe('cam_yard');
      expect(streamInfo.mediaMtxPath).toBe('cam_yard');
      expect(streamInfo.duration).toBe(600);
      expect(streamInfo.fmp4StreamUrl).toBe(
        'http://test-server:9996/get?path=cam_yard&start=2026-09-24T10%3A00%3A00.000Z&duration=600'
      );
    });

    it('throws error when resolving stream URL for non-existent camera', async () => {
      const engine = createEngine();
      await expect(
        engine.getPlaybackStreamUrl('non-existent', '2026-09-24T10:00:00.000Z')
      ).rejects.toThrow('Camera with id non-existent not found');
    });
  });
});
