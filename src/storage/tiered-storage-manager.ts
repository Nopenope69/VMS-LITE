import { IStorageProvider } from './storage-provider.interface.js';

export interface OffloadTask {
  id: string;
  key: string;
  reason: 'bookmark' | 'alert' | 'manual' | 'policy';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  remoteUri?: string;
  error?: string;
  queuedAt: Date;
  completedAt?: Date;
}

export interface TieredStorageManagerOptions {
  primary: IStorageProvider;
  secondary?: IStorageProvider;
  maxConcurrentUploads?: number;
}

/**
 * Manages tiered storage policies (Local Primary -> Remote Secondary).
 * Allows mission-critical clips (bookmarks, motion alerts, evidence) to be offloaded
 * to cloud object storage or NAS while keeping continuous video local.
 */
export class TieredStorageManager {
  private readonly primary: IStorageProvider;
  private secondary?: IStorageProvider;
  private readonly maxConcurrent: number;
  private readonly queue: Map<string, OffloadTask> = new Map();
  private activeUploads = 0;

  constructor(options: TieredStorageManagerOptions) {
    this.primary = options.primary;
    this.secondary = options.secondary;
    this.maxConcurrent = options.maxConcurrentUploads ?? 2;
  }

  setSecondaryProvider(secondary: IStorageProvider): void {
    this.secondary = secondary;
  }

  getPrimaryProvider(): IStorageProvider {
    return this.primary;
  }

  getSecondaryProvider(): IStorageProvider | undefined {
    return this.secondary;
  }

  /**
   * Enqueues an offload job to secondary storage.
   */
  async enqueueOffload(
    key: string,
    reason: OffloadTask['reason'] = 'alert'
  ): Promise<OffloadTask> {
    const taskId = `offload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const task: OffloadTask = {
      id: taskId,
      key,
      reason,
      status: 'pending',
      queuedAt: new Date(),
    };

    this.queue.set(taskId, task);
    this.drainQueue();
    return task;
  }

  getTask(taskId: string): OffloadTask | undefined {
    return this.queue.get(taskId);
  }

  getStats(): { pending: number; inProgress: number; completed: number; failed: number } {
    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    let failed = 0;

    for (const task of this.queue.values()) {
      if (task.status === 'pending') pending++;
      else if (task.status === 'in_progress') inProgress++;
      else if (task.status === 'completed') completed++;
      else if (task.status === 'failed') failed++;
    }

    return { pending, inProgress, completed, failed };
  }

  private drainQueue(): void {
    if (!this.secondary) return;
    if (this.activeUploads >= this.maxConcurrent) return;

    for (const task of this.queue.values()) {
      if (task.status === 'pending') {
        this.processTask(task);
        if (this.activeUploads >= this.maxConcurrent) break;
      }
    }
  }

  private async processTask(task: OffloadTask): Promise<void> {
    if (!this.secondary) {
      task.status = 'failed';
      task.error = 'No secondary storage provider configured';
      return;
    }

    task.status = 'in_progress';
    this.activeUploads++;

    try {
      const readStream = await this.primary.getStream(task.key);
      const remoteUri = await this.secondary.put(task.key, readStream, {
        metadata: {
          offloadReason: task.reason,
          sourceAppliance: 'vms-lite',
        },
      });

      task.status = 'completed';
      task.remoteUri = remoteUri;
      task.completedAt = new Date();
    } catch (err: any) {
      task.status = 'failed';
      task.error = err.message || 'Offload stream transfer error';
    } finally {
      this.activeUploads--;
      this.drainQueue();
    }
  }
}
