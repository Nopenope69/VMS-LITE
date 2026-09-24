import { z } from 'zod';

export const SegmentCompleteWebhookSchema = z
  .object({
    // Allow either path (standard MediaMTX) or mediaMtxPath
    path: z.string().optional(),
    mediaMtxPath: z.string().optional(),
    segmentPath: z
      .string()
      .min(1, 'segmentPath is required')
      .refine((val) => !val.includes('..') && !val.includes('\0'), {
        message: 'Directory traversal and null bytes are forbidden (T-03-01)',
      }),
    duration: z.coerce.number().positive('Duration must be positive'),
    size: z.coerce.number().optional(),
    startTime: z.string().optional(),
  })
  .transform((data) => {
    const mediaMtxPath = data.mediaMtxPath || data.path;
    if (!mediaMtxPath) {
      throw new Error('mediaMtxPath or path is required');
    }
    return {
      mediaMtxPath,
      segmentPath: data.segmentPath,
      duration: data.duration,
      size: data.size,
      startTime: data.startTime,
    };
  });

export type SegmentCompleteWebhookPayload = {
  mediaMtxPath: string;
  segmentPath: string;
  duration: number;
  size?: number;
  startTime?: string;
};

export const RecordingQuerySchema = z.object({
  cameraId: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export type RecordingQueryParams = z.input<typeof RecordingQuerySchema>;

export interface RecordingDto {
  id: string;
  cameraId: string;
  mediaMtxPath: string;
  filePath: string;
  fileName: string;
  startTime: string;
  endTime: string;
  duration: number;
  sizeBytes: number;
  format: string;
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

export type RecordingMode = 'CONTINUOUS' | 'SCHEDULED' | 'MANUAL_OFF';

export const SetCameraScheduleSchema = z.object({
  mode: z.enum(['CONTINUOUS', 'SCHEDULED', 'MANUAL_OFF']).default('SCHEDULED'),
  windows: z.array(ScheduleWindowSchema).default([]),
});

export type SetCameraScheduleInput = z.infer<typeof SetCameraScheduleSchema>;

export interface CameraScheduleConfig {
  mode: RecordingMode;
  windows: ScheduleWindow[];
}

export interface StorageMetricsDto {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  mountPath: string;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
}

export interface StorageCleanupResult {
  status: 'ok' | 'warning' | 'critical';
  triggered: boolean;
  usedPercentBefore: number;
  usedPercentAfter: number;
  deletedSegmentsCount: number;
  freedBytes: number;
  metrics?: StorageMetricsDto;
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
  ingestSegment(payload: SegmentCompleteWebhookPayload): Promise<RecordingDto>;
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
