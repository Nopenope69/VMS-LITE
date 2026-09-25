/**
 * Webhook Types and DTOs (EXT-08)
 */

export const ALLOWED_WEBHOOK_EVENTS = [
  'motion.detected',
  'camera.online',
  'camera.degraded',
  'camera.offline',
  'camera.tamper',
] as const;

export type AllowedWebhookEvent = (typeof ALLOWED_WEBHOOK_EVENTS)[number];

export interface WebhookEndpointDto {
  id: string;
  name: string;
  url: string;
  secret: string; // Masked when returned via GET API
  events: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookInput {
  name: string;
  url: string;
  secret?: string;
  events?: string[];
  enabled?: boolean;
}

export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
  enabled?: boolean;
}

export interface WebhookDeliveryPayload {
  eventId: string;
  eventType: string;
  timestamp: string; // ISO-8601
  cameraId: string | null;
  data: Record<string, unknown>;
}
