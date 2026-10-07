/**
 * Alert Policy: the one place that decides whether an event becomes an alert, for every
 * channel (WhatsApp/SMS, email, webhooks), and what the alert is about.
 *
 * - Site link outages: the camera health service emits one site.offline event and tags
 *   the per-camera offline/degraded events of that site with `siteOutage`. Channels send
 *   the site alert and never the covered camera alerts.
 * - A channel that subscribes to camera.offline also gets site.offline/site.online,
 *   because during an outage the site alert replaces the camera alerts.
 * - Cooldown keys are per channel, per subject (camera or site), per event type.
 * Channels only format and deliver.
 */

/** Events a person can be alerted about (each channel lets the user pick from these). */
export const ALERT_EVENTS = [
  'motion.detected',
  'camera.offline',
  'camera.degraded',
  'camera.tamper',
  'storage.warning',
  'site.offline',
  'site.online',
] as const;

export type AlertChannel = 'whatsapp' | 'smtp' | 'webhook';

export interface Alert {
  type: string;
  at: Date;
  /** Camera alerts: the camera; site alerts: null */
  cameraId: string | null;
  siteId: string | null;
  /** Camera name, or site name for site alerts */
  subjectName: string;
  site: SiteAlertDetails | null;
  metadata: Record<string, any>;
}

/**
 * The alert an event stands for, or null when it must not alert anyone (a camera event
 * covered by a site outage alert).
 */
export function alertFor(event: {
  type: string;
  cameraId?: string | null;
  siteId?: string | null;
  timestamp?: Date | string;
  metadata?: any;
}): Alert | null {
  if (isCoveredBySiteAlert(event)) return null;
  const metadata = event.metadata ?? {};
  const isSite = event.type.startsWith('site.');
  const cameraId = isSite ? null : event.cameraId ?? null;
  const site = isSite ? siteAlertDetails(event) : null;
  return {
    type: event.type,
    at: event.timestamp ? new Date(event.timestamp) : new Date(),
    cameraId,
    siteId: event.siteId ?? null,
    subjectName: site
      ? site.siteName
      : String(metadata.cameraName || metadata.name || (cameraId ? `Camera ${cameraId.slice(0, 8)}` : 'System')),
    site,
    metadata,
  };
}

/** Rate-limit key: one alert per channel, subject and event type per cooldown. */
export function cooldownKey(channel: AlertChannel, alert: Alert): string {
  const subject = alert.site ? `site:${alert.siteId}` : alert.cameraId ?? 'system';
  return `${channel}:${subject}:${alert.type}`;
}

/** Base URL of this appliance for links in alerts. */
export function publicBaseUrl(override?: string): string {
  return (override || process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** Where an alert links to: the camera's timeline at that moment, or the site overview. */
export function alertLink(alert: Alert, baseOverride?: string): string {
  const base = publicBaseUrl(baseOverride);
  if (!alert.cameraId) return `${base}/`;
  return `${base}/playback?cameraId=${encodeURIComponent(alert.cameraId)}&t=${encodeURIComponent(alert.at.toISOString())}`;
}

export const SITE_ALERT_EVENTS = ['site.offline', 'site.online'] as const;

/** Camera alert that is part of a site outage (covered by the site alert) */
export function isCoveredBySiteAlert(event: { type: string; metadata?: any }): boolean {
  return event.type.startsWith('camera.') && Boolean(event.metadata?.siteOutage);
}

/**
 * Site alerts replace camera-offline alerts during an outage, so a channel that
 * sends camera-offline alerts also sends site alerts.
 */
export function channelWantsEvent(configuredEvents: string[], eventType: string): boolean {
  if (configuredEvents.includes(eventType)) return true;
  return (SITE_ALERT_EVENTS as readonly string[]).includes(eventType) && configuredEvents.includes('camera.offline');
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export interface SiteAlertDetails {
  title: string;
  siteName: string;
  cameraCount: number;
  duration: string | null;
}

export function siteAlertDetails(event: { type: string; metadata?: any }): SiteAlertDetails {
  const offline = event.type === 'site.offline';
  return {
    title: offline ? 'Site Unreachable' : 'Site Back Online',
    siteName: String(event.metadata?.siteName ?? 'Unknown site'),
    cameraCount: Number(event.metadata?.cameraCount ?? 0),
    duration: offline ? null : formatDuration(event.metadata?.outageDurationMs),
  };
}
