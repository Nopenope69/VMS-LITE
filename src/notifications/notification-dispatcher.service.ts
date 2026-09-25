/**
 * Notification Dispatcher Service (EXT-07)
 *
 * WhatsApp & SMS incident alerting with token-bucket rate limiting,
 * 60-second anti-spam cooldown, flexible provider credentials, and signed snapshot links.
 */

import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { TokenBucketRateLimiter, tokenBucketRateLimiter as defaultLimiter } from './token-bucket-rate-limiter.js';
import {
  INotificationDispatcher,
  NotificationConfigDto,
  NotificationDispatchPayload,
  TwilioCredentials,
  UpdateNotificationConfigInput,
  WhatsAppCloudCredentials,
} from './notification.types.js';

export class MockNotificationDispatcher implements INotificationDispatcher {
  readonly providerName = 'mock';
  public readonly dispatches: NotificationDispatchPayload[] = [];

  async send(
    payload: NotificationDispatchPayload
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    this.dispatches.push({ ...payload });
    return {
      success: true,
      messageId: `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  clear(): void {
    this.dispatches.length = 0;
  }
}

export class WhatsAppCloudApiDispatcher implements INotificationDispatcher {
  readonly providerName = 'whatsapp_cloud';

  constructor(private readonly getCredentials: () => WhatsAppCloudCredentials | null) {}

  async send(
    payload: NotificationDispatchPayload
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const creds = this.getCredentials();
    if (!creds || !creds.accessToken || !creds.phoneNumberId) {
      return { success: false, error: 'Missing Meta WhatsApp Cloud API credentials' };
    }

    try {
      const url = `https://graph.facebook.com/v20.0/${creds.phoneNumberId}/messages`;
      const body = {
        messaging_product: 'whatsapp',
        to: payload.recipientPhone,
        type: 'text',
        text: {
          preview_url: Boolean(payload.snapshotUrl),
          body: payload.messageText,
        },
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { success: false, error: `WhatsApp Cloud API error (${res.status}): ${errorText}` };
      }

      const data = (await res.json()) as any;
      const messageId = data?.messages?.[0]?.id;
      return { success: true, messageId };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export class TwilioWhatsAppDispatcher implements INotificationDispatcher {
  readonly providerName = 'twilio';

  constructor(private readonly getCredentials: () => TwilioCredentials | null) {}

  async send(
    payload: NotificationDispatchPayload
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const creds = this.getCredentials();
    if (!creds || !creds.accountSid || !creds.authToken || !creds.fromPhone) {
      return { success: false, error: 'Missing Twilio account credentials' };
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
      const authHeader = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');

      const formData = new URLSearchParams();
      // Twilio WhatsApp addresses prefix with 'whatsapp:'
      const from = creds.fromPhone.startsWith('whatsapp:')
        ? creds.fromPhone
        : `whatsapp:${creds.fromPhone}`;
      const to = payload.recipientPhone.startsWith('whatsapp:')
        ? payload.recipientPhone
        : `whatsapp:${payload.recipientPhone}`;

      formData.append('From', from);
      formData.append('To', to);
      formData.append('Body', payload.messageText);
      if (payload.snapshotUrl) {
        formData.append('MediaUrl', payload.snapshotUrl);
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { success: false, error: `Twilio API error (${res.status}): ${errorText}` };
      }

      const data = (await res.json()) as any;
      return { success: true, messageId: data?.sid };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export interface NotificationServiceDependencies {
  prisma?: PrismaClient;
  eventBus?: EventBus;
  rateLimiter?: TokenBucketRateLimiter;
  mockDispatcher?: MockNotificationDispatcher;
}

export class NotificationService {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly rateLimiter: TokenBucketRateLimiter;

  public readonly mockDispatcher: MockNotificationDispatcher;
  public readonly whatsappCloudDispatcher: WhatsAppCloudApiDispatcher;
  public readonly twilioDispatcher: TwilioWhatsAppDispatcher;

  private activeConfigCache: any = null;
  private unsubscribeEventBus: (() => void) | null = null;
  private signingSecret = process.env.JWT_SECRET || 'snapshot-signing-key-basic-vms';

  constructor(deps: NotificationServiceDependencies = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.eventBus = deps.eventBus || defaultEventBus;
    this.rateLimiter = deps.rateLimiter || defaultLimiter;
    this.mockDispatcher = deps.mockDispatcher || new MockNotificationDispatcher();

    this.whatsappCloudDispatcher = new WhatsAppCloudApiDispatcher(() =>
      this.getParsedCredentials<WhatsAppCloudCredentials>()
    );

    this.twilioDispatcher = new TwilioWhatsAppDispatcher(() =>
      this.getParsedCredentials<TwilioCredentials>()
    );
  }

  /**
   * Helper parsing credentials JSON from active configuration.
   */
  private getParsedCredentials<T>(): T | null {
    if (!this.activeConfigCache?.credentialsJson) {
      return null;
    }
    try {
      return JSON.parse(this.activeConfigCache.credentialsJson) as T;
    } catch {
      return null;
    }
  }

  /**
   * Returns active dispatcher according to config provider.
   */
  getDispatcher(provider?: string): INotificationDispatcher {
    const prov = provider || this.activeConfigCache?.provider || 'mock';
    if (prov === 'whatsapp_cloud') return this.whatsappCloudDispatcher;
    if (prov === 'twilio') return this.twilioDispatcher;
    return this.mockDispatcher;
  }

  /**
   * Formats a date into Indian Standard Time (IST).
   */
  formatIstTimestamp(date: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date) + ' IST';
  }

  /**
   * Generates a signed, 15-minute expiring snapshot URL for external delivery.
   */
  generateSignedSnapshotUrl(cameraId: string, publicBaseUrl?: string): string {
    const baseUrl = (publicBaseUrl || process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const expires = Math.floor(Date.now() / 1000) + 15 * 60; // 15 mins
    const hmac = crypto.createHmac('sha256', this.signingSecret);
    hmac.update(`${cameraId}:${expires}`);
    const sig = hmac.digest('hex');

    return `${baseUrl}/api/cameras/${cameraId}/snapshot?expires=${expires}&sig=${sig}`;
  }

  /**
   * Formats human-readable WhatsApp message body.
   */
  formatAlertMessage(
    eventType: string,
    cameraName: string,
    timestamp: string,
    snapshotUrl?: string
  ): string {
    const title =
      eventType === 'motion.detected'
        ? 'Motion Detected'
        : eventType === 'camera.offline'
        ? 'Camera Offline'
        : eventType === 'camera.degraded'
        ? 'Camera Stream Degraded'
        : eventType === 'camera.online'
        ? 'Camera Reconnected'
        : eventType;

    let text = `🚨 *VMS ALERT: ${title}*\n`;
    text += `• *Camera:* ${cameraName}\n`;
    text += `• *Time:* ${timestamp}\n`;
    if (snapshotUrl) {
      text += `• *Snapshot:* ${snapshotUrl}\n`;
    }

    return text;
  }

  /**
   * Masks sensitive credentials in configuration DTO.
   */
  maskCredentials(rawJson: string | null): string | null {
    if (!rawJson) return null;
    try {
      const parsed = JSON.parse(rawJson);
      const masked: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') {
          masked[k] = v.length > 6 ? `whsec_${v.slice(-4)}` : 'whsec_***';
        } else {
          masked[k] = 'whsec_***';
        }
      }
      return JSON.stringify(masked);
    } catch {
      return 'whsec_***';
    }
  }

  private memoryConfig: any = null;

  /**
   * Retrieves active notification configuration.
   */
  async getConfig(): Promise<NotificationConfigDto> {
    let record: any = null;

    if (this.memoryConfig) {
      record = this.memoryConfig;
    } else {
      try {
        record = await this.prisma.notificationConfig.findFirst({
          orderBy: { createdAt: 'desc' },
        });
      } catch {
        record = null;
      }
    }

    if (!record) {
      // Default initial configuration
      record = {
        id: 'default-notification-config',
        provider: 'mock',
        credentialsJson: null,
        sender: null,
        recipientPhones: [],
        cooldownSeconds: 60,
        events: ['motion.detected', 'camera.offline'],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.memoryConfig = record;
    }

    this.activeConfigCache = record;

    return {
      id: record.id,
      provider: record.provider,
      credentialsJson: this.maskCredentials(record.credentialsJson),
      sender: record.sender,
      recipientPhones: Array.isArray(record.recipientPhones)
        ? (record.recipientPhones as string[])
        : typeof record.recipientPhones === 'string'
        ? JSON.parse(record.recipientPhones)
        : [],
      cooldownSeconds: record.cooldownSeconds ?? 60,
      events: Array.isArray(record.events)
        ? (record.events as string[])
        : typeof record.events === 'string'
        ? JSON.parse(record.events)
        : ['motion.detected', 'camera.offline'],
      enabled: Boolean(record.enabled),
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString(),
    };
  }

  /**
   * Updates notification configuration.
   * Protects existing secrets from being overwritten if masked placeholder submitted.
   */
  async updateConfig(input: UpdateNotificationConfigInput): Promise<NotificationConfigDto> {
    const existing = await this.getConfig();
    let newCredentialsJson = existing.credentialsJson;

    if (input.credentialsJson !== undefined) {
      if (input.credentialsJson && input.credentialsJson.includes('whsec_')) {
        // Retain existing unmasked credentials from cache
        newCredentialsJson = this.activeConfigCache?.credentialsJson || null;
      } else {
        newCredentialsJson = input.credentialsJson;
      }
    }

    const dataToSave = {
      provider: input.provider !== undefined ? input.provider : existing.provider,
      credentialsJson: newCredentialsJson,
      sender: input.sender !== undefined ? input.sender : existing.sender,
      recipientPhones: input.recipientPhones !== undefined ? input.recipientPhones : existing.recipientPhones,
      cooldownSeconds: input.cooldownSeconds !== undefined ? input.cooldownSeconds : existing.cooldownSeconds,
      events: input.events !== undefined ? input.events : existing.events,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    };

    let updatedRecord: any = null;

    try {
      const first = await this.prisma.notificationConfig.findFirst();
      if (first) {
        updatedRecord = await this.prisma.notificationConfig.update({
          where: { id: first.id },
          data: dataToSave as any,
        });
      } else {
        updatedRecord = await this.prisma.notificationConfig.create({
          data: dataToSave as any,
        });
      }
    } catch {
      // In-memory fallback
      updatedRecord = {
        id: existing.id,
        ...dataToSave,
        createdAt: new Date(existing.createdAt),
        updatedAt: new Date(),
      };
    }

    this.memoryConfig = updatedRecord;
    this.activeConfigCache = updatedRecord;

    return {
      id: updatedRecord.id,
      provider: updatedRecord.provider,
      credentialsJson: this.maskCredentials(updatedRecord.credentialsJson),
      sender: updatedRecord.sender,
      recipientPhones: Array.isArray(updatedRecord.recipientPhones)
        ? updatedRecord.recipientPhones
        : JSON.parse(updatedRecord.recipientPhones || '[]'),
      cooldownSeconds: updatedRecord.cooldownSeconds,
      events: Array.isArray(updatedRecord.events)
        ? updatedRecord.events
        : JSON.parse(updatedRecord.events || '[]'),
      enabled: updatedRecord.enabled,
      createdAt: new Date(updatedRecord.createdAt).toISOString(),
      updatedAt: new Date(updatedRecord.updatedAt).toISOString(),
    };
  }

  /**
   * Dispatches a test notification to verify credentials.
   */
  async sendTestAlert(
    testPhone?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const config = await this.getConfig();
    const recipient = testPhone || config.recipientPhones[0];

    if (!recipient) {
      return { success: false, error: 'No recipient phone number configured for test alert' };
    }

    const timestamp = this.formatIstTimestamp();
    const messageText = `🧪 *Basic VMS Test Alert*\nNotification integration active.\n• *Timestamp:* ${timestamp}`;

    const dispatcher = this.getDispatcher(config.provider);
    return dispatcher.send({
      recipientPhone: recipient,
      eventType: 'test.alert',
      cameraId: 'test-cam',
      cameraName: 'Test Camera',
      timestamp,
      messageText,
    });
  }

  /**
   * Starts event bus subscription for incident alerting.
   */
  async start(): Promise<void> {
    if (this.unsubscribeEventBus) return;

    await this.getConfig();

    const allowedEvents = ['motion.detected', 'camera.offline', 'camera.degraded', 'camera.tamper'];

    const unsubscribers = allowedEvents.map((eventType) =>
      this.eventBus.subscribe(eventType, async (event) => {
        try {
          await this.handleEvent(event);
        } catch {
          // Failure handling an event does not crash poller
        }
      })
    );

    this.unsubscribeEventBus = () => {
      unsubscribers.forEach((u) => u());
      this.unsubscribeEventBus = null;
    };
  }

  /**
   * Stops event bus subscription.
   */
  stop(): void {
    if (this.unsubscribeEventBus) {
      this.unsubscribeEventBus();
    }
  }

  /**
   * Evaluates event against rate limiting and dispatches alerts.
   */
  private async handleEvent(event: any): Promise<void> {
    const config = await this.getConfig();
    if (!config.enabled) return;

    // Filter event against configured events
    if (!config.events.includes(event.type)) {
      return;
    }

    const cameraId = event.cameraId || 'system';
    const rateLimitKey = `${cameraId}:${event.type}`;

    // Token-bucket rate limiting & cooldown
    const rateResult = this.rateLimiter.tryAcquire(rateLimitKey, config.cooldownSeconds);
    if (!rateResult.allowed) {
      return;
    }

    const cameraName =
      event.metadata?.cameraName ||
      (event.metadata as any)?.name ||
      `Camera ${cameraId.slice(0, 8)}`;

    const timestamp = this.formatIstTimestamp(new Date(event.timestamp || Date.now()));
    const snapshotUrl = cameraId !== 'system' ? this.generateSignedSnapshotUrl(cameraId) : undefined;
    const messageText = this.formatAlertMessage(event.type, cameraName, timestamp, snapshotUrl);

    const dispatcher = this.getDispatcher(config.provider);

    for (const phone of config.recipientPhones) {
      try {
        await dispatcher.send({
          recipientPhone: phone,
          eventType: event.type,
          cameraId,
          cameraName,
          timestamp,
          snapshotUrl,
          messageText,
        });
      } catch {
        // Individual phone delivery error does not abort loop
      }
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;
