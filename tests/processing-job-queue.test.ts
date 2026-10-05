import { describe, it, expect, beforeEach } from 'vitest';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { PrismaProcessingJobQueue } from '../src/jobs/processing-job.queue.js';
import { JobStatus } from '@prisma/client';

describe('PrismaProcessingJobQueue (Durable Queue)', () => {
  let mockPrisma: any;
  let queue: PrismaProcessingJobQueue;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    queue = new PrismaProcessingJobQueue(mockPrisma);
  });

  it('enqueues a new job and enforces idempotency on (recordingId, jobType)', async () => {
    const job1 = await queue.enqueue({
      recordingId: 'rec_100',
      jobType: 'object_detection',
      priority: 10,
    });

    expect(job1.id).toBeDefined();
    expect(job1.recordingId).toBe('rec_100');
    expect(job1.jobType).toBe('object_detection');
    expect(job1.status).toBe(JobStatus.QUEUED);
    expect(job1.priority).toBe(10);

    // Duplicate enqueue for same recordingId and jobType
    const job2 = await queue.enqueue({
      recordingId: 'rec_100',
      jobType: 'object_detection',
      priority: 5,
    });

    // Should return existing job without duplicating
    expect(job2.id).toBe(job1.id);
    const all = await mockPrisma.processingJob.findMany();
    expect(all).toHaveLength(1);
  });

  it('claims jobs strictly ordered by priority and availability', async () => {
    await queue.enqueue({ recordingId: 'rec_low', jobType: 'ai', priority: 1 });
    await queue.enqueue({ recordingId: 'rec_high', jobType: 'ai', priority: 10 });
    await queue.enqueue({ recordingId: 'rec_med', jobType: 'ai', priority: 5 });

    const claimed = await queue.claimNext('ai', 2);
    expect(claimed).toHaveLength(2);
    expect(claimed[0].recordingId).toBe('rec_high');
    expect(claimed[1].recordingId).toBe('rec_med');
    expect(claimed[0].status).toBe(JobStatus.CLAIMED);
    expect(claimed[0].attempts).toBe(1);
  });

  it('completes a job cleanly', async () => {
    const job = await queue.enqueue({ recordingId: 'rec_done', jobType: 'ai' });
    await queue.complete(job.id, 'yolov8n-v1');

    const updated = await queue.getJob(job.id);
    expect(updated?.status).toBe(JobStatus.COMPLETED);
    expect(updated?.modelVersion).toBe('yolov8n-v1');
    expect(updated?.completedAt).toBeDefined();
  });

  it('retries on failure up to maxAttempts, then transitions to FAILED', async () => {
    const job = await queue.enqueue({
      recordingId: 'rec_fail',
      jobType: 'ai',
      maxAttempts: 2,
    });

    // First attempt
    await queue.claimNext('ai', 1);
    const fail1 = await queue.fail(job.id, 'Driver timeout');
    expect(fail1.retried).toBe(true);
    expect(fail1.attempts).toBe(1);

    const afterFail1 = await queue.getJob(job.id);
    expect(afterFail1?.status).toBe(JobStatus.QUEUED);
    expect(afterFail1?.lastError).toBe('Driver timeout');

    // Second attempt
    await queue.claimNext('ai', 1);
    const fail2 = await queue.fail(job.id, 'Out of Memory');
    expect(fail2.retried).toBe(false);
    expect(fail2.attempts).toBe(2);

    const afterFail2 = await queue.getJob(job.id);
    expect(afterFail2?.status).toBe(JobStatus.FAILED);
    expect(afterFail2?.lastError).toBe('Out of Memory');
  });

  it('reports queue statistics accurately', async () => {
    await queue.enqueue({ recordingId: 'rec_1', jobType: 'ai' });
    await queue.enqueue({ recordingId: 'rec_2', jobType: 'ai' });
    const j3 = await queue.enqueue({ recordingId: 'rec_3', jobType: 'ai' });
    await queue.complete(j3.id);

    const stats = await queue.getStats('ai');
    expect(stats.queued).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(0);
  });
});
