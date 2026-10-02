import React from 'react';
import { MapPin } from 'lucide-react';
import {
  formatBandwidth,
  LINK_USAGE_STYLE,
  linkUsageLevel,
  SITE_STATUS_STYLE,
  SiteSummary,
  UNASSIGNED_SITE,
} from '../types/sites.js';

export interface SiteHealthCardsProps {
  sites: SiteSummary[];
  selectedSite?: string;
  onSelectSite: (siteFilter: string) => void;
}

/** One card per site with live camera health; clicking a card filters the console to it. */
export const SiteHealthCards: React.FC<SiteHealthCardsProps> = ({ sites, selectedSite, onSelectSite }) => {
  if (sites.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sites.map((site) => {
        const key = site.id ?? UNASSIGNED_SITE;
        const style = SITE_STATUS_STYLE[site.status];
        const isSelected = selectedSite === key;
        return (
          <button
            type="button"
            key={key}
            onClick={() => onSelectSite(key)}
            className={`text-left p-3.5 rounded-xl border transition-all ${
              isSelected
                ? 'bg-emerald-500/[0.06] border-emerald-500/30'
                : 'bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span className={`text-sm font-semibold truncate ${site.id ? 'text-white' : 'text-zinc-400 italic'}`}>
                  {site.name}
                </span>
              </div>
              <span className={`flex items-center gap-1.5 text-[11px] font-medium ${style.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {style.label}
              </span>
            </div>
            {site.address && <div className="text-[11px] text-zinc-500 mt-1 truncate">{site.address}</div>}
            <div className="mt-2.5 flex items-center gap-3 text-[11px] font-mono">
              <span className="text-zinc-400">{site.cameraCount} cams</span>
              <span className="text-emerald-400">{site.health.online} online</span>
              {site.health.degraded > 0 && <span className="text-amber-400">{site.health.degraded} degraded</span>}
              {site.health.offline > 0 && <span className="text-red-400">{site.health.offline} offline</span>}
              {site.health.unknown > 0 && <span className="text-zinc-500">{site.health.unknown} checking</span>}
            </div>
            <SiteLinkUsage site={site} />
          </button>
        );
      })}
    </div>
  );
};

/** Video received from the site, against its uplink capacity when one is set. */
export const SiteLinkUsage: React.FC<{ site: SiteSummary }> = ({ site }) => {
  if (site.bandwidthKbps === null || site.bandwidthKbps === undefined) return null;
  const level = linkUsageLevel(site.linkUsage);
  const style = level ? LINK_USAGE_STYLE[level] : LINK_USAGE_STYLE.ok;
  return (
    <div className="mt-2" data-testid="site-link-usage">
      <div className={`flex items-center justify-between text-[11px] font-mono ${style.text}`}>
        <span>↓ {formatBandwidth(site.bandwidthKbps)}</span>
        {site.uplinkMbps ? (
          <span>
            {Math.round((site.linkUsage ?? 0) * 100)}% of {site.uplinkMbps} Mbps
            {level === 'saturated' ? ' · link full' : ''}
          </span>
        ) : null}
      </div>
      {site.uplinkMbps ? (
        <div className="mt-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div className={`h-full ${style.bar}`} style={{ width: `${Math.min(100, (site.linkUsage ?? 0) * 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
};
