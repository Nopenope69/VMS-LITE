import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Version 1 contract for finalized recording segments.
 *
 * Designed around the 4-way separation:
 * - EVENT: Immutable fact that an artifact was created.
 * - ARTIFACT: Opaque storage pointer (provider + key) resolved via IStorageProvider.
 * - CAPTURE: Recording policy and motion incident context for prioritization.
 * - LIFECYCLE: Formal state, retention tier, and protection flags.
 * - ANALYSIS HINTS: Generic flags to steer asynchronous AI without coupling recording to models.
 */
export const SegmentCreatedEventV1Schema = z.object({
  schemaVersion: z.literal(1).default(1),
  eventType: z.enum(['recording.segment.created', 'recording.segment_created']).default('recording.segment.created'),
  eventId: z.string().default(() => crypto.randomUUID()),
  occurredAt: z.string().datetime().default(() => new Date().toISOString()),
  source: z.object({
    applianceId: z.string().optional(),
    siteId: z.string().nullable().optional(),
    cameraId: z.string().min(1),
  }),
  recording: z.object({
    id: z.string().min(1),
    streamRole: z.enum(['PRIMARY', 'SUB']).default('PRIMARY'),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
  }),
  media: z.object({
    format: z.literal('fmp4').default('fmp4'),
    codec: z.string().default('h264'),
    hasAudio: z.boolean().default(false),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
  }),
  artifact: z.object({
    provider: z.enum(['local', 's3', 'nas']).default('local'),
    key: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().optional(),
  }),
  lifecycle: z.object({
    status: z.enum(['AVAILABLE', 'VALIDATING', 'DISCOVERED', 'QUARANTINED', 'EXPIRED', 'DELETED']).default('AVAILABLE'),
    retentionTier: z.enum(['CONTINUOUS', 'EVENT', 'INCIDENT', 'PROTECTED']).default('CONTINUOUS'),
    isProtected: z.boolean().default(false),
  }).default({
    status: 'AVAILABLE',
    retentionTier: 'CONTINUOUS',
    isProtected: false,
  }),
  capture: z.object({
    mode: z.enum(['CONTINUOUS', 'SCHEDULED', 'MOTION_ONLY', 'MANUAL_OFF']).default('CONTINUOUS'),
    incidentId: z.string().nullable().optional(),
  }).default({ mode: 'CONTINUOUS' }),
  analysisHints: z.object({
    eligible: z.boolean().default(true),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
    preferredStream: z.enum(['main', 'sub']).default('sub'),
  }).default({
    eligible: true,
    priority: 'normal',
    preferredStream: 'sub',
  }),
});

export type SegmentCreatedEventV1 = z.infer<typeof SegmentCreatedEventV1Schema>;
export type SegmentCreatedEventV1Input = z.input<typeof SegmentCreatedEventV1Schema>;

export function createSegmentCreatedEventV1(input: SegmentCreatedEventV1Input): SegmentCreatedEventV1 {
  return SegmentCreatedEventV1Schema.parse(input);
}
