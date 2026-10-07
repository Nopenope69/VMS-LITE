import { z } from 'zod';

export const RecordingQuerySchema = z.object({
  cameraId: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export type RecordingQueryParams = z.input<typeof RecordingQuerySchema> & {
  /** Only these cameras (a user's Camera Scope); undefined = every camera */
  cameraIds?: string[];
};

export type SegmentStatusType =
  | 'DISCOVERED'
  | 'VALIDATING'
  | 'AVAILABLE'
  | 'BUFFERED'
  | 'QUARANTINED'
  | 'DELETE_PENDING'
  | 'GARBAGE'
  | 'MISSING'
  | 'EXPIRED'
  | 'DELETED';
export type RetentionTierType = 'CONTINUOUS' | 'EVENT' | 'INCIDENT' | 'PROTECTED';
export type StreamRoleType = 'PRIMARY' | 'SUB';

export interface RecordingDto {
  id: string;
  cameraId: string;
  mediaMtxPath: string;
  streamRole?: StreamRoleType;
  filePath: string;
  fileName: string;
  startTime: string;
  endTime: string;
  duration: number;
  sizeBytes: number;
  format: string;
  videoCodec?: string;
  hasAudio?: boolean;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  status?: SegmentStatusType;
  retentionTier?: RetentionTierType;
  isProtected?: boolean;
  protectionReason?: string | null;
  errorReason?: string | null;
  sha256?: string | null;
  validatedAt?: string | null;
  storageProvider?: string;
  storageKey?: string | null;
  createdAt: string;
}

export const ScheduleWindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startHour: z.number().int().min(0).max(23),
  startMin: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMin: z.number().int().min(0).max(59),
});

export type ScheduleWindow = z.infer<typeof ScheduleWindowSchema>;

export type RecordingMode = 'CONTINUOUS' | 'MOTION_ONLY' | 'SCHEDULED' | 'MANUAL_OFF';

export const SetCameraScheduleSchema = z.object({
  mode: z.enum(['CONTINUOUS', 'MOTION_ONLY', 'SCHEDULED', 'MANUAL_OFF']).default('SCHEDULED'),
  windows: z.array(ScheduleWindowSchema).default([]),
});

export type SetCameraScheduleInput = z.infer<typeof SetCameraScheduleSchema>;

export interface CameraScheduleConfig {
  mode: RecordingMode;
  windows: ScheduleWindow[];
}

export type StorageHealthStatus =
  | 'HEALTHY'
  | 'WARNING'
  | 'CRITICAL'
  | 'WRITE_DEGRADED'
  | 'WRITE_FAILED'
  | 'MOUNT_MISSING'
  | 'RECONCILIATION_ERROR';

export interface StorageMetricsDto {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  mountPath: string;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  healthStatus?: StorageHealthStatus;
  canaryLatencyMs?: number | null;
  protectedBytes?: number;
  protectedPercent?: number;
  maxProtectedThresholdPercent?: number;
  continuousRetentionDays?: number;
  eventRetentionDays?: number;
  incidentRetentionDays?: number;
}

export interface StorageCleanupResult {
  status: 'ok' | 'warning' | 'critical' | 'write_degraded' | 'write_failed' | 'mount_missing';
  triggered: boolean;
  usedPercentBefore: number;
  usedPercentAfter: number;
  deletedSegmentsCount: number;
  freedBytes: number;
  metrics?: StorageMetricsDto;
  protectedOverflow?: boolean;
}

export const TimelineQuerySchema = z
  .object({
    cameraId: z.string().min(1, 'cameraId is required'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.date) return true;
      return Boolean(data.startTime && data.endTime);
    },
    { message: 'Must provide either date or both startTime and endTime' }
  )
  .refine(
    (data) => {
      if (data.startTime && data.endTime) {
        const start = new Date(data.startTime).getTime();
        const end = new Date(data.endTime).getTime();
        if (end < start) {
          return false;
        }
        // Max 24 hours per query (T-05-03)
        const diffMs = end - start;
        return diffMs <= 24 * 60 * 60 * 1000;
      }
      return true;
    },
    {
      message: 'Time window must be valid and cannot exceed 24 hours (T-05-03)',
      path: ['endTime'],
    }
  );

export type TimelineQueryParams = z.infer<typeof TimelineQuerySchema>;

export interface TimelineSpanDto {
  recordingId: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

export interface TimelineResponseDto {
  cameraId: string;
  date: string;
  playbackBaseUrl: string;
  totalDurationSeconds: number;
  spans: TimelineSpanDto[];
}

export interface PlaybackStreamUrlDto {
  cameraId: string;
  mediaMtxPath: string;
  fmp4StreamUrl: string;
  startTime: string;
  duration: number;
}

export interface IRecordingEngine {
  queryRecordings(params?: RecordingQueryParams): Promise<RecordingDto[]>;
  getRecordingById(id: string): Promise<RecordingDto | null>;
  getSchedule(cameraId: string): Promise<CameraScheduleConfig>;
  setSchedule(cameraId: string, mode?: RecordingMode, windows?: ScheduleWindow[]): Promise<CameraScheduleConfig>;
  getTimelineSpans(params: TimelineQueryParams): Promise<TimelineResponseDto>;
  getPlaybackStreamUrl(cameraId: string, startTime: string, durationSeconds?: number): Promise<PlaybackStreamUrlDto>;
  getStorageStatus(): Promise<StorageMetricsDto>;
  runStorageCleanup(): Promise<StorageCleanupResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface SegmentCreatedEventMetadata {
  recordingId: string;
  cameraId: string;
  siteId?: string | null;
  mediaMtxPath: string;
  filePath: string;
  storageUri: string;
  duration: number;
  sizeBytes: number;
  startTime: Date | string;
  endTime: Date | string;
  format: string;
}
