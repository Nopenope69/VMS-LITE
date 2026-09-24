import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { StorageManager } from '../src/recordings/storage-manager.service.js';
import { RecordingService } from '../src/recordings/recording.service.js';
import { EventBus } from '../src/events/event-bus.js';

describe('StorageManager & FIFO Rollover (REC-04, REC-05)', () => {
  let tempDir: string;
  let eventBus: EventBus;
  let recordingService: RecordingService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-storage-test-'));
    eventBus = new EventBus();
    recordingService = new RecordingService({ eventBus });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleaned up
    }
  });

  describe('getStorageMetrics with native fs.statfs', () => {
    it('calculates total, free, used bytes and percent from disk', async () => {
      const storageManager = new StorageManager({
        config: { recordingsDir: tempDir },
      });

      const metrics = await storageManager.getStorageMetrics();
      expect(metrics.totalBytes).toBeGreaterThan(0);
      expect(metrics.freeBytes).toBeGreaterThan(0);
      expect(metrics.usedBytes).toBeGreaterThanOrEqual(0);
      expect(metrics.usedPercent).toBeGreaterThanOrEqual(0);
      expect(metrics.usedPercent).toBeLessThanOrEqual(100);
      expect(metrics.mountPath).toBe(tempDir);
    });

    it('accurately computes metrics from custom statfs implementation', async () => {
      // 100 blocks of 1MB = 100MB total, 20 blocks free = 20MB free -> 80% used
      const customStatfs = vi.fn().mockResolvedValue({
        bsize: 1024 * 1024,
        blocks: 100,
        bfree: 20,
      });

      const storageManager = new StorageManager({
        statfsFn: customStatfs,
        config: { recordingsDir: tempDir },
      });

      const metrics = await storageManager.getStorageMetrics();
      expect(metrics.totalBytes).toBe(100 * 1024 * 1024);
      expect(metrics.freeBytes).toBe(20 * 1024 * 1024);
      expect(metrics.usedBytes).toBe(80 * 1024 * 1024);
      expect(metrics.usedPercent).toBe(80);
    });
  });

  describe('checkStorage threshold alerts (REC-04)', () => {
    it('returns status ok and emits no events when disk usage is below warning threshold', async () => {
      let warningEmitted = false;
      eventBus.subscribe('storage.warning', () => {
        warningEmitted = true;
      });

      // 40% used
      const customStatfs = vi.fn().mockResolvedValue({
        bsize: 1024 * 1024,
        blocks: 100,
        bfree: 60,
      });

      const storageManager = new StorageManager({
        eventBus,
        statfsFn: customStatfs,
        config: { recordingsDir: tempDir, warningThresholdPercent: 80, criticalThresholdPercent: 90 },
      });

      const result = await storageManager.checkStorage();
      expect(result.status).toBe('ok');
      expect(result.metrics.usedPercent).toBe(40);
      expect(warningEmitted).toBe(false);
    });

    it('emits storage.warning when usage exceeds warning threshold (80%)', async () => {
      let warningEvent: any = null;
      eventBus.subscribe('storage.warning', (evt) => {
        warningEvent = evt;
      });

      // 85% used
      const customStatfs = vi.fn().mockResolvedValue({
        bsize: 1024 * 1024,
        blocks: 100,
        bfree: 15,
      });

      const storageManager = new StorageManager({
        eventBus,
        statfsFn: customStatfs,
        config: { recordingsDir: tempDir, warningThresholdPercent: 80, criticalThresholdPercent: 90 },
      });

      const result = await storageManager.checkStorage();
      expect(result.status).toBe('warning');
      expect(result.metrics.usedPercent).toBe(85);
      expect(warningEvent).not.toBeNull();
      expect(warningEvent.type).toBe('storage.warning');
      expect(warningEvent.severity).toBe('warn');
    });

    it('emits storage.full and triggers rollover when usage exceeds critical threshold (90%)', async () => {
      let fullEvent: any = null;
      let rolloverEvent: any = null;
      eventBus.subscribe('storage.full', (evt) => {
        fullEvent = evt;
      });
      eventBus.subscribe('storage.rollover', (evt) => {
        rolloverEvent = evt;
      });

      // Create a mock segment file in tempDir
      const dummyFile = path.join(tempDir, 'chunk_01.mp4');
      await fs.writeFile(dummyFile, 'dummy-video-data');

      await recordingService.ingestSegment({
        mediaMtxPath: 'cam1',
        segmentPath: dummyFile,
        duration: 30,
      });

      // First call (checkStorage): 95% used.
      // Second call (inside rollover): 75% used.
      let statfsCallCount = 0;
      const customStatfs = vi.fn().mockImplementation(async () => {
        statfsCallCount++;
        if (statfsCallCount <= 1) {
          return { bsize: 1024 * 1024, blocks: 100, bfree: 5 }; // 95% used
        }
        return { bsize: 1024 * 1024, blocks: 100, bfree: 25 }; // 75% used
      });

      const storageManager = new StorageManager({
        eventBus,
        recordingService,
        statfsFn: customStatfs,
        config: {
          recordingsDir: tempDir,
          warningThresholdPercent: 80,
          criticalThresholdPercent: 90,
          targetThresholdPercent: 80,
        },
      });

      const result = await storageManager.checkStorage();
      expect(result.status).toBe('critical');
      expect(result.purgedSegments).toBe(1);
      expect(fullEvent).not.toBeNull();
      expect(fullEvent.type).toBe('storage.full');
      expect(rolloverEvent).not.toBeNull();
      expect(rolloverEvent.type).toBe('storage.rollover');

      // Check file was deleted from disk
      await expect(fs.stat(dummyFile)).rejects.toThrow();
    });
  });

  describe('FIFO Rollover & Path Traversal Guard (REC-05, T-03-06)', () => {
    it('purges segments in FIFO order (oldest first)', async () => {
      const file1 = path.join(tempDir, 'oldest.mp4');
      const file2 = path.join(tempDir, 'middle.mp4');
      const file3 = path.join(tempDir, 'newest.mp4');

      await fs.writeFile(file1, '1111');
      await fs.writeFile(file2, '2222');
      await fs.writeFile(file3, '3333');

      // Ingest with staggered times
      await recordingService.ingestSegment({
        mediaMtxPath: 'cam1',
        segmentPath: file1,
        duration: 10,
      });
      // Small pause to guarantee different timestamps
      await new Promise((r) => setTimeout(r, 10));

      await recordingService.ingestSegment({
        mediaMtxPath: 'cam1',
        segmentPath: file2,
        duration: 10,
      });
      await new Promise((r) => setTimeout(r, 10));

      await recordingService.ingestSegment({
        mediaMtxPath: 'cam1',
        segmentPath: file3,
        duration: 10,
      });

      // Simulate disk space requiring 2 purges before reaching target
      let calls = 0;
      const customStatfs = vi.fn().mockImplementation(async () => {
        calls++;
        if (calls <= 1) {
          return { bsize: 1024, blocks: 100, bfree: 10 }; // 90% used
        }
        return { bsize: 1024, blocks: 100, bfree: 30 }; // 70% used
      });

      const storageManager = new StorageManager({
        eventBus,
        recordingService,
        statfsFn: customStatfs,
        config: {
          recordingsDir: tempDir,
          batchSize: 1, // Batch 1 file per iteration
          targetThresholdPercent: 80,
        },
      });

      const rollover = await storageManager.enforceDiskQuota(80);
      expect(rollover.purgedCount).toBe(2);

      // Oldest and middle should be removed
      await expect(fs.stat(file1)).rejects.toThrow();
      await expect(fs.stat(file2)).rejects.toThrow();

      // Newest should still exist!
      const statNew = await fs.stat(file3);
      expect(statNew.isFile()).toBe(true);
    });

    it('refuses to delete files outside recordingsDir (T-03-06)', async () => {
      // Create external protected file outside tempDir
      const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-foreign-'));
      const protectedFile = path.join(foreignDir, 'do_not_delete.txt');
      await fs.writeFile(protectedFile, 'critical-system-data');

      // Force-register this foreign file in recording service
      await recordingService.ingestSegment({
        mediaMtxPath: 'cam1',
        segmentPath: protectedFile,
        duration: 10,
      });

      const customStatfs = vi.fn().mockResolvedValue({
        bsize: 1024,
        blocks: 100,
        bfree: 5, // 95% used
      });

      const storageManager = new StorageManager({
        eventBus,
        recordingService,
        statfsFn: customStatfs,
        config: {
          recordingsDir: tempDir, // Confined to tempDir
          targetThresholdPercent: 80,
        },
      });

      await storageManager.enforceDiskQuota(80);

      // Verify the external file was NOT touched!
      const statProtected = await fs.stat(protectedFile);
      expect(statProtected.isFile()).toBe(true);

      await fs.rm(foreignDir, { recursive: true, force: true });
    });
  });
});
