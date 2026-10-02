/**
 * Built-in SMTP Email Alerting Dispatcher Service (MVP-12)
 *
 * In-process, zero-cloud incident email dispatcher subscribing to EventBus.
 * Formats responsive HTML email alerts with local timestamps and playback deep-links.
 * Protected with TokenBucketRateLimiter to prevent mailbox flooding.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { TokenBucketRateLimiter, tokenBucketRateLimiter as defaultLimiter } from './token-bucket-rate-limiter.js';
import { ISmtpTransport, MockSmtpTransport, NodeSocketSmtpClient, SmtpSendResult } from './smtp-client.js';
import { SITE_ALERT_EVENTS, channelWantsEvent, isCoveredBySiteAlert, siteAlertDetails } from './site-alerts.js';
import { formatLocalTimestamp } from '../system/time-format.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  pass: string;
  from: string;
  recipients: string[];
  cooldownSeconds: number;
  events: string[];
  enabled: boolean;
}

export type UpdateSmtpConfigInput = Partial<SmtpConfig>;

export interface SmtpConfigResponseDto {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  hasPassword: boolean;
  from: string;
  recipients: string[];
  cooldownSeconds: number;
  events: string[];
  enabled: boolean;
}

export interface SmtpServiceDependencies {
  eventBus?: EventBus;
  rateLimiter?: TokenBucketRateLimiter;
  transport?: ISmtpTransport;
  configFilePath?: string;
}

export class SmtpDispatcherService {
  private readonly eventBus: EventBus;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private customTransport?: ISmtpTransport;
  private readonly configFilePath: string;

  private config: SmtpConfig = {
    host: 'localhost',
    port: 587,
    secure: false,
    requireTls: true,
    user: '',
    pass: '',
    from: 'Basic VMS <alerts@basic-vms.local>',
    recipients: [],
    cooldownSeconds: 60,
    events: ['motion.detected', 'camera.offline', 'storage.warning'],
    enabled: true,
  };

  private unsubscribeEventBus: (() => void) | null = null;

  constructor(deps: SmtpServiceDependencies = {}) {
    this.eventBus = deps.eventBus || defaultEventBus;
    this.rateLimiter = deps.rateLimiter || defaultLimiter;
    this.customTransport = deps.transport;
    this.configFilePath =
      deps.configFilePath || path.resolve(process.cwd(), 'config', 'smtp-config.json');

    this.loadPersistedConfig();
  }

  private loadPersistedConfig(): void {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const raw = fs.readFileSync(this.configFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.config = { ...this.config, ...parsed };
      }
    } catch {
      // Retain default configuration if file absent or unreadable
    }
  }

  private persistConfig(): void {
    try {
      const dir = path.dirname(this.configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch {
      // In-memory fallback
    }
  }

  setTransport(transport: ISmtpTransport): void {
    this.customTransport = transport;
  }

  getTransport(): ISmtpTransport {
    if (this.customTransport) {
      return this.customTransport;
    }
    return new NodeSocketSmtpClient({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      requireTls: this.config.requireTls,
      auth: this.config.user
        ? {
            user: this.config.user,
            pass: this.config.pass,
          }
        : undefined,
    });
  }

  getConfig(): SmtpConfigResponseDto {
    return {
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      requireTls: this.config.requireTls,
      user: this.config.user,
      hasPassword: Boolean(this.config.pass && this.config.pass.length > 0),
      from: this.config.from,
      recipients: [...this.config.recipients],
      cooldownSeconds: this.config.cooldownSeconds,
      events: [...this.config.events],
      enabled: this.config.enabled,
    };
  }

  updateConfig(input: UpdateSmtpConfigInput): SmtpConfigResponseDto {
    if (input.host !== undefined) this.config.host = input.host;
    if (input.port !== undefined) this.config.port = input.port;
    if (input.secure !== undefined) this.config.secure = input.secure;
    if (input.requireTls !== undefined) this.config.requireTls = input.requireTls;
    if (input.user !== undefined) this.config.user = input.user;

    // Only update pass if provided and not masked placeholder
    if (input.pass !== undefined && input.pass !== '********' && input.pass.trim() !== '') {
      this.config.pass = input.pass;
    }

    if (input.from !== undefined) this.config.from = input.from;
    if (input.recipients !== undefined) this.config.recipients = input.recipients;
    if (input.cooldownSeconds !== undefined) this.config.cooldownSeconds = input.cooldownSeconds;
    if (input.events !== undefined) this.config.events = input.events;
    if (input.enabled !== undefined) this.config.enabled = input.enabled;

    this.persistConfig();
    return this.getConfig();
  }

  /** Alert time in the appliance timezone (TZ), with the zone shown */
  formatLocalTimestamp(date: Date = new Date()): string {
    return formatLocalTimestamp(date);
  }

  generateHtmlAlert(
    eventType: string,
    cameraName: string,
    cameraId: string,
    timestampIso: string,
    metadata?: any
  ): { subject: string; html: string } {
    const localTime = this.formatLocalTimestamp(new Date(timestampIso));
    const baseUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const isSiteEvent = eventType.startsWith('site.');
    const actionUrl = isSiteEvent
      ? `${baseUrl}/`
      : `${baseUrl}/playback?cameraId=${encodeURIComponent(cameraId)}&t=${encodeURIComponent(timestampIso)}`;
    const actionLabel = isSiteEvent ? 'Open site overview' : 'Open 24h Timeline Playback';

    let badgeColor = '#d97706'; // Amber default
    let badgeText = 'INCIDENT ALERT';
    let subjectPrefix = '⚠️ Incident Alert';

    if (eventType === 'motion.detected') {
      badgeColor = '#e11d48'; // Rose/Red
      badgeText = 'MOTION DETECTED';
      subjectPrefix = `🚨 Motion Alert: ${cameraName}`;
    } else if (eventType === 'camera.offline') {
      badgeColor = '#dc2626'; // Deep Red
      badgeText = 'CAMERA OFFLINE';
      subjectPrefix = `🔴 Camera Offline: ${cameraName}`;
    } else if (isSiteEvent) {
      const site = siteAlertDetails({ type: eventType, metadata });
      badgeColor = eventType === 'site.offline' ? '#dc2626' : '#059669';
      badgeText = eventType === 'site.offline' ? 'SITE UNREACHABLE' : 'SITE BACK ONLINE';
      subjectPrefix = `${eventType === 'site.offline' ? '🔴' : '🟢'} ${site.title}: ${site.siteName}`;
    } else if (eventType === 'storage.warning') {
      badgeColor = '#ea580c'; // Orange
      badgeText = 'STORAGE WARNING';
      subjectPrefix = '⚠️ Storage Pool Warning';
    }

    const subject = `[Basic VMS] ${subjectPrefix} (${localTime})`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border-radius: 8px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);">
    
    <!-- Header Banner -->
    <div style="background-color: ${badgeColor}; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between;">
      <span style="font-size: 13px; font-weight: 800; letter-spacing: 0.05em; color: #ffffff; text-transform: uppercase;">${badgeText}</span>
      <span style="font-size: 12px; color: rgba(255, 255, 255, 0.9); font-weight: 500;">Basic VMS</span>
    </div>

    <!-- Alert Body -->
    <div style="padding: 24px;">
      <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #f8fafc;">
        ${escapeHtml(subjectPrefix)}
      </h2>

      <div style="background-color: #0f172a; border-radius: 6px; border: 1px solid #334155; padding: 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #94a3b8; width: 120px; font-weight: 500;">${isSiteEvent ? 'Site:' : 'Camera / Node:'}</td>
            <td style="padding: 6px 0; color: #f1f5f9; font-weight: 600;">${escapeHtml(cameraName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #94a3b8; font-weight: 500;">Event Type:</td>
            <td style="padding: 6px 0; color: #38bdf8; font-family: monospace;">${eventType}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #94a3b8; font-weight: 500;">Timestamp:</td>
            <td style="padding: 6px 0; color: #f1f5f9; font-weight: 600;">${localTime}</td>
          </tr>
          ${
            metadata?.zoneName
              ? `<tr>
            <td style="padding: 6px 0; color: #94a3b8; font-weight: 500;">Motion Zone:</td>
            <td style="padding: 6px 0; color: #fbbf24; font-weight: 600;">${escapeHtml(metadata.zoneName)}</td>
          </tr>`
              : ''
          }
          ${
            metadata?.usedPercent
              ? `<tr>
            <td style="padding: 6px 0; color: #94a3b8; font-weight: 500;">Disk Utilization:</td>
            <td style="padding: 6px 0; color: #ef4444; font-weight: 600;">${escapeHtml(metadata.usedPercent)}%</td>
          </tr>`
              : ''
          }
          ${
            isSiteEvent
              ? `<tr>
            <td style="padding: 6px 0; color: #94a3b8; font-weight: 500;">Cameras:</td>
            <td style="padding: 6px 0; color: #f1f5f9; font-weight: 600;">${escapeHtml(metadata?.cameraCount ?? '')}</td>
          </tr>${
            siteAlertDetails({ type: eventType, metadata }).duration
              ? `<tr>
            <td style="padding: 6px 0; color: #94a3b8; font-weight: 500;">Down for:</td>
            <td style="padding: 6px 0; color: #f1f5f9; font-weight: 600;">${escapeHtml(siteAlertDetails({ type: eventType, metadata }).duration)}</td>
          </tr>`
              : ''
          }`
              : ''
          }
        </table>
      </div>

      <!-- Action Button -->
      <div style="text-align: center; margin-bottom: 8px;">
        <a href="${escapeHtml(actionUrl)}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
          ${actionLabel} &rarr;
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="padding: 16px 24px; background-color: #0f172a; border-top: 1px solid #334155; text-align: center; font-size: 12px; color: #64748b;">
      Basic VMS • On-Site Security Video Management • Automated Dispatch
    </div>
  </div>
</body>
</html>
    `.trim();

    return { subject, html };
  }

  async sendTestAlert(testEmail?: string): Promise<SmtpSendResult> {
    const recipient = testEmail || this.config.recipients[0];
    if (!recipient) {
      return {
        success: false,
        messageId: '',
        error: 'No recipient email configured for test email dispatch',
      };
    }

    const localTime = this.formatLocalTimestamp();
    const subject = `[Basic VMS] Test Email Notification (${localTime})`;
    const html = `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background: #1e293b; padding: 20px; border-radius: 8px; border: 1px solid #334155;">
    <h2 style="color: #10b981; margin-top: 0;">✓ Basic VMS Email Dispatch Test</h2>
    <p>Your SMTP mail configuration is active and successfully authenticated.</p>
    <p style="font-size: 13px; color: #94a3b8;">Sent on: <strong>${localTime}</strong></p>
    <p style="font-size: 12px; color: #64748b;">Node Host: ${this.config.host}:${this.config.port}</p>
  </div>
</body>
</html>
    `.trim();

    const transport = this.getTransport();
    return transport.sendMail({
      from: this.config.from,
      to: [recipient],
      subject,
      html,
    });
  }

  async start(): Promise<void> {
    if (this.unsubscribeEventBus) return;

    const watchedEvents = ['motion.detected', 'camera.offline', 'storage.warning', 'camera.degraded', ...SITE_ALERT_EVENTS];

    const unsubscribers = watchedEvents.map((eventType) =>
      this.eventBus.subscribe(eventType, async (event) => {
        try {
          await this.handleEvent(event);
        } catch {
          // Failure handling event does not crash listener
        }
      })
    );

    this.unsubscribeEventBus = () => {
      unsubscribers.forEach((u) => u());
      this.unsubscribeEventBus = null;
    };
  }

  stop(): void {
    if (this.unsubscribeEventBus) {
      this.unsubscribeEventBus();
    }
  }

  private async handleEvent(event: any): Promise<void> {
    if (!this.config.enabled || this.config.recipients.length === 0) {
      return;
    }

    if (!channelWantsEvent(this.config.events, event.type) || isCoveredBySiteAlert(event)) {
      return;
    }

    const isSiteEvent = Boolean(event.siteId) && event.type.startsWith('site.');
    const cameraId = event.cameraId || 'system';
    const rateLimitKey = isSiteEvent ? `smtp:site:${event.siteId}:${event.type}` : `smtp:${cameraId}:${event.type}`;

    const rateResult = this.rateLimiter.tryAcquire(rateLimitKey, this.config.cooldownSeconds);
    if (!rateResult.allowed) {
      return;
    }

    const cameraName = isSiteEvent
      ? siteAlertDetails(event).siteName
      : event.metadata?.cameraName || (event.metadata as any)?.name || `Camera ${cameraId.slice(0, 8)}`;

    const timestampIso = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();

    const { subject, html } = this.generateHtmlAlert(
      event.type,
      cameraName,
      cameraId,
      timestampIso,
      event.metadata
    );

    const transport = this.getTransport();
    await transport.sendMail({
      from: this.config.from,
      to: this.config.recipients,
      subject,
      html,
    });
  }
}

export const smtpDispatcherService = new SmtpDispatcherService();
export default smtpDispatcherService;
