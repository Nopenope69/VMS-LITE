import { z } from 'zod';

export const LicenseEditionEnum = z.enum(['core', 'extended', 'ai']);
export type LicenseEdition = z.infer<typeof LicenseEditionEnum>;

export const LicensePayloadSchema = z.object({
  product: z.literal('basic-vms'),
  edition: LicenseEditionEnum,
  capabilities: z.array(z.string()),
  cameraLimit: z.number().int().positive(),
  expiresAt: z.string().datetime().nullable(),
  issuedAt: z.string().datetime(),
  instanceId: z.string().optional(),
});

export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

export interface ICapabilityRegistry {
  has(capability: string): boolean;
  getCameraLimit(): number;
  getExpiresAt(): Date | null;
  getEdition(): LicenseEdition;
  getAllCapabilities(): string[];
}

export const CORE_CAPABILITIES = [
  'core.live',
  'core.record',
  'core.playback',
  'core.events',
  'core.onvif',
] as const;

export const EXTENDED_CAPABILITIES = [
  ...CORE_CAPABILITIES,
  'extended.operator_role',
  'extended.motion_zones',
  'extended.ptz',
  'extended.clip_export',
  'extended.bookmarks',
  'extended.camera_health',
  'extended.whatsapp_alerts',
  'extended.api_webhooks',
] as const;

export const AI_CAPABILITIES = [
  ...EXTENDED_CAPABILITIES,
  'ai.person_detection',
  'ai.vehicle_detection',
  'ai.smart_search',
  'ai.anpr',
  'ai.face_matching',
] as const;
