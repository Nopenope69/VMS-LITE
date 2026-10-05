import { PrismaClient, JobStatus, ProcessingJob } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';

export interface EnqueueJobInput {
  recordingId: string;
  jobType: string;
  priority?: number;
  availableAt?: Date;
  modelVersion?: string;
  maxAttempts?: number;
}

export interface JobQueueStats {
  queued: number;
  claimed: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface IProcessingJobQueue {
  enqueue(input: EnqueueJobInput): Promise<ProcessingJob>;
  claimNext(jobTypes: string[] | string, limit?: number): Promise<ProcessingJob[]>;
  complete(jobId: string, modelVersion?: string): Promise<void>;
  fail(jobId: string, errorMessage: string): Promise<{ retried: boolean; attempts: number }>;
  getJob(jobId: string): Promise<ProcessingJob | null>;
  getStats(jobType?: string): Promise<JobQueueStats>;
}

/**
 * Durable PostgreSQL job queue for edge appliances.
 *
 * Guarantees at-least-once delivery for asynchronous video workloads
 * without requiring Redis or Kafka dependencies on budget hardware.
 * Survives power cuts and process restarts.
 */
export class PrismaProcessingJobQueue implements IProcessingJobQueue {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /**
   * Enqueues an analysis or storage job. Idempotent on (recordingId, jobType).
   */
  async enqueue(input: EnqueueJobInput): Promise<ProcessingJob> {
    const priority = input.priority ?? 0;
    const availableAt = input.availableAt ?? new Date();
    const maxAttempts = input.maxAttempts ?? 3;

    // Idempotent upsert: if job already exists and is QUEUED or FAILED, we do not re-run if completed
    const existing = await this.prisma.processingJob.findUnique({
      where: {
        recordingId_jobType: {
          recordingId: input.recordingId,
          jobType: input.jobType,
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.processingJob.create({
      data: {
        recordingId: input.recordingId,
        jobType: input.jobType,
        status: JobStatus.QUEUED,
        priority,
        attempts: 0,
        availableAt,
        maxAttempts,
        modelVersion: input.modelVersion ?? null,
      },
    });
  }

  /**
   * Claims up to `limit` available jobs for processing.
   */
  async claimNext(jobTypes: string[] | string, limit: number = 1): Promise<ProcessingJob[]> {
    const types = Array.isArray(jobTypes) ? jobTypes : [jobTypes];
    const now = new Date();

    const candidates = await this.prisma.processingJob.findMany({
      where: {
        jobType: { in: types },
        status: JobStatus.QUEUED,
        availableAt: { lte: now },
      },
      orderBy: [
        { priority: 'desc' },
        { availableAt: 'asc' },
      ],
      take: limit,
    });

    const claimed: ProcessingJob[] = [];
    for (const job of candidates) {
      const updated = await this.prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.CLAIMED,
          startedAt: now,
          attempts: (job.attempts ?? 0) + 1,
        },
      });
      claimed.push(updated);
    }

    return claimed;
  }

  /**
   * Marks a job as completed.
   */
  async complete(jobId: string, modelVersion?: string): Promise<void> {
    await this.prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
        modelVersion: modelVersion ?? undefined,
        lastError: null,
      },
    });
  }

  /**
   * Fails a job with automatic exponential backoff retry.
   */
  async fail(jobId: string, errorMessage: string): Promise<{ retried: boolean; attempts: number }> {
    const job = await this.prisma.processingJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const attempts = (job.attempts ?? 0) + (job.status === JobStatus.CLAIMED ? 0 : 1);
    const canRetry = attempts < (job.maxAttempts ?? 3);

    if (canRetry) {
      // Exponential backoff: 5s, 20s, 60s
      const delayMs = Math.min(60_000, 5_000 * Math.pow(2, Math.max(0, attempts - 1)));
      const nextAvailable = new Date(Date.now() + delayMs);

      await this.prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.QUEUED,
          attempts,
          availableAt: nextAvailable,
          lastError: errorMessage,
        },
      });

      return { retried: true, attempts };
    } else {
      await this.prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          attempts,
          completedAt: new Date(),
          lastError: errorMessage,
        },
      });

      return { retried: false, attempts };
    }
  }

  async getJob(jobId: string): Promise<ProcessingJob | null> {
    return this.prisma.processingJob.findUnique({ where: { id: jobId } });
  }

  async getStats(jobType?: string): Promise<JobQueueStats> {
    const where = jobType ? { jobType } : {};
    const jobs = await this.prisma.processingJob.findMany({ where });

    let queued = 0;
    let claimed = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const job of jobs) {
      switch (job.status) {
        case JobStatus.QUEUED:
          queued++;
          break;
        case JobStatus.CLAIMED:
          claimed++;
          break;
        case JobStatus.PROCESSING:
          processing++;
          break;
        case JobStatus.COMPLETED:
          completed++;
          break;
        case JobStatus.FAILED:
          failed++;
          break;
      }
    }

    return { queued, claimed, processing, completed, failed };
  }
}
