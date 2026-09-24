import { z } from 'zod';

export const SegmentCompleteWebhookSchema = z.object({
  mediaMtxPath: z.string().min(1, 'mediaMtxPath is required'),
  segmentPath: z
    .string()
    .min(1, 'segmentPath is required')
    .refine((val) => !val.includes('..') && !val.includes('\0'), {
      message: 'Directory traversal and null bytes are forbidden (T-03-01)',
    }),
  duration: z.coerce.number().positive('Duration must be positive'),
});

export type SegmentCompleteWebhookPayload = z.infer<typeof SegmentCompleteWebhookSchema>;

export const RecordingQuerySchema = z.object({
  cameraId: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export type RecordingQueryParams = z.infer<typeof RecordingQuerySchema>;

export interface RecordingDto {
  id: string;
  cameraId: string;
  mediaMtxPath: string;
  filePath: string;
  fileName: string;
  startTime: string;
  endTime: string;
  duration: number;
  sizeBytes: number; // Safely converted from BigInt to number for JSON (T-03-03)
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

export const SetCameraScheduleSchema = z.object({
  mode: z.enum(['CONTINUOUS', 'SCHEDULED', 'MANUAL_OFF']).default('SCHEDULED'),
  windows: z.array(ScheduleWindowSchema).default([]),
});

export type SetCameraScheduleInput = z.infer<typeof SetCameraScheduleSchema>;

export interface StorageMetricsDto {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  mountPath: string;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
}
