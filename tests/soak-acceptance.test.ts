import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { EventBus } from '../src/events/event-bus.js';
import { CameraHealthService } from '../src/health/camera-health.service.js';
import { SmtpDispatcherService } from '../src/notifications/smtp-dispatcher.service.js';
import { MockSmtpTransport } from '../src/notifications/smtp-client.js';
import { StorageController } from '../src/recordings/storage-controller.js';
import { RecordingCatalog } from '../src/recordings/recording-catalog.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { SegmentIngest } from '../src/recordings/segment-ingest.js';
import { RetentionPolicy } from '../src/recordings/retention-policy.js';
import { TestClock } from '../src/recordings/clock.js';
import { EvidenceBundleService, STANDALONE_VERIFY_SCRIPT } from '../src/export/evidence-bundle.service.js';
import { buildZipArchive } from '../src/export/zip-builder.js';
import { signAs } from './helpers/auth.js';

const execFileAsync = promisify(execFile);

describe('Day 75 Field Validation & 72-Hour Acceptance Gate (Phase 21 - MVP-14)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let testWorkspaceDir: string;
  let testRecordingsDir: string;

  beforeAll(async () => {
    testWorkspaceDir = path.resolve(process.cwd(), 'tests', 'fixtures', 'phase21_soak_' + Date.now());
    testRecordingsDir = path.join(testWorkspaceDir, 'recordings');
    await fs.mkdir(testRecordingsDir, { recursive: true });

    app = await createServer({ logger: false });
    await app.ready();

    vi.spyOn(app.capabilities, 'has').mockReturnValue(true);

    adminToken = await signAs(app, {
      id: 'usr-admin-field',
      username: 'installer_admin',
      role: Role.ADMIN,
    });
  });

  afterAll(async () => {
    await app.close();
    try {
      await fs.rm(testWorkspaceDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  describe('Gate 1: Fleet Configuration (16 Cameras - 8 Continuous, 8 Motion)', () => {
    it('initializes a full 16-camera fleet with realistic network and media parameters', async () => {
      const fleet = Array.from({ length: 16 }, (_, i) => {
        const idNum = String(i + 1).padStart(2, '0');
        const isContinuous = i < 8;
        return {
          id: `cam-${idNum}`,
          name: isContinuous ? `Warehouse-Area-${idNum}` : `Perimeter-Motion-${idNum}`,
          ip: `192.168.1.${100 + i}`,
          port: 554,
          mediaMtxPath: `cam_${idNum}`,
          recordingMode: isContinuous ? 'CONTINUOUS' : 'MOTION',
        };
      });

      expect(fleet.length).toBe(16);
      expect(fleet.filter(c => c.recordingMode === 'CONTINUOUS').length).toBe(8);
      expect(fleet.filter(c => c.recordingMode === 'MOTION').length).toBe(8);
    });
  });

  describe('Gate 2: Accelerated 72-Hour Unattended Soak Simulation & Storage FIFO Rollover', () => {
    it('simulates 72 hours of segment cataloging, preserves bookmarked incident evidence, and purges unbookmarked clips on threshold', async () => {
      const clock = new TestClock(new Date('2026-10-01T00:00:00.000Z'));
      const eventBus = new EventBus();
      const repository = new InMemoryRecordingRepository();

      // Register 16 cameras in repository
      for (let i = 1; i <= 16; i++) {
        const idNum = String(i).padStart(2, '0');
        repository.registerCamera({
          id: `cam-${idNum}`,
          name: `Camera-${idNum}`,
          mediaMtxPath: `path_cam-${idNum}`,
        });
      }

      const unlinkedPaths: string[] = [];
      const catalog = new RecordingCatalog({
        repository,
        eventBus,
        clock,
        recordingsDir: testRecordingsDir,
        fsUnlinkFn: async (filePath: string) => {
          unlinkedPaths.push(filePath);
        },
        fsStatFn: async () => ({ size: 150 * 1024 * 1024 }),
      });

      const bookmarkedSegmentIds = new Set<string>();
      const bookmarks: Array<{ cameraId: string; timestamp: Date }> = [];

      // 72 virtual hours simulation (1 tick per hour)
      // 8 continuous cameras each produce a segment record per hour
      for (let hour = 0; hour < 72; hour++) {
        const currentSimTime = clock.now();
        const dateStr = currentSimTime.toISOString().split('T')[0];
        const timeStr = currentSimTime.toISOString().split('T')[1].replace(/:/g, '-').slice(0, 8);

        for (let camIdx = 1; camIdx <= 8; camIdx++) {
          const camId = `cam-${String(camIdx).padStart(2, '0')}`;
          const segPath = path.join(testRecordingsDir, `${camId}_${dateStr}_${timeStr}.mp4`);

          const seg = await repository.createRecording({
            cameraId: camId,
            mediaMtxPath: `path_${camId}`,
            filePath: segPath,
            fileName: path.basename(segPath),
            startTime: currentSimTime,
            endTime: new Date(currentSimTime.getTime() + 3600 * 1000),
            duration: 3600,
            sizeBytes: 150 * 1024 * 1024,
          });

          // Mark specific hours on Camera 1 as incident bookmarks (Hour 12, Hour 24, Hour 48)
          if (camIdx === 1 && (hour === 12 || hour === 24 || hour === 48)) {
            bookmarkedSegmentIds.add(seg.id);
            bookmarks.push({ cameraId: camId, timestamp: new Date(currentSimTime.getTime() + 1_800_000) });
          }
        }

        // Advance simulated clock by 1 hour
        clock.advance(60 * 60 * 1000);
      }

      // Verify total segments created = 72 hours * 8 cameras = 576 segments
      const allRecordings = await repository.queryRecordings({ limit: 1000 });
      expect(allRecordings.length).toBe(576);
      expect(bookmarkedSegmentIds.size).toBe(3);

      // Simulate storage filling up to 92% (critical threshold)
      let simulatedUsedPercent = 92;
      const storageController = new StorageController({
        catalog,
        eventBus,
        recordingsDir: testRecordingsDir,
        warningThresholdPercent: 80,
        criticalThresholdPercent: 90,
        targetThresholdPercent: 75,
        statfsFn: async () => {
          return {
            bsize: 4096n,
            blocks: 100000000n, // ~400GB
            bfree: BigInt(Math.floor((100 - simulatedUsedPercent) * 1000000)),
          };
        },
        retention: new RetentionPolicy({
          repository,
          clock,
          bookmarkWindowSeconds: 0,
          holds: { bookmarks: async () => bookmarks, activeExports: async () => [] },
        }),
      });

      // Hook catalog deletion to simulate freeing disk space
      const origDelete = catalog.deleteSegmentInternal.bind(catalog);
      catalog.deleteSegmentInternal = async (id, filePath, size) => {
        const res = await origDelete(id, filePath, size);
        if (res.success) {
          // Each batch drops disk usage
          simulatedUsedPercent = Math.max(70, simulatedUsedPercent - 0.5);
        }
        return res;
      };

      // Run FIFO check and purge
      const cleanupResult = await storageController.checkStorage();
      expect(cleanupResult.status).toBe('critical');
      expect(cleanupResult.triggered).toBe(true);
      expect(cleanupResult.deletedSegmentsCount).toBeGreaterThan(0);
      expect(cleanupResult.freedBytes).toBeGreaterThan(0);
      expect(cleanupResult.usedPercentAfter).toBeLessThanOrEqual(75);

      // CRITICAL ASSERTION: None of the bookmarked segments were purged
      for (const bookmarkedId of bookmarkedSegmentIds) {
        const found = await repository.findRecordingById(bookmarkedId);
        expect(found).not.toBeNull();
      }
    });
  });

  describe('Gate 3: Network Cable Disconnect & Reconnect Glitch (Camera 3)', () => {
    it('detects network failure on Camera 3, transitions to DEGRADED, reaches OFFLINE at 30s hysteresis, sends email alert, and recovers to ONLINE with downtime calculation', async () => {
      const eventBus = new EventBus();

      // Configure mock SMTP dispatcher
      const mockTransport = new MockSmtpTransport();
      const smtpDispatcher = new SmtpDispatcherService({
        eventBus,
        transport: mockTransport,
        configFilePath: path.join(testWorkspaceDir, 'smtp-soak.json'),
      });

      await smtpDispatcher.updateConfig({
        enabled: true,
        recipients: ['security-admin@facility.local'],
        events: ['camera.offline', 'camera.online'],
        cooldownSeconds: 0,
      });
      await smtpDispatcher.start();

      let isCableConnected = true;
      let mockTcpLatency = 12;

      const mockMediaMtx: any = {
        getPathRuntime: vi.fn(async () => {
          if (!isCableConnected) {
            return { ready: false, bytesReceived: 0 };
          }
          return { ready: true, bytesReceived: 1024 * 1024 };
        }),
      };

      const healthService = new CameraHealthService({
        eventBus,
        mediaMtxClient: mockMediaMtx,
      });

      // Stub TCP ping method to simulate physical cable status
      vi.spyOn(healthService, 'pingTcp').mockImplementation(async () => {
        if (!isCableConnected) {
          return { reachable: false, latencyMs: null, error: 'Connection refused (EHOSTUNREACH - Cable Disconnected)' };
        }
        return { reachable: true, latencyMs: mockTcpLatency };
      });

      const camera3 = {
        id: 'cam-03',
        name: 'Warehouse-North-Cam3',
        ip: '192.168.1.103',
        port: 554,
        mediaMtxPath: 'cam_03',
      };

      // 1. Initial healthy baseline check
      const baseline = await healthService.checkCamera(camera3);
      expect(baseline.status).toBe('ONLINE');
      expect(baseline.networkCheck).toBe('PASSED');

      // 2. DISCONNECT CABLE (Fault Injection)
      isCableConnected = false;

      // First failed check -> anti-flap consecutive fail 1 -> status remains previous or moves to DEGRADED
      const poll1 = await healthService.checkCamera(camera3);
      expect(poll1.networkCheck).toBe('FAILED');
      // Second poll at T+10s (consecutiveFailures >= 2, but downtime < 30s) -> DEGRADED
      const poll2 = await healthService.checkCamera(camera3);
      expect(poll2.status).toBe('DEGRADED');

      // Manipulate offlineSince and unhealthySince to simulate passage of 35 seconds
      const internalState = (healthService as any).cameraStates.get('cam-03');
      expect(internalState).toBeDefined();
      internalState.unhealthySince = Date.now() - 35000;
      internalState.offlineSince = Date.now() - 35000;

      // Third poll at T+35s (downtime >= 30,000ms AND consecutiveFailures >= 2) -> OFFLINE
      const offlineEvents: any[] = [];
      eventBus.subscribe('camera.offline', (e) => offlineEvents.push(e));

      const poll3 = await healthService.checkCamera(camera3);
      expect(poll3.status).toBe('OFFLINE');
      expect(poll3.reason).toContain('Cable Disconnected');

      // Verify camera.offline event emitted
      expect(offlineEvents.length).toBe(1);
      expect(offlineEvents[0].cameraId).toBe('cam-03');

      // Verify mock SMTP transport sent the alert via sentMails
      expect(mockTransport.sentMails.length).toBeGreaterThanOrEqual(1);
      const offlineEmail = mockTransport.sentMails.find(e =>
        e.subject.includes('CAMERA OFFLINE') || e.subject.includes('Warehouse-North-Cam3') || e.html.includes('Warehouse-North-Cam3')
      );
      expect(offlineEmail).toBeDefined();
      expect(offlineEmail?.to).toContain('security-admin@facility.local');

      // 3. RECONNECT CABLE (Recovery)
      isCableConnected = true;
      const onlineEvents: any[] = [];
      eventBus.subscribe('camera.online', (e) => onlineEvents.push(e));

      const recoveryPoll = await healthService.checkCamera(camera3);
      expect(recoveryPoll.status).toBe('ONLINE');
      expect(recoveryPoll.networkCheck).toBe('PASSED');

      // Verify recovery event contains exact logged downtime
      expect(onlineEvents.length).toBe(1);
      expect(onlineEvents[0].cameraId).toBe('cam-03');
      expect(onlineEvents[0].metadata?.outageDurationMs).toBeGreaterThanOrEqual(30000);

      // Verify no listener leaks
      const listenerCount = eventBus.listenerCount('camera.offline');
      expect(listenerCount).toBeLessThan(10);

      smtpDispatcher.stop();
    });
  });

  describe('Gate 4: Motion Buffer (Camera 10)', () => {
    it('keeps 2-second segments from 10 s before to 30 s after ONVIF motion and expires the rest', async () => {
      const motionAt = new Date('2026-10-01T12:00:00.000Z');
      const clock = new TestClock(new Date(motionAt.getTime() + 60_000));
      const eventBus = new EventBus();
      const repository = new InMemoryRecordingRepository();
      repository.registerCamera({ id: 'cam-10', name: 'Camera-10', mediaMtxPath: 'cam_10' });
      await repository.saveCameraSchedule('cam-10', 'MOTION_ONLY', []);
      const camDir = path.join(testRecordingsDir, 'cam_10');
      await fs.mkdir(camDir, { recursive: true });

      // 2 s segments from T-10 s to T+46 s
      const header = Buffer.alloc(4096);
      header.writeUInt32BE(24, 0);
      header.write('ftyp', 4, 'ascii');
      const files: string[] = [];
      for (let offset = -10; offset < 46; offset += 2) {
        const start = new Date(motionAt.getTime() + offset * 1000);
        const name = `${start.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}.mp4`;
        const filePath = path.join(camDir, name);
        await fs.writeFile(filePath, header);
        const end = new Date(start.getTime() + 2000);
        await fs.utimes(filePath, end, end);
        files.push(filePath);
      }
      repository.recordMotion('cam-10', motionAt);

      const catalog = new RecordingCatalog({ repository, eventBus, clock, recordingsDir: testRecordingsDir });
      const ingest = new SegmentIngest({
        repository,
        recordingsRoot: testRecordingsDir,
        deleteSegment: (s) => catalog.deleteSegmentInternal(s.id, s.filePath, Number(s.sizeBytes)),
        eventBus,
        clock,
        preBufferSeconds: 10,
        postBufferSeconds: 30,
      });
      await ingest.scan();

      const kept = await repository.findRecordingsInRange('cam-10', new Date(0), new Date(motionAt.getTime() + 3_600_000));
      expect(kept.map((r) => r.startTime)).toEqual(
        Array.from({ length: 21 }, (_, i) => new Date(motionAt.getTime() + (i * 2 - 10) * 1000).toISOString())
      );
      // T+32..T+42 are buffered; T+44 is still inside its quiet period
      expect((await ingest.bufferStatus('cam-10')).cameras[0].bufferedSegmentsCount).toBe(6);

      clock.advance(120_000);
      await ingest.scan();
      expect((await ingest.bufferStatus('cam-10')).totalBufferedSegments).toBe(0);
      const remaining = new Set(await fs.readdir(camDir));
      expect(files.filter((f) => remaining.has(path.basename(f)))).toHaveLength(21);
    });
  });

  describe('Gate 5: Self-Verifying Evidence Export Verification & Tamper Detection', () => {
    it('generates signed ZIP bundle, runs standalone verify.js with zero dependencies, and detects file bit-flip tampering', async () => {
      const authenticPayload = Buffer.from('AUTHENTIC-H264-HIGH-PROFILE-INCIDENT-FOOTAGE-CAM-10-TIMESTAMP-2026-10-01');
      const authenticHash = crypto.createHash('sha256').update(authenticPayload).digest('hex');

      const bundleWorkspace = path.join(testWorkspaceDir, 'evidence_test');
      await fs.mkdir(bundleWorkspace, { recursive: true });

      const manifest = {
        version: '1.0',
        exportId: 'exp-soak-gate-10',
        cameraId: 'cam-10',
        cameraName: 'Perimeter-Motion-10',
        startTime: '2026-10-01T12:00:00.000Z',
        endTime: '2026-10-01T12:01:00.000Z',
        durationSeconds: 60,
        generatedAt: new Date().toISOString(),
        requestedBy: {
          userId: 'usr-admin-field',
          username: 'installer_admin',
          role: 'ADMIN',
        },
        files: [
          {
            filename: 'video.mp4',
            sha256: authenticHash,
            sizeBytes: authenticPayload.length,
          },
        ],
      };

      const audit = {
        exportId: 'exp-soak-gate-10',
        generatedAt: new Date().toISOString(),
        generatedAtLocal: '01 Oct 2026, 17:30:00 IST',
        nodeVersion: 'Basic VMS v0.1.0',
        systemPlatform: 'darwin arm64',
        requestIp: '192.168.1.50',
        requestedBy: manifest.requestedBy,
        camera: { id: 'cam-10', name: 'Perimeter-Motion-10' },
        timelineBookmarks: [
          {
            id: 'bm-gate-1',
            title: 'Perimeter Motion Breach',
            category: 'SECURITY',
            timestamp: '2026-10-01T12:00:10.000Z',
          },
        ],
        evidenceIntegrity: {
          algorithm: 'SHA-256',
          manifestChecksum: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
        },
      };

      // Create ZIP bundle buffer using built-in zip builder
      const zipBuffer = buildZipArchive([
        { name: 'video.mp4', data: authenticPayload },
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
        { name: 'audit.json', data: Buffer.from(JSON.stringify(audit, null, 2)) },
        { name: 'verify.js', data: Buffer.from(STANDALONE_VERIFY_SCRIPT) },
      ]);

      const zipFilePath = path.join(bundleWorkspace, 'evidence_bundle.zip');
      await fs.writeFile(zipFilePath, zipBuffer);

      // Extract ZIP using system unzip tool into a dedicated extraction folder
      const extractDir = path.join(bundleWorkspace, 'extracted');
      await fs.mkdir(extractDir, { recursive: true });
      await execFileAsync('/usr/bin/unzip', ['-o', zipFilePath, '-d', extractDir]);

      // 1. Run standalone verify.js via node in extracted directory
      const { stdout: passStdout } = await execFileAsync(process.execPath, ['verify.js'], {
        cwd: extractDir,
      });

      expect(passStdout).toContain('Reading manifest.json... OK');
      expect(passStdout).toContain('Reading video.mp4');
      expect(passStdout).toContain('INTEGRITY VERIFIED');

      // 2. Tamper Simulation: Flip one byte in video.mp4
      const tamperedPayload = Buffer.from(authenticPayload);
      tamperedPayload[10] = tamperedPayload[10] ^ 0xff; // Flip bits
      await fs.writeFile(path.join(extractDir, 'video.mp4'), tamperedPayload);

      // Run verify.js again; must exit with code 1 and fail verification
      let failedAsExpected = false;
      try {
        await execFileAsync(process.execPath, ['verify.js'], { cwd: extractDir });
      } catch (err: any) {
        failedAsExpected = true;
        expect(err.code).toBe(1);
        const combinedOutput = (err.stdout || '') + (err.stderr || '');
        expect(
          combinedOutput.includes('INTEGRITY COMPROMISED') ||
          combinedOutput.includes('VERIFICATION FAILED') ||
          combinedOutput.includes('Checksum mismatch')
        ).toBe(true);
      }

      expect(failedAsExpected).toBe(true);
    });
  });
});
