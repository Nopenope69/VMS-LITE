import { EventBus } from '../events/event-bus.js';
import { SegmentCreatedEventMetadata } from '../recordings/recording.types.js';
import { IAiWorker, AiSegmentAnalysisResult } from './ai.types.js';
import { IProcessingJobQueue } from '../jobs/processing-job.queue.js';
import { IDetectionRepository } from './detection.repository.js';

export interface AiPipelineStats {
  segmentsReceived: number;
  segmentsProcessed: number;
  segmentsFailed: number;
  totalDetectionsFound: number;
}

export interface AiPipelineCoordinatorOptions {
  eventBus: EventBus;
  jobQueue?: IProcessingJobQueue;
  detectionRepository?: IDetectionRepository;
}

/**
 * Asynchronous AI Pipeline Coordinator (Package 3 Seam).
 *
 * Implements the 4-way separation:
 * 1. Consumes `recording.segment_created` events asynchronously.
 * 2. Enqueues durable `ProcessingJob` entries into PostgreSQL (crash-resilient).
 * 3. Dispatches completed video chunks to registered AI workers (isolation).
 * 4. Stores structured results in `DetectionRepository` for instant timeline search.
 */
export class AiPipelineCoordinator {
  private readonly workers = new Map<string, IAiWorker>();
  private readonly eventBus: EventBus;
  private readonly jobQueue?: IProcessingJobQueue;
  private readonly detectionRepository?: IDetectionRepository;
  private isRunning = false;
  private stats: AiPipelineStats = {
    segmentsReceived: 0,
    segmentsProcessed: 0,
    segmentsFailed: 0,
    totalDetectionsFound: 0,
  };

  constructor(options: EventBus | AiPipelineCoordinatorOptions) {
    if ('emitEvent' in options) {
      this.eventBus = options;
    } else {
      this.eventBus = options.eventBus;
      this.jobQueue = options.jobQueue;
      this.detectionRepository = options.detectionRepository;
    }
  }

  registerWorker(worker: IAiWorker): void {
    this.workers.set(worker.name, worker);
  }

  unregisterWorker(name: string): void {
    this.workers.delete(name);
  }

  getWorker(name: string): IAiWorker | undefined {
    return this.workers.get(name);
  }

  getStats(): Readonly<AiPipelineStats> {
    return { ...this.stats };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.eventBus.subscribe('recording.segment_created', (event) => {
      if (!this.isRunning) return;
      const metadata = event.metadata as unknown as SegmentCreatedEventMetadata;
      if (metadata && metadata.recordingId) {
        // Asynchronously process without blocking caller or event dispatch
        setImmediate(() => {
          this.handleSegmentCreated(metadata).catch((err) => {
            // Absolute error boundary: AI errors must never bubble to caller
            console.error('[AiPipelineCoordinator] Uncaught segment error:', err);
          });
        });
      }
    });
  }

  stop(): void {
    this.isRunning = false;
  }

  async handleSegmentCreated(
    segment: SegmentCreatedEventMetadata
  ): Promise<AiSegmentAnalysisResult[]> {
    this.stats.segmentsReceived++;
    const activeWorkers = Array.from(this.workers.values());
    if (activeWorkers.length === 0) {
      return [];
    }

    const results: AiSegmentAnalysisResult[] = [];

    for (const worker of activeWorkers) {
      const jobType = `ai.${worker.name}`;
      let jobId: string | undefined;

      // If durable queue is configured, enqueue and claim job
      if (this.jobQueue) {
        try {
          const job = await this.jobQueue.enqueue({
            recordingId: segment.recordingId,
            jobType,
            modelVersion: worker.version,
          });
          jobId = job.id;
        } catch (queueErr) {
          console.warn(`[AiPipelineCoordinator] Could not enqueue job for ${jobType}:`, queueErr);
        }
      }

      try {
        const ready = await worker.isReady();
        if (!ready) {
          throw new Error(`Worker ${worker.name} is not ready`);
        }

        const result = await worker.processSegment(segment);
        results.push(result);
        this.stats.segmentsProcessed++;
        this.stats.totalDetectionsFound += result.detections.length;

        // Persist structured detections for smart timeline search
        if (this.detectionRepository && result.detections.length > 0) {
          const segStartTime = segment.startTime instanceof Date
            ? segment.startTime
            : new Date(segment.startTime);

          await this.detectionRepository.saveDetections(
            segment.recordingId,
            segment.cameraId,
            segment.siteId ?? null,
            result.detections,
            result.modelVersion,
            segStartTime
          );
        }

        // Mark durable job completed
        if (this.jobQueue && jobId) {
          await this.jobQueue.complete(jobId, result.modelVersion);
        }

        // Emit downstream event for live alerts / webhooks
        if (result.detections.length > 0) {
          await this.eventBus.emitEvent({
            type: 'ai.detections_processed',
            source: `ai.worker.${worker.name}`,
            cameraId: segment.cameraId,
            siteId: segment.siteId,
            metadata: {
              recordingId: segment.recordingId,
              detections: result.detections,
              worker: worker.name,
              modelVersion: result.modelVersion,
              processingDurationMs: result.processingDurationMs,
            },
          });
        }
      } catch (err: any) {
        this.stats.segmentsFailed++;
        const errorMessage = err?.message || String(err);

        // Record failure in durable queue
        if (this.jobQueue && jobId) {
          await this.jobQueue.fail(jobId, errorMessage).catch(() => {});
        }

        console.warn(
          `[AiPipelineCoordinator] Worker ${worker.name} failed on segment ${segment.recordingId}:`,
          errorMessage
        );
      }
    }

    return results;
  }
}
