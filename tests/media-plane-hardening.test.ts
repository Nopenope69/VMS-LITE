import { describe, it, expect } from 'vitest';
import { MediaMtxClient, MediaMtxUnavailableError } from '../src/mediamtx/mediamtx.client.js';
import { RecordingEngine } from '../src/recordings/recording-engine.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { StorageController } from '../src/recordings/storage-controller.js';
import { RetentionPolicy } from '../src/recordings/retention-policy.js';
import { EventBus } from '../src/events/event-bus.js';
import { TestClock } from '../src/recordings/clock.js';

function makeEngine(repository: InMemoryRecordingRepository, mediaMtx: MediaMtxClient) {
  return new RecordingEngine({
    repository,
    mediaMtx,
    eventBus: new EventBus(),
    clock: new TestClock(new Date('2026-10-01T12:00:00.000Z')),
    recordingsDir: '/var/recordings',
    statfsFn: async () => ({ bsize: 4096, blocks: 1000, bfree: 900 }),
  });
}

describe('MediaMTX client failure semantics', () => {
  it('surfaces an unreachable media server instead of reporting success', async () => {
    const client = new MediaMtxClient({ mockMode: false, baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(client.addPath('cam_x', 'rtsp://10.0.0.1/stream')).rejects.toBeInstanceOf(MediaMtxUnavailableError);
    await expect(client.getPathRuntime('cam_x')).rejects.toBeInstanceOf(MediaMtxUnavailableError);
  });

  it('tolerates literal percent signs in RTSP passwords', () => {
    const client = new MediaMtxClient({ mockMode: true });
    expect(client.sanitizeRtspUrl('rtsp://admin:50%off@10.0.0.1/s')).toBe('rtsp://admin:50%25off@10.0.0.1/s');
  });
});

describe('Scheduler reconciles MediaMTX with the database', () => {
  it('re-provisions main and sub paths that disappeared (e.g. after a MediaMTX restart)', async () => {
    const repository = new InMemoryRecordingRepository();
    repository.registerCamera({
      id: 'cam-1',
      name: 'Gate',
      mediaMtxPath: 'gate_abc',
      rtspUrl: 'rtsp://10.0.0.5/main',
      subStreamUrl: 'rtsp://10.0.0.5/sub',
      subMediaMtxPath: 'gate_abc_sub',
    });
    const mediaMtx = new MediaMtxClient({ mockMode: true });
    const engine = makeEngine(repository, mediaMtx);

    await (engine as any).scheduler.evaluateAllCameras();
    const main = await mediaMtx.getPath('gate_abc');
    const sub = await mediaMtx.getPath('gate_abc_sub');
    expect(main?.conf).toMatchObject({ source: 'rtsp://10.0.0.5/main', sourceOnDemand: false, record: true });
    expect(sub?.conf).toMatchObject({ source: 'rtsp://10.0.0.5/sub', sourceOnDemand: true, record: false });

    // Simulate MediaMTX losing its runtime config
    await mediaMtx.removePath('gate_abc');
    await (engine as any).scheduler.evaluateAllCameras();
    expect(await mediaMtx.getPath('gate_abc')).not.toBeNull();
  });

  it('applies MANUAL_OFF and keeps recording on for MOTION_ONLY (the Motion Buffer needs segments)', async () => {
    const repository = new InMemoryRecordingRepository();
    repository.registerCamera({ id: 'cam-2', name: 'Dock', mediaMtxPath: 'dock_1', rtspUrl: 'rtsp://10.0.0.6/main' });
    const mediaMtx = new MediaMtxClient({ mockMode: true });
    const engine = makeEngine(repository, mediaMtx);

    await engine.setSchedule('cam-2', 'MANUAL_OFF', []);
    expect((await engine.getSchedule('cam-2')).mode).toBe('MANUAL_OFF');
    expect((await mediaMtx.getPath('dock_1'))?.conf.record).toBe(false);

    await engine.setSchedule('cam-2', 'MOTION_ONLY', []);
    expect((await mediaMtx.getPath('dock_1'))?.conf.record).toBe(true);
  });
});

describe('Timeline spans', () => {
  it('merges back-to-back segments and returns the whole day, not just the latest 500', async () => {
    const repository = new InMemoryRecordingRepository();
    repository.registerCamera({ id: 'cam-3', name: 'Yard', mediaMtxPath: 'yard' });
    const start = Date.parse('2026-10-01T00:00:00.000Z');
    // 24h of 60s segments with a 10 minute outage at 06:00
    for (let i = 0; i < 1440; i++) {
      if (i >= 360 && i < 370) continue;
      await repository.createRecording({
        cameraId: 'cam-3',
        mediaMtxPath: 'yard',
        filePath: `/var/recordings/yard/${i}.mp4`,
        fileName: `${i}.mp4`,
        startTime: new Date(start + i * 60_000),
        endTime: new Date(start + (i + 1) * 60_000),
        duration: 60,
        sizeBytes: 1,
      });
    }
    const engine = makeEngine(repository, new MediaMtxClient({ mockMode: true }));
    const timeline = await engine.getTimelineSpans({ cameraId: 'cam-3', date: '2026-10-01' });

    expect(timeline.spans).toHaveLength(2);
    expect(timeline.spans[0].startTime).toBe('2026-10-01T00:00:00.000Z');
    expect(timeline.spans[0].endTime).toBe('2026-10-01T06:00:00.000Z');
    expect(timeline.spans[1].startTime).toBe('2026-10-01T06:10:00.000Z');
    expect(timeline.totalDurationSeconds).toBe(1430 * 60);
  });
});

describe('Storage FIFO rollover', () => {
  it('pages past bookmarked segments at the head of the catalog instead of stalling', async () => {
    const repository = new InMemoryRecordingRepository();
    const deleted: string[] = [];
    const catalog = new RecordingCatalog({
      repository,
      eventBus: new EventBus(),
      recordingsDir: '/var/recordings',
      fsUnlinkFn: async (p) => {
        deleted.push(p);
      },
    });
    for (let i = 0; i < 120; i++) {
      await repository.createRecording({
        cameraId: 'cam-4',
        mediaMtxPath: 'p',
        filePath: `/var/recordings/p/${String(i).padStart(3, '0')}.mp4`,
        fileName: `${i}.mp4`,
        startTime: new Date(Date.UTC(2026, 0, 1, 0, i)),
        endTime: new Date(Date.UTC(2026, 0, 1, 0, i + 1)),
        duration: 60,
        sizeBytes: 1,
      });
    }

    let usedPercent = 95;
    const controller = new StorageController({
      catalog,
      eventBus: new EventBus(),
      recordingsDir: '/var/recordings',
      canaryWriteFn: async () => ({ latencyMs: 1 }),
      batchSize: 50,
      // Each deletion frees 1% of the disk
      statfsFn: async () => {
        usedPercent = 95 - deleted.length;
        return { bsize: 1, blocks: 100, bfree: 100 - usedPercent };
      },
      // The oldest 60 segments are evidence: one bookmark in the middle of each
      retention: new RetentionPolicy({
        repository,
        bookmarkWindowSeconds: 0,
        holds: {
          bookmarks: async () =>
            Array.from({ length: 60 }, (_, i) => ({ cameraId: 'cam-4', timestamp: new Date(Date.UTC(2026, 0, 1, 0, i, 30)) })),
          activeExports: async () => [],
        },
      }),
    });

    const result = await controller.checkStorage();
    expect(result.triggered).toBe(true);
    expect(result.deletedSegmentsCount).toBeGreaterThan(0);
    expect(deleted.every((p) => Number(p.split('/').pop()!.slice(0, 3)) >= 60)).toBe(true);
    expect(result.usedPercentAfter).toBeLessThanOrEqual(80);
  });
});
