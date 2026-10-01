import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate } from '../users/rbac.guard.js';
import { cameraHealthService } from '../health/camera-health.service.js';
import { recordingEngine } from '../recordings/recording-engine.js';
import { settingsService } from '../settings/settings.service.js';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { getNtpStatus } from './ntp.service.js';
import { storageTelemetryService } from './storage-telemetry.service.js';

const bootTimestamp = Date.now();

export const systemRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/system/dashboard
   * Returns aggregated operator landing dashboard overview (MVP-11)
   */
  app.get(
    '/dashboard',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const capabilities = request.server.capabilities;

        // 1. Camera Fleet Health
        const healthSummary = cameraHealthService.getAllTelemetry();
        let totalCamerasInDb = healthSummary.totalCameras;
        try {
          totalCamerasInDb = await defaultPrisma.camera.count();
        } catch {
          // Fallback to health summary total
        }

        const fleet = {
          total: totalCamerasInDb,
          online: healthSummary.onlineCount,
          degraded: healthSummary.degradedCount,
          offline: healthSummary.offlineCount,
          unknown: healthSummary.unknownCount,
        };

        // 2. Storage & Operational Settings
        const operational = await settingsService.getOperationalSettings(capabilities);
        const storageMetrics = operational.storage;

        // 3. Motion Ring Buffer & Recording Engine
        let motionBufferedSegments = 0;
        let activeIncidentsCount = 0;
        try {
          const ringBufferStatus = recordingEngine.getMotionRingBuffer().getBufferStatus();
          motionBufferedSegments = ringBufferStatus.totalBufferedSegments;
          activeIncidentsCount = ringBufferStatus.activeIncidentsCount;
        } catch {
          // Ignored
        }

        const recording = {
          total: totalCamerasInDb,
          mode: operational.settings.recordingMode,
          motionBufferedSegments,
          activeIncidentsCount,
        };

        // 4. Recent Events (last 10 within past 24 hours)
        let recentEvents: any[] = [];
        try {
          const events = await defaultPrisma.event.findMany({
            orderBy: { timestamp: 'desc' },
            take: 10,
          });
          recentEvents = events.map((e: any) => ({
            id: e.id,
            cameraId: e.cameraId,
            timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp),
            type: e.type,
            source: e.source,
            severity: e.severity,
            metadata: e.metadata,
          }));
        } catch {
          recentEvents = [];
        }

        // 5. System Uptime & Status Calculation
        const uptimeSeconds = Math.floor((Date.now() - bootTimestamp) / 1000);

        // 6. NTP Sync Status
        let ntpSync: { synchronized: boolean; available: boolean } = { synchronized: false, available: false };
        try {
          const ntpResult = await getNtpStatus();
          ntpSync = {
            available: ntpResult.available,
            synchronized: ntpResult.available ? ntpResult.synchronized : false,
          };
        } catch {
          // NTP status is non-critical for dashboard — default to unavailable
        }

        let status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
        if (
          fleet.offline > 0 ||
          storageMetrics.usedPercent >= storageMetrics.criticalThresholdPercent
        ) {
          status = 'CRITICAL';
        } else if (
          fleet.degraded > 0 ||
          storageMetrics.usedPercent >= storageMetrics.warningThresholdPercent
        ) {
          status = 'DEGRADED';
        }

        return reply.send({
          success: true,
          status,
          uptimeSeconds,
          fleet,
          recording,
          storage: {
            totalBytes: storageMetrics.totalBytes,
            usedBytes: storageMetrics.usedBytes,
            freeBytes: storageMetrics.freeBytes,
            usedPercent: storageMetrics.usedPercent,
            warningThresholdPercent: storageMetrics.warningThresholdPercent,
            criticalThresholdPercent: storageMetrics.criticalThresholdPercent,
            retentionDays: storageMetrics.retentionDays,
            estimatedDaysRemaining: storageMetrics.estimatedDaysRemaining ?? 30,
          },
          licensing: operational.licensing,
          recentEvents,
          ntpSync,
          drives: storageTelemetryService.getSummary(),
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: 'DashboardError',
          message: err.message || 'Failed to aggregate system dashboard metrics',
        });
      }
    }
  );

  /**
   * GET /api/system/ntp-status
   * Returns NTP time-sync status from the host OS
   */
  app.get(
    '/ntp-status',
    {
      preHandler: [authenticate],
    },
    async (_request, reply) => {
      try {
        const status = await getNtpStatus();
        return reply.send(status);
      } catch (err: any) {
        return reply.status(500).send({
          error: 'NtpStatusError',
          message: err.message || 'Failed to query NTP status',
        });
      }
    }
  );
};

export default systemRoutes;
