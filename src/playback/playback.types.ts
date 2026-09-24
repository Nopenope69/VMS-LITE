import { z } from 'zod';

export const TimelineQuerySchema = z
  .object({
    cameraId: z.string().min(1, 'cameraId is required'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
  })
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
