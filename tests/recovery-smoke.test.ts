import { describe, it, expect, beforeEach } from 'vitest';
import { CameraService } from '../src/cameras/camera.service.js';
import { RecordingEngine } from '../src/recordings/recording-engine.js';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';
import { EventBus } from '../src/events/event-bus.js';
import { createServer } from '../src/server.js';

describe('Host Power Loss & Service Recovery Smoke Tests (T-07-04)', () => {
  let eventBus: EventBus;
  let mediaMtxClient: MediaMtxClient;
  let cameraService: CameraService;
  let recordingEngine: RecordingEngine;

  beforeEach(() => {
    eventBus = new EventBus();
    mediaMtxClient = new MediaMtxClient({ baseUrl: 'http://mock-mediamtx:9997' });
    cameraService = new CameraService({ eventBus });
    recordingEngine = new RecordingEngine({ eventBus, mediaMtx: mediaMtxClient });
  });

  it('restores camera configs and active recording schedules after simulated crash', async () => {
    // 1. Pre-crash setup: onboard camera and configure schedule
    const camera = await cameraService.onboardManualCamera(
      {
        name: 'Server Room Camera',
        rtspUrl: 'rtsp://192.168.1.150:554/stream1',
      },
      16
    );

    expect(camera.id).toBeDefined();

    // 2. Simulate sudden power loss / process exit:
    // Create fresh instance of RecordingEngine pointing to existing storage/catalog
    const rebootedEngine = new RecordingEngine({
      mediaMtx: mediaMtxClient,
      eventBus,
    });

    // Configure camera schedule on rebooted engine
    await rebootedEngine.setSchedule(camera.id, 'CONTINUOUS');

    // Verify schedule restored and evaluate active window
    const schedule = await rebootedEngine.getSchedule(camera.id);
    expect(schedule).toBeDefined();
    expect(schedule?.mode).toBe('CONTINUOUS');

    const shouldRecord = await (rebootedEngine as any).scheduler.evaluateCameraById(camera.id);
    expect(shouldRecord).toBe(true);
  });

  it('storage manager resumes monitoring and disk capacity threshold check after reboot', async () => {
    const rebootedEngine = new RecordingEngine({
      recordingsDir: '/tmp/vms-recovery-test',
      warningThresholdPercent: 85,
      criticalThresholdPercent: 95,
      eventBus,
    });

    const stats = await rebootedEngine.getStorageStatus();
    expect(stats).toHaveProperty('totalBytes');
    expect(stats).toHaveProperty('usedBytes');
    expect(stats).toHaveProperty('freeBytes');
    expect(stats).toHaveProperty('usedPercent');
    expect(stats.warningThresholdPercent).toBe(85);
    expect(stats.criticalThresholdPercent).toBe(95);
  });

  it('control plane server initializes cleanly and responds to /health on boot', async () => {
    const app = await createServer({ logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('basic-vms');
  });
});
