import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/events/event-bus.js';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { PrismaProcessingJobQueue } from '../src/jobs/processing-job.queue.js';
import { PrismaDetectionRepository } from '../src/ai/detection.repository.js';
import { AiPipelineCoordinator } from '../src/ai/ai-pipeline-coordinator.js';
import { IAiWorker } from '../src/ai/ai.types.js';
import { SegmentCreatedEventMetadata } from '../src/recordings/recording.types.js';
import { JobStatus } from '@prisma/client';

describe('AI Durable Pipeline Integration (The 4-Way Separation)', () => {
  let mockPrisma: any;
  let eventBus: EventBus;
  let jobQueue: PrismaProcessingJobQueue;
  let detectionRepo: PrismaDetectionRepository;
  let coordinator: AiPipelineCoordinator;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    eventBus = new EventBus(mockPrisma);
    jobQueue = new PrismaProcessingJobQueue(mockPrisma);
    detectionRepo = new PrismaDetectionRepository(mockPrisma);

    coordinator = new AiPipelineCoordinator({
      eventBus,
      jobQueue,
      detectionRepository: detectionRepo,
    });
  });

  it('completes the full flow: segment -> durable job -> worker -> structured detections', async () => {
    const mockWorker: IAiWorker = {
      name: 'yolov8-person',
      version: '8.1.0',
      isReady: async () => true,
      processSegment: async (seg) => ({
        recordingId: seg.recordingId,
        cameraId: seg.cameraId,
        siteId: seg.siteId || null,
        detections: [
          {
            id: 'track-1',
            label: 'person',
            confidence: 0.96,
            boundingBox: { x: 0.25, y: 0.1, width: 0.2, height: 0.6 },
            timestampOffsetMs: 12000,
          },
        ],
        processedAt: new Date(),
        processingDurationMs: 310,
        modelVersion: 'yolov8n-onnx',
      }),
    };

    coordinator.registerWorker(mockWorker);

    let downstreamAlert: any = null;
    eventBus.subscribe('ai.detections_processed', (evt) => {
      downstreamAlert = evt;
    });

    const segment: SegmentCreatedEventMetadata = {
      recordingId: 'rec-durable-001',
      cameraId: 'cam-gate',
      siteId: 'site-delhi-hub',
      mediaMtxPath: 'cam_gate',
      filePath: '/recordings/cam_gate/2026-10-06_12-00-00.mp4',
      storageUri: 'file:///recordings/cam_gate/2026-10-06_12-00-00.mp4',
      duration: 60,
      sizeBytes: 12500000,
      startTime: new Date('2026-10-06T12:00:00.000Z'),
      endTime: new Date('2026-10-06T12:01:00.000Z'),
      format: 'fmp4',
    };

    // Process segment
    const results = await coordinator.handleSegmentCreated(segment);
    expect(results).toHaveLength(1);

    // 1. Verify Job queue record
    const jobs = await mockPrisma.processingJob.findMany({
      where: { recordingId: 'rec-durable-001' },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe(JobStatus.COMPLETED);
    expect(jobs[0].jobType).toBe('ai.yolov8-person');
    expect(jobs[0].modelVersion).toBe('yolov8n-onnx');

    // 2. Verify Structured Detections in DetectionRepository
    const detections = await detectionRepo.queryDetections({
      recordingId: 'rec-durable-001',
    });
    expect(detections).toHaveLength(1);
    expect(detections[0].label).toBe('person');
    expect(detections[0].confidence).toBe(0.96);
    expect(detections[0].timestamp.toISOString()).toBe('2026-10-06T12:00:12.000Z');
    expect(detections[0].siteId).toBe('site-delhi-hub');

    // 3. Verify Downstream EventBus Notification
    expect(downstreamAlert).not.toBeNull();
    expect(downstreamAlert.type).toBe('ai.detections_processed');
    expect(downstreamAlert.metadata.recordingId).toBe('rec-durable-001');
  });

  it('records job failure in queue without throwing into recording pipeline', async () => {
    const faultyWorker: IAiWorker = {
      name: 'faulty-detector',
      version: '1.0.0',
      isReady: async () => true,
      processSegment: async () => {
        throw new Error('NPU PCIe Bus Error');
      },
    };

    coordinator.registerWorker(faultyWorker);

    const segment: SegmentCreatedEventMetadata = {
      recordingId: 'rec-fault-002',
      cameraId: 'cam-loading-dock',
      siteId: null,
      mediaMtxPath: 'cam_dock',
      filePath: '/recordings/cam_dock/seg.mp4',
      storageUri: 'file:///recordings/cam_dock/seg.mp4',
      duration: 60,
      sizeBytes: 1000,
      startTime: new Date(),
      endTime: new Date(),
      format: 'fmp4',
    };

    // Must NOT throw
    await expect(coordinator.handleSegmentCreated(segment)).resolves.toEqual([]);

    // Verify job in database is queued for retry with lastError recorded
    const jobs = await mockPrisma.processingJob.findMany({
      where: { recordingId: 'rec-fault-002' },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe(JobStatus.QUEUED);
    expect(jobs[0].lastError).toContain('NPU PCIe Bus Error');

    const stats = coordinator.getStats();
    expect(stats.segmentsFailed).toBe(1);
    expect(stats.segmentsProcessed).toBe(0);
  });
});
