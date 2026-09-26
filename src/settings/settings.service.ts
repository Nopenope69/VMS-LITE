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

export interface SettingsServiceDependencies {
  prisma?: PrismaClient;
}

export class SettingsService {
  private readonly prisma: PrismaClient;

  // Active operational settings state
  private operationalSettings: OperationalSettings = {
    recordingMode: 'CONTINUOUS',
    retentionDays: 15,
    warningThresholdPercent: 80,
    criticalThresholdPercent: 90,
    weeklySchedule: gridToWindows(SCHEDULE_PRESETS.ALL_HOURS()),
  };

  constructor(deps: SettingsServiceDependencies = {}) {
    this.prisma = deps.prisma || defaultPrisma;

    // Attach bookmark preservation checker to StorageController
    const storageController = recordingEngine.getStorageController();
    storageController.setBookmarkChecker(async (segment) => {
      return this.isSegmentBookmarked(segment);
    });
    storageController.setRetentionDays(this.operationalSettings.retentionDays);
    storageController.setThresholds(
      this.operationalSettings.warningThresholdPercent,
      this.operationalSettings.criticalThresholdPercent
    );
  }

  /**
   * Checks whether a recording segment contains or overlaps any timeline bookmarks.
   */
  async isSegmentBookmarked(segment: {
    cameraId: string;
    startTime: string | Date;
    endTime: string | Date;
  }): Promise<boolean> {
    try {
      const count = await this.prisma.bookmark.count({
        where: {
          cameraId: segment.cameraId,
          timestamp: {
            gte: new Date(segment.startTime),
            lte: new Date(segment.endTime),
          },
        },
      });
      return count > 0;
    } catch {
      return false;
    }
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

    return {
      settings: { ...this.operationalSettings },
      grid: windowsToGrid(this.operationalSettings.weeklySchedule),
      storage: {
        ...storageMetrics,
        retentionDays: this.operationalSettings.retentionDays,
        estimatedDaysRemaining,
      },
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
    this.operationalSettings = {
      ...this.operationalSettings,
      ...input,
    };

    const storage = recordingEngine.getStorageController();
    if (input.retentionDays !== undefined) {
      storage.setRetentionDays(input.retentionDays);
    }
    if (
      input.warningThresholdPercent !== undefined ||
      input.criticalThresholdPercent !== undefined
    ) {
      storage.setThresholds(
        this.operationalSettings.warningThresholdPercent,
        this.operationalSettings.criticalThresholdPercent
      );
    }

    return { ...this.operationalSettings };
  }

  /**
   * Retrieves camera-specific schedule or defaults to global operational schedule.
   */
  async getCameraSchedule(cameraId: string): Promise<CameraScheduleResponse> {
    const existing = await recordingEngine.getSchedule(cameraId);
    const windows =
      existing.windows.length > 0
        ? existing.windows
        : this.operationalSettings.weeklySchedule;
    const mode = existing.mode || this.operationalSettings.recordingMode;

    return {
      cameraId,
      mode,
      windows,
      grid: windowsToGrid(windows),
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
