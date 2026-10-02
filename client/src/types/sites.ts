/** GET /api/sites entry. id null = cameras not assigned to any site. */
export interface SiteSummary {
  id: string | null;
  name: string;
  address: string | null;
  timezone: string | null;
  notes: string | null;
  cameraCount: number;
  health: { total: number; online: number; degraded: number; offline: number; unknown: number };
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN' | 'EMPTY';
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
  HEALTHY: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Healthy' },
  DEGRADED: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Degraded' },
  CRITICAL: { dot: 'bg-red-500', text: 'text-red-400', label: 'Cameras offline' },
  UNKNOWN: { dot: 'bg-zinc-500', text: 'text-zinc-400', label: 'Checking…' },
  EMPTY: { dot: 'bg-zinc-600', text: 'text-zinc-500', label: 'No cameras' },
};
