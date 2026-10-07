import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { recordingEngine } from '../recordings/recording-engine.js';
import { ICapabilityRegistry } from '../licensing/types.js';
import {
  OperationalSettings,
  OperationalSettingsResponseDto,
  UpdateOperationalSettingsInput,
  CameraScheduleResponse,
  UpdateCameraScheduleInput,
  windowsToGrid,
  gridToWindows,
  SCHEDULE_PRESETS,
} from './settings.types.js';
import { SystemSettingsStore } from './system-settings.store.js';

const OPERATIONAL_SETTINGS_KEY = 'settings.operational';

export interface SettingsServiceDependencies {
  prisma?: PrismaClient;
}

export class SettingsService {
  private readonly prisma: PrismaClient;
  private readonly store: SystemSettingsStore;

  // Active operational settings state
  private operationalSettings: OperationalSettings = {
    recordingMode: 'CONTINUOUS',
    retentionDays: 15,
    warningThresholdPercent: 80,
    criticalThresholdPercent: 90,
    preBufferSeconds: 10,
    postBufferSeconds: 30,
    weeklySchedule: gridToWindows(SCHEDULE_PRESETS.ALL_HOURS()),
  };

  constructor(deps: SettingsServiceDependencies = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.store = new SystemSettingsStore(this.prisma);

    this.applyToEngine();
  }

  /**
   * Loads persisted operational settings (called at server start).
   */
  async load(): Promise<void> {
    try {
      const stored = await this.store.get<Partial<OperationalSettings>>(OPERATIONAL_SETTINGS_KEY, {});
      this.operationalSettings = { ...this.operationalSettings, ...stored };
    } catch (err) {
      console.warn('[Settings] Failed to load persisted operational settings:', (err as Error).message);
    }
    this.applyToEngine();
  }

  private applyToEngine(): void {
    const storage = recordingEngine.getStorageController();
    storage.setRetentionDays(this.operationalSettings.retentionDays);
    storage.setThresholds(
      this.operationalSettings.warningThresholdPercent,
      this.operationalSettings.criticalThresholdPercent
    );
    recordingEngine.setMotionWindow(this.operationalSettings.preBufferSeconds, this.operationalSettings.postBufferSeconds);
  }

  /**
   * Retrieves operational settings, storage metrics, and license overview.
   */
  async getOperationalSettings(
    capabilities: ICapabilityRegistry
  ): Promise<OperationalSettingsResponseDto> {
    const storageMetrics = await recordingEngine.getStorageStatus();

    // Approximate estimated days remaining based on camera count and average bitrate
    let activeCameraCount = 1;
    try {
      activeCameraCount = await this.prisma.camera.count();
      if (activeCameraCount === 0) activeCameraCount = 1;
    } catch {
      activeCameraCount = 1;
    }

    // Assumes 1080p stream at ~2 Mbps (approx 900 MB/hour/camera or ~21.6 GB/day/camera)
    const bytesPerDayPerCamera = 21.6 * 1024 * 1024 * 1024;
    const dailyIngestBytes = activeCameraCount * bytesPerDayPerCamera;
    const estimatedDaysRemaining =
      dailyIngestBytes > 0
        ? Math.max(1, Math.floor(storageMetrics.freeBytes / dailyIngestBytes))
        : 30;

    let motionBuffer: any = undefined;
    try {
      const status = await recordingEngine.getMotionBufferStatus();
      motionBuffer = {
        preBufferSeconds: this.operationalSettings.preBufferSeconds,
        postBufferSeconds: this.operationalSettings.postBufferSeconds,
        totalBufferedSegments: status.totalBufferedSegments,
        activeIncidentsCount: status.activeIncidentsCount,
      };
    } catch {
      // Ignored
    }

    return {
      settings: { ...this.operationalSettings },
      grid: windowsToGrid(this.operationalSettings.weeklySchedule),
      storage: {
        ...storageMetrics,
        retentionDays: this.operationalSettings.retentionDays,
        estimatedDaysRemaining,
      },
      motionBuffer,
      licensing: {
        edition: capabilities.getEdition(),
        cameraLimit: capabilities.getCameraLimit(),
        activeCapabilities: capabilities.getAllCapabilities(),
        isExpired: capabilities.isExpired(),
      },
    };
  }

  /**
   * Updates operational settings and syncs with StorageController & RecordingEngine.
   */
  async updateOperationalSettings(
    input: UpdateOperationalSettingsInput
  ): Promise<OperationalSettings> {
    const next = { ...this.operationalSettings, ...input };
    await this.store.set(OPERATIONAL_SETTINGS_KEY, next);
    this.operationalSettings = next;
    this.applyToEngine();
    return { ...this.operationalSettings };
  }

  /**
   * Retrieves camera-specific schedule or defaults to global operational schedule.
   */
  async getCameraSchedule(cameraId: string): Promise<CameraScheduleResponse> {
    // Report exactly what the scheduler applies for this camera
    const existing = await recordingEngine.getSchedule(cameraId);
    return {
      cameraId,
      mode: existing.mode,
      windows: existing.windows,
      grid: windowsToGrid(existing.windows),
    };
  }

  /**
   * Updates camera-specific schedule and mode.
   */
  async updateCameraSchedule(
    cameraId: string,
    input: UpdateCameraScheduleInput
  ): Promise<CameraScheduleResponse> {
    const updated = await recordingEngine.setSchedule(
      cameraId,
      input.mode,
      input.windows
    );

    return {
      cameraId,
      mode: updated.mode,
      windows: updated.windows,
      grid: windowsToGrid(updated.windows),
    };
  }

  /**
   * Runs storage cleanup honoring both retention days and FIFO quota thresholds.
   * Protects bookmarked segments.
   */
  async purgeStorage(overrideRetentionDays?: number): Promise<{
    retentionPurge: { deletedSegmentsCount: number; freedBytes: number };
    quotaCleanup: { triggered: boolean; deletedSegmentsCount: number; freedBytes: number };
    metricsAfter: any;
  }> {
    const days =
      overrideRetentionDays !== undefined
        ? overrideRetentionDays
        : this.operationalSettings.retentionDays;

    // 1. Purge by retention days cutoff
    const retentionPurge = await recordingEngine.purgeRetention(days);

    // 2. Check and purge by disk critical quota
    const quotaCleanup = await recordingEngine.runStorageCleanup();

    const metricsAfter = await recordingEngine.getStorageStatus();

    return {
      retentionPurge,
      quotaCleanup: {
        triggered: quotaCleanup.triggered,
        deletedSegmentsCount: quotaCleanup.deletedSegmentsCount,
        freedBytes: quotaCleanup.freedBytes,
      },
      metricsAfter,
    };
  }
}

export const settingsService = new SettingsService();
