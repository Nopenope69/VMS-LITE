/** GET /api/sites entry. id null = cameras not assigned to any site. */
export interface SiteSummary {
  id: string | null;
  name: string;
  address: string | null;
  timezone: string | null;
  notes: string | null;
  cameraCount: number;
  health: { total: number; online: number; degraded: number; offline: number; unknown: number };
  /** Upload capacity of the site's link to the server, Mbps */
  uplinkMbps?: number | null;
  /** Video received from the site's cameras (main + sub-streams), kbps; null until measured */
  bandwidthKbps?: number | null;
  /** bandwidthKbps / uplink (0..1+), when the uplink is set */
  linkUsage?: number | null;
  /** OFFLINE = site link down (no camera reachable) */
  status: 'OFFLINE' | 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN' | 'EMPTY';
}

/** Global site filter: a site id, every site, or cameras without a site. */
export const ALL_SITES = 'all';
export const UNASSIGNED_SITE = 'unassigned';
export type SiteFilter = string;

export function matchesSiteFilter(cameraSiteId: string | null | undefined, filter: SiteFilter): boolean {
  if (filter === ALL_SITES) return true;
  if (filter === UNASSIGNED_SITE) return !cameraSiteId;
  return cameraSiteId === filter;
}

export const SITE_STATUS_STYLE: Record<SiteSummary['status'], { dot: string; text: string; label: string }> = {
  OFFLINE: { dot: 'bg-red-500', text: 'text-red-400', label: 'Site unreachable' },
  HEALTHY: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Healthy' },
  DEGRADED: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Degraded' },
  CRITICAL: { dot: 'bg-red-500', text: 'text-red-400', label: 'Cameras offline' },
  UNKNOWN: { dot: 'bg-zinc-500', text: 'text-zinc-400', label: 'Checking…' },
  EMPTY: { dot: 'bg-zinc-600', text: 'text-zinc-500', label: 'No cameras' },
};

/** e.g. 850 kbps, 4.2 Mbps */
export function formatBandwidth(kbps: number): string {
  return kbps < 1000 ? `${Math.round(kbps)} kbps` : `${(kbps / 1000).toFixed(kbps < 10_000 ? 1 : 0)} Mbps`;
}

/** Link usage level: amber from 80%, red from 95% of the configured uplink */
export function linkUsageLevel(usage: number | null | undefined): 'ok' | 'high' | 'saturated' | null {
  if (usage === null || usage === undefined) return null;
  return usage >= 0.95 ? 'saturated' : usage >= 0.8 ? 'high' : 'ok';
}

export const LINK_USAGE_STYLE = {
  ok: { bar: 'bg-emerald-400', text: 'text-zinc-400' },
  high: { bar: 'bg-amber-400', text: 'text-amber-400' },
  saturated: { bar: 'bg-red-500', text: 'text-red-400' },
} as const;
