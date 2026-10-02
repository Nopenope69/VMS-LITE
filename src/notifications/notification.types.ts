/**
 * Notification Types and DTOs (EXT-07)
 */

export interface WhatsAppCloudCredentials {
  accessToken: string;
  phoneNumberId: string;
}

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  fromPhone: string;
}

export interface NotificationDispatchPayload {
  recipientPhone: string;
  eventType: string;
  cameraId: string;
  cameraName: string;
  timestamp: string; // appliance-local, e.g. "25 Sept 2026, 13:45:22 IST"
  snapshotUrl?: string;
  messageText: string;
  templateId?: string;
  templateVariables?: Record<string, string>;
}

export interface INotificationDispatcher {
  readonly providerName: string;
  send(payload: NotificationDispatchPayload): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

export interface NotificationConfigDto {
  id: string;
  provider: string;
  credentialsJson: string | null;
  sender: string | null;
  recipientPhones: string[];
  cooldownSeconds: number;
  events: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNotificationConfigInput {
  provider?: string;
  credentialsJson?: string | null;
  sender?: string | null;
  recipientPhones?: string[];
  cooldownSeconds?: number;
  events?: string[];
  enabled?: boolean;
}
