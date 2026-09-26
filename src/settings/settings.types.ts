import { z } from 'zod';
import { RecordingMode, ScheduleWindow, ScheduleWindowSchema } from '../recordings/recording.types.js';

export const RecordingModeEnum = z.enum([
  'CONTINUOUS',
  'MOTION_ONLY',
  'SCHEDULED',
  'MANUAL_OFF',
]);

export const HourlyScheduleSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  active: z.boolean(),
});

export type HourlyScheduleSlot = z.infer<typeof HourlyScheduleSlotSchema>;

export const OperationalSettingsSchema = z.object({
  recordingMode: RecordingModeEnum.default('CONTINUOUS'),
  retentionDays: z.number().int().min(0).max(365).default(15),
  warningThresholdPercent: z.number().int().min(50).max(95).default(80),
  criticalThresholdPercent: z.number().int().min(60).max(99).default(90),
  preBufferSeconds: z.number().int().min(2).max(60).default(10),
  postBufferSeconds: z.number().int().min(5).max(300).default(30),
  weeklySchedule: z.array(ScheduleWindowSchema).default([]),
});

export type OperationalSettings = z.infer<typeof OperationalSettingsSchema>;

export const UpdateOperationalSettingsSchema = OperationalSettingsSchema.partial();
export type UpdateOperationalSettingsInput = z.infer<typeof UpdateOperationalSettingsSchema>;

export const UpdateCameraScheduleInputSchema = z.object({
  mode: RecordingModeEnum,
  windows: z.array(ScheduleWindowSchema).default([]),
});
export type UpdateCameraScheduleInput = z.infer<typeof UpdateCameraScheduleInputSchema>;

export interface CameraScheduleResponse {
  cameraId: string;
  mode: RecordingMode;
  windows: ScheduleWindow[];
  grid: boolean[][]; // 7 days x 24 hours
}

export interface OperationalSettingsResponseDto {
  settings: OperationalSettings;
  grid: boolean[][]; // 7 days x 24 hours representation of weeklySchedule
  storage: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    mountPath: string;
    warningThresholdPercent: number;
    criticalThresholdPercent: number;
    retentionDays: number;
    estimatedDaysRemaining?: number;
  };
  motionBuffer?: {
    preBufferSeconds: number;
    postBufferSeconds: number;
    totalBufferedSegments: number;
    activeIncidentsCount: number;
  };
  licensing: {
    edition: string;
    cameraLimit: number;
    activeCapabilities: string[];
    isExpired: boolean;
  };
}

/**
 * Converts a 7x24 boolean grid to consolidated ScheduleWindow[] spans.
 */
export function gridToWindows(grid: boolean[][]): ScheduleWindow[] {
  const windows: ScheduleWindow[] = [];

  for (let day = 0; day < 7; day++) {
    const dayRow = grid[day] || [];
    let windowStart: number | null = null;

    for (let hour = 0; hour < 24; hour++) {
      const active = Boolean(dayRow[hour]);
      if (active && windowStart === null) {
        windowStart = hour;
      } else if (!active && windowStart !== null) {
        windows.push({
          dayOfWeek: day,
          startHour: windowStart,
          startMin: 0,
          endHour: hour,
          endMin: 0,
        });
        windowStart = null;
      }
    }

    if (windowStart !== null) {
      windows.push({
        dayOfWeek: day,
        startHour: windowStart,
        startMin: 0,
        endHour: 23,
        endMin: 59,
      });
    }
  }

  return windows;
}

/**
 * Expands ScheduleWindow[] spans into a 7x24 boolean grid.
 */
export function windowsToGrid(windows: ScheduleWindow[]): boolean[][] {
  const grid: boolean[][] = Array.from({ length: 7 }, () => Array(24).fill(false));

  for (const win of windows) {
    if (win.dayOfWeek < 0 || win.dayOfWeek > 6) continue;
    const startH = Math.min(23, Math.max(0, win.startHour));
    const endH = win.endMin > 0 ? Math.min(23, win.endHour) : Math.min(23, Math.max(0, win.endHour - 1));

    for (let h = startH; h <= endH; h++) {
      grid[win.dayOfWeek][h] = true;
    }
  }

  return grid;
}

/**
 * Standard Presets for 7-Day Schedule
 */
export const SCHEDULE_PRESETS = {
  ALL_HOURS: (): boolean[][] => Array.from({ length: 7 }, () => Array(24).fill(true)),
  BUSINESS_HOURS: (): boolean[][] => {
    // Mon-Fri (1-5) 9:00 to 18:00 (hours 9..17)
    return Array.from({ length: 7 }, (_, day) => {
      if (day >= 1 && day <= 5) {
        return Array.from({ length: 24 }, (_, hour) => hour >= 9 && hour < 18);
      }
      return Array(24).fill(false);
    });
  },
  NIGHTS_AND_WEEKENDS: (): boolean[][] => {
    // Mon-Fri: 18:00 to 08:00 (hours 0..7 and 18..23), Sat & Sun (0, 6): All day
    return Array.from({ length: 7 }, (_, day) => {
      if (day === 0 || day === 6) {
        return Array(24).fill(true);
      }
      return Array.from({ length: 24 }, (_, hour) => hour < 8 || hour >= 18);
    });
  },
  CLEAR_ALL: (): boolean[][] => Array.from({ length: 7 }, () => Array(24).fill(false)),
};
