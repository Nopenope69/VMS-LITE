import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/events/event-bus.js';
import { MotionRingBufferEngine } from '../src/recordings/motion-ring-buffer.js';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { IClock } from '../src/recordings/clock.js';

describe('Motion Recording with Rolling Ring Buffer (Phase 17 - Plan 01 - MVP-09)', () => {
  let eventBus: EventBus;
  let repository: InMemoryRecordingRepository;
  let catalog: RecordingCatalog;
  let mockUnlink: any;
  let mockStat: any;
  let mockClock: IClock;
  let currentTimeMs: number;
  let ringBuffer: MotionRingBufferEngine;

  beforeEach(() => {
    eventBus = new EventBus();
    repository = new InMemoryRecordingRepository();
    currentTimeMs = 1727400000000; // Base timestamp

    mockClock = {
      now: () => new Date(currentTimeMs),
      setTimeout: (fn: any, ms: any) => setTimeout(fn, ms),
      clearTimeout: (id: any) => clearTimeout(id),
      setInterval: (fn: any, ms: any) => setInterval(fn, ms),
      clearInterval: (id: any) => clearInterval(id),
    };

    mockUnlink = vi.fn().mockResolvedValue(undefined);
    mockStat = vi.fn().mockResolvedValue({ size: 2048000 });

    catalog = new RecordingCatalog({
      repository,
      eventBus,
      clock: mockClock,
      recordingsDir: '/var/recordings',
      fsStatFn: mockStat,
      fsUnlinkFn: mockUnlink,
    });

    repository.registerCamera({
      id: 'cam-gate',
      name: 'Gate Camera',
      mediaMtxPath: 'cam-gate',
    });

    ringBuffer = new MotionRingBufferEngine({
      catalog,
      eventBus,
      clock: mockClock,
      preBufferSeconds: 10,
      postBufferSeconds: 30,
      bufferTtlSeconds: 30,
      fsUnlinkFn: mockUnlink,
      fsStatFn: mockStat,
    });
  });

  it('1. Enqueues segments into rolling buffer when quiet without creating DB recordings', async () => {
    const payload = {
      mediaMtxPath: 'cam-gate',
      segmentPath: '/var/recordings/cam-gate/2026-09-27_00-00-00.mp4',
      duration: 2.0,
      size: 2048000,
      startTime: new Date(currentTimeMs).toISOString(),
    };

    const res = await ringBuffer.handleSegment(payload, 'cam-gate');
    expect(res.promoted).toBe(false);
    expect(res.recording).toBeUndefined();

    // Verify repository has 0 recordings inserted
    const stored = await repository.queryRecordings({});
    expect(stored.length).toBe(0);

    // Verify buffer diagnostics reflect 1 segment in queue
    const status = ringBuffer.getBufferStatus('cam-gate');
    expect(status.totalBufferedSegments).toBe(1);
    expect(status.cameras[0].bufferedSegmentsCount).toBe(1);
    expect(status.cameras[0].incidentActive).toBe(false);
  });

  it('2. Discards unpromoted segments older than buffer TTL (30s) via fsUnlink', async () => {
    // Ingest segment 1 at T=0
    await ringBuffer.handleSegment(
      {
        mediaMtxPath: 'cam-gate',
        segmentPath: '/var/recordings/cam-gate/seg1.mp4',
        duration: 2.0,
        startTime: new Date(currentTimeMs).toISOString(),
      },
      'cam-gate'
    );

    // Advance clock by 35 seconds (exceeding 30s bufferTtlSeconds)
    currentTimeMs += 35 * 1000;

    // Ingest segment 2 at T=35
    await ringBuffer.handleSegment(
      {
        mediaMtxPath: 'cam-gate',
        segmentPath: '/var/recordings/cam-gate/seg2.mp4',
        duration: 2.0,
        startTime: new Date(currentTimeMs).toISOString(),
      },
      'cam-gate'
    );

    // seg1 should have been unlinked from disk
    expect(mockUnlink).toHaveBeenCalledWith('/var/recordings/cam-gate/seg1.mp4');

    // Only 1 segment remaining in queue
    const status = ringBuffer.getBufferStatus('cam-gate');
    expect(status.cameras[0].bufferedSegmentsCount).toBe(1);
  });

  it('3. Promotes preceding 10s pre-buffer segments upon motion.detected event', async () => {
    // Populate 5 2-second segments across 10 seconds:
    // T = 0, 2, 4, 6, 8
    for (let i = 0; i < 5; i++) {
      const segTime = new Date(currentTimeMs + i * 2000);
      await ringBuffer.handleSegment(
        {
          mediaMtxPath: 'cam-gate',
          segmentPath: `/var/recordings/cam-gate/pre_${i}.mp4`,
          duration: 2.0,
          startTime: segTime.toISOString(),
        },
        'cam-gate'
      );
    }

    // Advance clock to T = 10s
    currentTimeMs += 10 * 1000;

    // Fire motion.detected event for cam-gate
    const emittedEvents: any[] = [];
    eventBus.subscribe('recording.incident_started', (e) => emittedEvents.push(e));

    await eventBus.emitEvent({
      type: 'motion.detected',
      source: 'onvif.service',
      cameraId: 'cam-gate',
      timestamp: new Date(currentTimeMs).toISOString(),
    });

    // Wait for async event handler to process
    await new Promise((r) => setTimeout(r, 20));

    // Verify incident_started event was emitted
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].cameraId).toBe('cam-gate');

    // Verify all 5 pre-buffered segments were promoted and inserted into repository!
    const stored = await repository.queryRecordings({ cameraId: 'cam-gate' });
    expect(stored.length).toBe(5);

    // Status reflects active incident
    const status = ringBuffer.getBufferStatus('cam-gate');
    expect(status.cameras[0].incidentActive).toBe(true);
    expect(status.cameras[0].postBufferRemainingSeconds).toBe(30);
  });

  it('4. Directly promotes incoming segments while motion/cooldown incident is active', async () => {
    // Activate incident at T=0
    await ringBuffer.triggerMotion('cam-gate', new Date(currentTimeMs));

    // New segment arrives during active motion
    const res = await ringBuffer.handleSegment(
      {
        mediaMtxPath: 'cam-gate',
        segmentPath: '/var/recordings/cam-gate/during_motion.mp4',
        duration: 2.0,
        startTime: new Date(currentTimeMs + 2000).toISOString(),
      },
      'cam-gate'
    );

    expect(res.promoted).toBe(true);
    expect(res.recording).toBeDefined();
    expect(res.recording?.filePath).toBe('/var/recordings/cam-gate/during_motion.mp4');

    const stored = await repository.queryRecordings({ cameraId: 'cam-gate' });
    expect(stored.some((r) => r.filePath.includes('during_motion.mp4'))).toBe(true);
  });

  it('5. Closes incident after 30s cooldown and returns subsequent segments to ring buffer', async () => {
    const endedEvents: any[] = [];
    eventBus.subscribe('recording.incident_ended', (e) => endedEvents.push(e));

    // Activate motion at T=0 (cooldown until T=30)
    await ringBuffer.triggerMotion('cam-gate', new Date(currentTimeMs));

    // Advance clock past cooldown: T = 35s
    currentTimeMs += 35 * 1000;

    // Ingest segment at T=35s: should close incident and return to unpromoted buffer queue
    const res = await ringBuffer.handleSegment(
      {
        mediaMtxPath: 'cam-gate',
        segmentPath: '/var/recordings/cam-gate/post_cooldown.mp4',
        duration: 2.0,
        startTime: new Date(currentTimeMs).toISOString(),
      },
      'cam-gate'
    );

    expect(res.promoted).toBe(false);
    expect(endedEvents.length).toBe(1);
    expect(endedEvents[0].cameraId).toBe('cam-gate');

    const status = ringBuffer.getBufferStatus('cam-gate');
    expect(status.cameras[0].incidentActive).toBe(false);
  });

  it('6. Extends cooldown window upon subsequent motion triggers', async () => {
    // Initial trigger at T=0 (cooldown until T=30)
    await ringBuffer.triggerMotion('cam-gate', new Date(currentTimeMs));

    // Advance to T=20s (10s before expiration) and fire second motion trigger
    currentTimeMs += 20 * 1000;
    await ringBuffer.triggerMotion('cam-gate', new Date(currentTimeMs));

    // Cooldown extended to T = 20 + 30 = 50s
    const status = ringBuffer.getBufferStatus('cam-gate');
    expect(status.cameras[0].incidentActive).toBe(true);
    expect(status.cameras[0].postBufferRemainingSeconds).toBe(30);
  });
});
