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

export interface IRecordingEngine {
  ingestSegment(payload: SegmentCompleteWebhookPayload): Promise<RecordingDto>;
  queryRecordings(params?: RecordingQueryParams): Promise<RecordingDto[]>;
  getRecordingById(id: string): Promise<RecordingDto | null>;
  getSchedule(cameraId: string): Promise<CameraScheduleConfig>;
  setSchedule(cameraId: string, mode?: RecordingMode, windows?: ScheduleWindow[]): Promise<CameraScheduleConfig>;
  getStorageStatus(): Promise<StorageMetricsDto>;
  runStorageCleanup(): Promise<StorageCleanupResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
