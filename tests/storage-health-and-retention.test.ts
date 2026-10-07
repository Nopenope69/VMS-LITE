import { describe, it, expect, beforeEach } from 'vitest';
import { StorageController } from '../src/recordings/storage-controller.js';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { EventBus } from '../src/events/event-bus.js';

describe('Phase 2: Storage Reliability (Health State Machine & Tiered Retention)', () => {
  let repository: InMemoryRecordingRepository;
  let catalog: RecordingCatalog;
  let eventBus: EventBus;
  let storageController: StorageController;
  let simulatedBlocks: bigint;
  let simulatedBfree: bigint;
  const bsize = 4096n;

  beforeEach(() => {
    repository = new InMemoryRecordingRepository();
    repository.registerCamera({
      id: 'cam-1',
      name: 'Storage Camera',
      mediaMtxPath: 'storage_cam',
    });
    eventBus = new EventBus();
    catalog = new RecordingCatalog({
      repository,
      eventBus,
      recordingsDir: '/tmp/vms_test_recordings',
      fsUnlinkFn: async () => {},
    });

    // 100 GB total disk simulation
    simulatedBlocks = 25_000_000n; // 100GB
    simulatedBfree = 15_000_000n;  // 60GB free (40% used => HEALTHY)

    storageController = new StorageController({
      catalog,
      eventBus,
      recordingsDir: '/tmp/vms_test_recordings',
      warningThresholdPercent: 80,
      criticalThresholdPercent: 90,
      targetThresholdPercent: 75,
      continuousRetentionDays: 7,
      eventRetentionDays: 15,
      incidentRetentionDays: 60,
      maxProtectedThresholdPercent: 25,
      statfsFn: async () => ({
        bsize,
        blocks: simulatedBlocks,
        bfree: simulatedBfree,
      }),
      canaryWriteFn: async () => ({ latencyMs: 15 }),
    });
  });

  describe('Storage Health State Machine & Active Canary', () => {
    it('real canary fails when the recordings root is not writable, even outside test mode', async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const unwritable = new StorageController({ catalog, eventBus, recordingsDir: '/tmp/vms_test_missing_root/x' });
        expect((await unwritable.runWriteCanary()).success).toBe(false);
      } finally {
        process.env.NODE_ENV = previous;
      }
    });

    it('evaluates HEALTHY when disk usage is low and canary latency is normal', async () => {
      const metrics = await storageController.getStorageMetrics();
      expect(metrics.healthStatus).toBe('HEALTHY');
      expect(metrics.canaryLatencyMs).toBe(15);
      expect(metrics.usedPercent).toBe(40);
    });

    it('transitions to WRITE_DEGRADED and emits event when canary latency exceeds 1000ms', async () => {
      let emitted: any = null;
      eventBus.subscribe('storage.health_changed', (evt) => {
        emitted = evt;
      });

      const degradedController = new StorageController({
        catalog,
        eventBus,
        recordingsDir: '/tmp/vms_test_recordings',
        statfsFn: async () => ({ bsize, blocks: simulatedBlocks, bfree: simulatedBfree }),
        canaryWriteFn: async () => ({ latencyMs: 1500 }), // > 1000ms
      });

      const metrics = await degradedController.getStorageMetrics();
      expect(metrics.healthStatus).toBe('WRITE_DEGRADED');
      expect(metrics.canaryLatencyMs).toBe(1500);

      expect(emitted).not.toBeNull();
      expect(emitted.metadata.status).toBe('WRITE_DEGRADED');
    });

    it('transitions to WRITE_FAILED when canary probe throws I/O error', async () => {
      let emitted: any = null;
      eventBus.subscribe('storage.health_changed', (evt) => {
        emitted = evt;
      });

      const failedController = new StorageController({
        catalog,
        eventBus,
        recordingsDir: '/tmp/vms_test_recordings',
        statfsFn: async () => ({ bsize, blocks: simulatedBlocks, bfree: simulatedBfree }),
        canaryWriteFn: async () => {
          throw new Error('EROFS: read-only file system');
        },
      });

      const metrics = await failedController.getStorageMetrics();
      expect(metrics.healthStatus).toBe('WRITE_FAILED');
      expect(emitted.metadata.status).toBe('WRITE_FAILED');
    });

    it('transitions to CRITICAL when disk usage exceeds 90%', async () => {
      // 95% full (5% free)
      simulatedBfree = 1_250_000n;
      const metrics = await storageController.getStorageMetrics();
      expect(metrics.healthStatus).toBe('CRITICAL');
      expect(metrics.usedPercent).toBe(95);
    });
  });

  describe('Tiered Retention Policy (Continuous vs Event vs Incident vs Protected)', () => {
    it('purges continuous footage older than 7d while preserving event and incident footage', async () => {
      const now = Date.now();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000);
      const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000);

      // 1. Continuous recording from 10 days ago (should be purged)
      await repository.createRecording({
        cameraId: 'cam-1',
        mediaMtxPath: 'storage_cam',
        filePath: '/tmp/vms_test_recordings/rec_continuous_old.mp4',
        fileName: 'rec_continuous_old.mp4',
        startTime: tenDaysAgo,
        endTime: new Date(tenDaysAgo.getTime() + 60000),
        duration: 60,
        sizeBytes: 10_000_000,
        retentionTier: 'CONTINUOUS',
        status: 'AVAILABLE',
      });

      // 2. Event recording from 10 days ago (retained, eventRetentionDays is 15)
      await repository.createRecording({
        cameraId: 'cam-1',
        mediaMtxPath: 'storage_cam',
        filePath: '/tmp/vms_test_recordings/rec_event_10d.mp4',
        fileName: 'rec_event_10d.mp4',
        startTime: tenDaysAgo,
        endTime: new Date(tenDaysAgo.getTime() + 60000),
        duration: 60,
        sizeBytes: 10_000_000,
        retentionTier: 'EVENT',
        status: 'AVAILABLE',
      });

      // 3. Incident recording from 20 days ago (retained, incidentRetentionDays is 60)
      await repository.createRecording({
        cameraId: 'cam-1',
        mediaMtxPath: 'storage_cam',
        filePath: '/tmp/vms_test_recordings/rec_incident_20d.mp4',
        fileName: 'rec_incident_20d.mp4',
        startTime: twentyDaysAgo,
        endTime: new Date(twentyDaysAgo.getTime() + 60000),
        duration: 60,
        sizeBytes: 10_000_000,
        retentionTier: 'INCIDENT',
        status: 'AVAILABLE',
      });

      // 4. Protected recording from 20 days ago (retained indefinitely)
      await repository.createRecording({
        cameraId: 'cam-1',
        mediaMtxPath: 'storage_cam',
        filePath: '/tmp/vms_test_recordings/rec_protected_20d.mp4',
        fileName: 'rec_protected_20d.mp4',
        startTime: twentyDaysAgo,
        endTime: new Date(twentyDaysAgo.getTime() + 60000),
        duration: 60,
        sizeBytes: 10_000_000,
        retentionTier: 'CONTINUOUS',
        isProtected: true,
        status: 'AVAILABLE',
      });

      const res = await storageController.purgeRetention();
      expect(res.deletedSegmentsCount).toBe(1); // Only the 10-day continuous segment

      const remaining = await repository.queryRecordings({ cameraId: 'cam-1' });
      expect(remaining.length).toBe(3);
      expect(remaining.some((r) => r.fileName === 'rec_continuous_old.mp4')).toBe(false);
      expect(remaining.some((r) => r.fileName === 'rec_event_10d.mp4')).toBe(true);
      expect(remaining.some((r) => r.fileName === 'rec_incident_20d.mp4')).toBe(true);
      expect(remaining.some((r) => r.fileName === 'rec_protected_20d.mp4')).toBe(true);
    });
  });

  describe('Storage Pressure Policy for Protected Evidence (Rule 5)', () => {
    it('emits storage.protected_overflow when protected footage exceeds quota (25%)', async () => {
      let overflowEvent: any = null;
      eventBus.subscribe('storage.protected_overflow', (evt) => {
        overflowEvent = evt;
      });

      const pressureController = new StorageController({
        catalog,
        eventBus,
        recordingsDir: '/tmp/vms_test_recordings',
        maxProtectedThresholdPercent: 25,
        statfsFn: async () => ({ bsize, blocks: simulatedBlocks, bfree: simulatedBfree }),
        canaryWriteFn: async () => ({ latencyMs: 20 }),
        // 30 GB protected out of 100 GB => 30%
        getProtectedBytesFn: async () => 30_000_000_000,
      });

      const metrics = await pressureController.getStorageMetrics();
      expect(metrics.protectedPercent).toBeGreaterThanOrEqual(25);
      expect(overflowEvent).not.toBeNull();
      expect(overflowEvent.metadata.protectedPercent).toBeGreaterThanOrEqual(25);
    });

    it('emits storage.exhaustion_risk when disk is critical and only protected footage remains', async () => {
      let exhaustionEvent: any = null;
      eventBus.subscribe('storage.exhaustion_risk', (evt) => {
        exhaustionEvent = evt;
      });

      // 95% full
      simulatedBfree = 1_250_000n;

      // Seed only protected footage
      await repository.createRecording({
        cameraId: 'cam-1',
        mediaMtxPath: 'storage_cam',
        filePath: '/tmp/vms_test_recordings/protected_only.mp4',
        fileName: 'protected_only.mp4',
        startTime: new Date('2026-10-01T10:00:00Z'),
        endTime: new Date('2026-10-01T10:01:00Z'),
        duration: 60,
        sizeBytes: 50_000_000,
        retentionTier: 'PROTECTED',
        isProtected: true,
        status: 'AVAILABLE',
      });

      const res = await storageController.checkStorage();
      expect(res.status).toBe('critical');
      expect(res.deletedSegmentsCount).toBe(0); // Protected footage is not unlinked
      expect(res.protectedOverflow).toBe(true);

      expect(exhaustionEvent).not.toBeNull();
      expect(exhaustionEvent.metadata.usedPercent).toBe(95);
    });
  });
});
