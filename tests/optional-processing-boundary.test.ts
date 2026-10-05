import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/events/event-bus.js';
import { AiPipelineCoordinator } from '../src/ai/ai-pipeline-coordinator.js';
import { IAiWorker, AiSegmentAnalysisResult } from '../src/ai/ai.types.js';
import { SegmentCreatedEventMetadata } from '../src/recordings/recording.types.js';

describe('Phase 5: Optional Processing Boundary (Core Decoupled from AI/Analytics)', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  const sampleSegment: SegmentCreatedEventMetadata = {
    recordingId: 'rec-test-01',
    cameraId: 'cam-1',
    mediaMtxPath: 'cam1',
    filePath: '/var/recordings/cam1/test.mp4',
    storageUri: 'file:///var/recordings/cam1/test.mp4',
    duration: 30,
    sizeBytes: 5000000,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    format: 'fmp4',
  };

  it('guarantees VMS core operates with zero overhead when AI is disabled', async () => {
    const coordinator = new AiPipelineCoordinator({
      eventBus,
      enabled: false,
    });
    coordinator.start();

    // Register a mock worker
    let workerCalled = false;
    coordinator.registerWorker({
      name: 'test-detector',
      version: '1.0.0',
      isReady: async () => true,
      processSegment: async () => {
        workerCalled = true;
        return {
          recordingId: 'rec-test-01',
          cameraId: 'cam-1',
          siteId: null,
          modelVersion: '1.0.0',
          detections: [],
          processedAt: new Date(),
          processingDurationMs: 10,
        };
      },
    });

    // Emit platform event
    await eventBus.emitEvent({
      type: 'recording.segment_created',
      source: 'recording.engine',
      cameraId: 'cam-1',
      metadata: sampleSegment,
    });

    // Wait a brief tick
    await new Promise((r) => setTimeout(r, 20));

    expect(workerCalled).toBe(false);
    expect(coordinator.getStats().segmentsReceived).toBe(0);
    expect(coordinator.getStats().segmentsProcessed).toBe(0);
  });

  it('isolates fatal worker errors so media capture and core event bus never fail', async () => {
    const coordinator = new AiPipelineCoordinator({
      eventBus,
      enabled: true,
    });
    coordinator.start();

    const faultyWorker: IAiWorker = {
      name: 'crashed-worker',
      version: '1.0.0',
      isReady: async () => true,
      processSegment: async () => {
        throw new Error('FATAL: NPU Out Of Memory - GPU SIGKILL');
      },
    };

    coordinator.registerWorker(faultyWorker);

    // Call handleSegmentCreated directly to verify error boundary
    const results = await coordinator.handleSegmentCreated(sampleSegment);
    expect(results).toEqual([]);
    expect(coordinator.getStats().segmentsFailed).toBe(1);
    expect(coordinator.getStats().segmentsProcessed).toBe(0);
  });
});
