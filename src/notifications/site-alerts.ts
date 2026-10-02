/**
 * Site link alerts, shared by the WhatsApp/SMS and email channels.
 *
 * When a site's link drops, the camera health service emits one site.offline event and
 * tags the per-camera offline/degraded events of that site with `siteOutage`. Channels
 * send the site alert and skip the tagged camera alerts.
 */

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
