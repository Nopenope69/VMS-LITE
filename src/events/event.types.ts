import { z } from 'zod';

export const EventSeverityEnum = z.enum(['info', 'warning', 'critical']);
export type EventSeverity = z.infer<typeof EventSeverityEnum>;

export const CoreEventType = {
  CAMERA_ADDED: 'camera.added',
  CAMERA_ONLINE: 'camera.online',
  CAMERA_DEGRADED: 'camera.degraded',
  CAMERA_OFFLINE: 'camera.offline',
  CAMERA_DELETED: 'camera.deleted',
  RECORDING_STARTED: 'recording.started',
  RECORDING_STOPPED: 'recording.stopped',
  STORAGE_WARNING: 'storage.warning',
  STORAGE_FULL: 'storage.full',
  MOTION_DETECTED: 'motion.detected',
  SITE_OFFLINE: 'site.offline',
  SITE_ONLINE: 'site.online',
} as const;

/**
 * Every event type the system emits. The bus only accepts these, so a misspelt type
 * fails typecheck instead of silently reaching no subscriber.
 */
export const EVENT_TYPES = [
  'camera.added',
  'camera.online',
  'camera.degraded',
  'camera.offline',
  'camera.deleted',
  'camera.tamper',
  'motion.detected',
  'site.offline',
  'site.online',
  'recording.started',
  'recording.stopped',
  'recording.segment_created',
  'storage.warning',
  'storage.critical',
  'storage.full',
  'storage.rollover',
  'storage.health_changed',
  'storage.exhaustion_risk',
  'storage.protected_overflow',
  'storage.protected_recovered',
  'storage.invariants_audited',
  'storage.drive_degraded',
  'incident.created',
  'incident.updated',
  'ai.detections_processed',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/** @deprecated use EventType */
export type CoreEventTypeString = EventType;

export interface EventRecord<T = Record<string, unknown>> {
  id: string;
  cameraId: string | null;
  /** Set on site-level events (site.offline / site.online) */
  siteId?: string | null;
  timestamp: Date;
  type: EventType;
  source: string;
  severity: EventSeverity;
  metadata: T;
  createdAt: Date;
}

export interface EmitEventInput<T = Record<string, unknown>> {
  cameraId?: string | null;
  siteId?: string | null;
  timestamp?: Date | string;
  type: CoreEventTypeString;
  source: string;
  severity?: EventSeverity;
  metadata?: T;
}

export interface EventQueryFilter {
  type?: string;
  cameraId?: string;
  /** Restrict to these cameras (used for operator camera permissions). */
  cameraIds?: string[];
  /** With cameraIds: also include site-level events of these sites. */
  siteIds?: string[];
  since?: Date | string;
  limit?: number;
  offset?: number;
}
