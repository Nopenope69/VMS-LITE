import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/events/event-bus.js';
import { AiPipelineCoordinator } from '../src/ai/ai-pipeline-coordinator.js';
import { IAiWorker, AiSegmentAnalysisResult } from '../src/ai/ai.types.js';
import { SegmentCreatedEventMetadata } from '../src/recordings/recording.types.js';

describe('AI Pipeline Coordinator (Package 3 Seam)', () => {
  let eventBus: EventBus;
  let coordinator: AiPipelineCoordinator;

  beforeEach(() => {
    // In-memory Prisma fallback inside EventBus
    eventBus = new EventBus({} as any);
    coordinator = new AiPipelineCoordinator(eventBus);
  });

  it('processes a segment through a registered AI worker and emits ai.detections_processed', async () => {
    let workerCalled = false;
    const mockWorker: IAiWorker = {
      name: 'yolov8-person-vehicle',
      version: '1.0.0',
      isReady: async () => true,
      processSegment: async (seg) => {
        workerCalled = true;
        return {
          recordingId: seg.recordingId,
          cameraId: seg.cameraId,
          siteId: seg.siteId || null,
          detections: [
            {
              id: 'det-1',
              label: 'person',
              confidence: 0.94,
              boundingBox: { x: 0.2, y: 0.3, width: 0.15, height: 0.4 },
              timestampOffsetMs: 12500,
            },
            {
              id: 'det-2',
              label: 'vehicle',
              confidence: 0.88,
              boundingBox: { x: 0.5, y: 0.6, width: 0.3, height: 0.25 },
              timestampOffsetMs: 34000,
            },
          ],
          processedAt: new Date(),
          processingDurationMs: 420,
          modelVersion: 'yolov8n-640',
        };
      },
    };

    coordinator.registerWorker(mockWorker);

    let downstreamEvent: any = null;
    eventBus.subscribe('ai.detections_processed', (evt) => {
      downstreamEvent = evt;
    });

    const testSegment: SegmentCreatedEventMetadata = {
      recordingId: 'rec-12345',
      cameraId: 'cam-front-gate',
      siteId: 'site-mumbai-warehouse',
      mediaMtxPath: 'cam_front',
      filePath: '/var/recordings/cam_front/seg1.mp4',
      storageUri: 'file:///var/recordings/cam_front/seg1.mp4',
      duration: 60,
      sizeBytes: 15400000,
      startTime: new Date('2026-10-06T10:00:00Z'),
      endTime: new Date('2026-10-06T10:01:00Z'),
      format: 'fmp4',
    };

    const results = await coordinator.handleSegmentCreated(testSegment);

    expect(workerCalled).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0].detections).toHaveLength(2);
    expect(results[0].detections[0].label).toBe('person');
    expect(results[0].siteId).toBe('site-mumbai-warehouse');

    // Downstream event verification
    expect(downstreamEvent).not.toBeNull();
    expect(downstreamEvent.type).toBe('ai.detections_processed');
    expect(downstreamEvent.cameraId).toBe('cam-front-gate');
    expect(downstreamEvent.siteId).toBe('site-mumbai-warehouse');
    expect(downstreamEvent.metadata.recordingId).toBe('rec-12345');
    expect(downstreamEvent.metadata.detections).toHaveLength(2);

    const stats = coordinator.getStats();
    expect(stats.segmentsReceived).toBe(1);
    expect(stats.segmentsProcessed).toBe(1);
    expect(stats.totalDetectionsFound).toBe(2);
  });

  it('isolates worker failure so that recording pipeline is completely unaffected', async () => {
    const crashingWorker: IAiWorker = {
      name: 'broken-npu-worker',
      version: '0.1.0',
      isReady: async () => true,
      processSegment: async () => {
        throw new Error('NPU Driver Out Of Memory (OOM)');
      },
    };

    coordinator.registerWorker(crashingWorker);

    const testSegment: SegmentCreatedEventMetadata = {
      recordingId: 'rec-fail-1',
      cameraId: 'cam-1',
      siteId: null,
      mediaMtxPath: 'cam1',
      filePath: '/var/recordings/cam1/seg.mp4',
      storageUri: 'file:///var/recordings/cam1/seg.mp4',
      duration: 60,
      sizeBytes: 1024,
      startTime: new Date(),
      endTime: new Date(),
      format: 'fmp4',
    };

    // Must NOT throw
    await expect(coordinator.handleSegmentCreated(testSegment)).resolves.toEqual([]);

    const stats = coordinator.getStats();
    expect(stats.segmentsReceived).toBe(1);
    expect(stats.segmentsFailed).toBe(1);
    expect(stats.segmentsProcessed).toBe(0);
  });

  it('coordinates events dispatched via EventBus seamlessly', async () => {
    coordinator.start();

    let processedCount = 0;
    const worker: IAiWorker = {
      name: 'simple-worker',
      version: '1.0.0',
      isReady: async () => true,
      processSegment: async (seg) => {
        processedCount++;
        return {
          recordingId: seg.recordingId,
          cameraId: seg.cameraId,
          siteId: null,
          detections: [],
          processedAt: new Date(),
          processingDurationMs: 50,
          modelVersion: 'v1',
        };
      },
    };

    coordinator.registerWorker(worker);

    // Emit event on EventBus as RecordingCatalog does
    await eventBus.emitEvent({
      type: 'recording.segment_created',
      source: 'recording.engine',
      cameraId: 'cam-lobby',
      metadata: {
        recordingId: 'rec-event-bus-1',
        cameraId: 'cam-lobby',
        siteId: 'site-hq',
        mediaMtxPath: 'cam_lobby',
        filePath: '/var/recordings/cam_lobby/1.mp4',
        storageUri: 'file:///var/recordings/cam_lobby/1.mp4',
        duration: 30,
        sizeBytes: 5000,
        startTime: new Date(),
        endTime: new Date(),
        format: 'fmp4',
      },
    });

    // Wait for setImmediate dispatch
    await new Promise((r) => setTimeout(r, 50));

    expect(processedCount).toBe(1);
    coordinator.stop();
  });
});
