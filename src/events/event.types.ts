import { z } from 'zod';

export const EventSeverityEnum = z.enum(['info', 'warning', 'critical']);
export type EventSeverity = z.infer<typeof EventSeverityEnum>;

export const CoreEventType = {
  CAMERA_ONLINE: 'camera.online',
  CAMERA_DEGRADED: 'camera.degraded',
  CAMERA_OFFLINE: 'camera.offline',
  CAMERA_DELETED: 'camera.deleted',
  RECORDING_STARTED: 'recording.started',
  RECORDING_STOPPED: 'recording.stopped',
  STORAGE_WARNING: 'storage.warning',
  STORAGE_FULL: 'storage.full',
  MOTION_DETECTED: 'motion.detected',
} as const;

export type CoreEventTypeString = (typeof CoreEventType)[keyof typeof CoreEventType] | string;

export interface EventRecord<T = Record<string, unknown>> {
  id: string;
  cameraId: string | null;
  timestamp: Date;
  type: string;
  source: string;
  severity: EventSeverity;
  metadata: T;
  createdAt: Date;
}

export interface EmitEventInput<T = Record<string, unknown>> {
  cameraId?: string | null;
  timestamp?: Date | string;
  type: CoreEventTypeString;
  source: string;
  severity?: EventSeverity;
  metadata?: T;
}

export interface EventQueryFilter {
  type?: string;
  cameraId?: string;
  since?: Date | string;
  limit?: number;
  offset?: number;
}
