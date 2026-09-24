import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordingScheduler } from '../src/recordings/recording-scheduler.service.js';
import { EventBus } from '../src/events/event-bus.js';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';

describe('RecordingScheduler (REC-02)', () => {
  let scheduler: RecordingScheduler;
  let mockMediaMtx: MediaMtxClient;
  let mockEventBus: EventBus;
  let patchPathMock: any;

  beforeEach(() => {
    patchPathMock = vi.fn().mockResolvedValue(true);
    mockMediaMtx = {
      patchPath: patchPathMock,
    } as unknown as MediaMtxClient;

    mockEventBus = new EventBus();
    scheduler = new RecordingScheduler({
      mediaMtx: mockMediaMtx,
      eventBus: mockEventBus,
      prisma: {} as any, // fallback to memory in tests
    });
  });

  describe('isCameraActiveAt evaluation', () => {
    it('always returns true for CONTINUOUS recording mode', () => {
      const config = { mode: 'CONTINUOUS' as const, windows: [] };
      const date = new Date('2026-09-24T14:30:00Z');
      expect(scheduler.isCameraActiveAt(config, date)).toBe(true);
    });

    it('always returns false for MANUAL_OFF recording mode', () => {
      const config = { mode: 'MANUAL_OFF' as const, windows: [] };
      const date = new Date('2026-09-24T14:30:00Z');
      expect(scheduler.isCameraActiveAt(config, date)).toBe(false);
    });

    it('evaluates scheduled daytime window correctly', () => {
      // Thursday = day 4 (2026-09-24 is a Thursday in UTC)
      // Window: Thursday 09:00 to 18:00
      const config = {
        mode: 'SCHEDULED' as const,
        windows: [
          { dayOfWeek: 4, startHour: 9, startMin: 0, endHour: 18, endMin: 0 },
        ],
      };

      // Construct dates with local hours/minutes matching test machine
      const activeDate = new Date();
      activeDate.setHours(10, 30, 0, 0);
      const activeDay = activeDate.getDay();
      config.windows[0].dayOfWeek = activeDay;

      expect(scheduler.isCameraActiveAt(config, activeDate)).toBe(true);

      const inactiveDate = new Date();
      inactiveDate.setHours(19, 0, 0, 0);
      expect(scheduler.isCameraActiveAt(config, inactiveDate)).toBe(false);

      const earlyDate = new Date();
      earlyDate.setHours(8, 59, 0, 0);
      expect(scheduler.isCameraActiveAt(config, earlyDate)).toBe(false);
    });

    it('evaluates overnight window spanning midnight correctly', () => {
      const config = {
        mode: 'SCHEDULED' as const,
        windows: [
          { dayOfWeek: 1, startHour: 22, startMin: 0, endHour: 6, endMin: 0 },
        ],
      };

      const dateNight = new Date();
      dateNight.setHours(23, 0, 0, 0);
      config.windows[0].dayOfWeek = dateNight.getDay();
      expect(scheduler.isCameraActiveAt(config, dateNight)).toBe(true);

      const dateMorning = new Date();
      dateMorning.setHours(5, 30, 0, 0);
      expect(scheduler.isCameraActiveAt(config, dateMorning)).toBe(true);

      const dateNoon = new Date();
      dateNoon.setHours(14, 0, 0, 0);
      expect(scheduler.isCameraActiveAt(config, dateNoon)).toBe(false);
    });
  });

  describe('evaluateCamera and MediaMTX patching', () => {
    it('patches MediaMTX record: true and emits recording.started when activating', async () => {
      let emittedEvent: any = null;
      mockEventBus.subscribe('recording.started', (evt) => {
        emittedEvent = evt;
      });

      const camera = { id: 'cam-1', mediaMtxPath: 'cam_gate_1', name: 'Gate 1' };
      // Default schedule is CONTINUOUS
      const active = await scheduler.evaluateCamera(camera);

      expect(active).toBe(true);
      expect(patchPathMock).toHaveBeenCalledWith('cam_gate_1', { record: true });
      expect(scheduler.isRecording('cam-1')).toBe(true);
      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent.type).toBe('recording.started');
      expect(emittedEvent.cameraId).toBe('cam-1');
      expect(emittedEvent.metadata.mediaMtxPath).toBe('cam_gate_1');
    });

    it('does not re-patch MediaMTX or re-emit event if recording state is unchanged', async () => {
      const camera = { id: 'cam-1', mediaMtxPath: 'cam_gate_1' };
      await scheduler.evaluateCamera(camera);
      expect(patchPathMock).toHaveBeenCalledTimes(1);

      // Evaluate again in same state
      await scheduler.evaluateCamera(camera);
      expect(patchPathMock).toHaveBeenCalledTimes(1);
    });

    it('patches MediaMTX record: false and emits recording.stopped when deactivated', async () => {
      let stoppedEvent: any = null;
      mockEventBus.subscribe('recording.stopped', (evt) => {
        stoppedEvent = evt;
      });

      const camera = { id: 'cam-2', mediaMtxPath: 'cam_gate_2' };
      // First activate
      await scheduler.setCameraSchedule('cam-2', 'CONTINUOUS', [], 'cam_gate_2');
      await scheduler.evaluateCamera(camera);
      expect(scheduler.isRecording('cam-2')).toBe(true);

      // Now switch to MANUAL_OFF
      await scheduler.setCameraSchedule('cam-2', 'MANUAL_OFF', [], 'cam_gate_2');
      const active = await scheduler.evaluateCamera(camera);

      expect(active).toBe(false);
      expect(patchPathMock).toHaveBeenCalledWith('cam_gate_2', { record: false });
      expect(scheduler.isRecording('cam-2')).toBe(false);
      expect(stoppedEvent).not.toBeNull();
      expect(stoppedEvent.type).toBe('recording.stopped');
      expect(stoppedEvent.cameraId).toBe('cam-2');
    });
  });
});
