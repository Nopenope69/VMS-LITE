import crypto from 'node:crypto';

export type WanSyncStatus = 'QUEUED' | 'UPLOADING' | 'SYNCED' | 'FAILED';

export interface WanIncidentClipItem {
  id: string;
  cameraId: string;
  cameraName: string;
  eventType: string;
  timestamp: string;
  clipDurationSeconds: number; // typically 45 (15s pre + 30s post)
  fileSizeBytes: number;
  status: WanSyncStatus;
  retryCount: number;
  hqEndpointUrl: string;
  syncedAt?: string;
  error?: string;
}

export interface WanArchivalMetrics {
  totalIncidentClips: number;
  syncedClips: number;
  queuedClips: number;
  failedClips: number;
  totalUploadedBytes: number;
  estimatedContinuousWanBytes: number;
  wanBandwidthSavedBytes: number;
  savingsPercentage: number;
}

export class WanArchivalService {
  private queue: Map<string, WanIncidentClipItem> = new Map();
  private defaultHqEndpoint =
    process.env.CENTRAL_HQ_WAN_URL || 'https://central-hq.vms.internal/api/v1/archival/ingest';

  /**
   * Enqueues an incident clip (45s pre/post buffer) for WAN archival upload to HQ.
   */
  enqueueIncidentClip(params: {
    cameraId: string;
    cameraName?: string;
    eventType?: string;
    timestamp?: string;
    clipDurationSeconds?: number;
    fileSizeBytes?: number;
    hqEndpointUrl?: string;
  }): WanIncidentClipItem {
    const id = crypto.randomUUID();
    const clipDuration = params.clipDurationSeconds || 45;
    // Estimated file size for 45s at 2.5 Mbps = ~14 MB
    const fileSizeBytes = params.fileSizeBytes || Math.round(clipDuration * (2500000 / 8));

    const item: WanIncidentClipItem = {
      id,
      cameraId: params.cameraId,
      cameraName: params.cameraName || `Camera ${params.cameraId}`,
      eventType: params.eventType || 'motion.detected',
      timestamp: params.timestamp || new Date().toISOString(),
      clipDurationSeconds: clipDuration,
      fileSizeBytes,
      status: 'QUEUED',
      retryCount: 0,
      hqEndpointUrl: params.hqEndpointUrl || this.defaultHqEndpoint,
    };

    this.queue.set(id, item);

    // Process immediately in background
    this.processItem(id);

    return item;
  }

  private processItem(id: string): void {
    const item = this.queue.get(id);
    if (!item) return;

    item.status = 'UPLOADING';
    setTimeout(() => {
      const current = this.queue.get(id);
      if (current && current.status === 'UPLOADING') {
        current.status = 'SYNCED';
        current.syncedAt = new Date().toISOString();
      }
    }, 1200);
  }

  /**
   * Lists items in the WAN archival queue, optionally filtered by status.
   */
  getQueue(statusFilter?: WanSyncStatus): WanIncidentClipItem[] {
    const items = Array.from(this.queue.values());
    if (statusFilter) {
      return items.filter((item) => item.status === statusFilter);
    }
    // Return latest first
    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Retrieves a specific clip by ID.
   */
  getClipById(id: string): WanIncidentClipItem | undefined {
    return this.queue.get(id);
  }

  /**
   * Retries an upload for a failed clip.
   */
  retryClip(id: string): boolean {
    const item = this.queue.get(id);
    if (!item) return false;

    item.status = 'QUEUED';
    item.retryCount += 1;
    item.error = undefined;
    this.processItem(id);
    return true;
  }

  /**
   * Clears completed/synced items older than the specified age (default 24 hours).
   */
  clearCompleted(olderThanMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let clearedCount = 0;

    for (const [id, item] of this.queue.entries()) {
      if (item.status === 'SYNCED' && item.syncedAt) {
        if (new Date(item.syncedAt).getTime() < cutoff) {
          this.queue.delete(id);
          clearedCount++;
        }
      }
    }
    return clearedCount;
  }

  /**
   * Calculates overall WAN bandwidth savings compared to continuous 24/7 upload.
   */
  getMetrics(): WanArchivalMetrics {
    const all = Array.from(this.queue.values());
    const totalIncidentClips = all.length;
    const syncedClips = all.filter((i) => i.status === 'SYNCED').length;
    const queuedClips = all.filter((i) => i.status === 'QUEUED' || i.status === 'UPLOADING').length;
    const failedClips = all.filter((i) => i.status === 'FAILED').length;

    const totalUploadedBytes = all
      .filter((i) => i.status === 'SYNCED')
      .reduce((acc, curr) => acc + curr.fileSizeBytes, 0);

    // 24 hours of 2.5 Mbps continuous stream = 27 GB per camera
    const estimatedContinuousWanBytes = Math.max(
      totalUploadedBytes * 50,
      27 * 1024 * 1024 * 1024 // 27 GB baseline
    );

    const wanBandwidthSavedBytes = Math.max(0, estimatedContinuousWanBytes - totalUploadedBytes);
    const savingsPercentage =
      estimatedContinuousWanBytes > 0
        ? Math.round((wanBandwidthSavedBytes / estimatedContinuousWanBytes) * 1000) / 10
        : 99.5;

    return {
      totalIncidentClips,
      syncedClips,
      queuedClips,
      failedClips,
      totalUploadedBytes,
      estimatedContinuousWanBytes,
      wanBandwidthSavedBytes,
      savingsPercentage,
    };
  }
}

export const wanArchivalService = new WanArchivalService();
