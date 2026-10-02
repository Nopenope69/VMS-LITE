import React from 'react';
import {
  ArrowRight,
  Video,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Clock,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { CameraRecord } from '../App.js';
import { EventPayload } from '../utils/events-ws-client.js';
import { CameraHealthTelemetry } from '../hooks/useCameraHealth.js';
import { SiteHealthCards } from '../components/SiteHealthCards.js';
import { SiteSummary } from '../types/sites.js';

export interface OverviewViewProps {
  cameras: CameraRecord[];
  events: EventPayload[];
  onlineCount: number;
  offlineCount: number;
  onNavigate: (view: 'live' | 'cameras' | 'events' | 'recordings' | 'health') => void;
  onSelectCamera: (cameraId: string) => void;
  healthMap?: Record<string, CameraHealthTelemetry>;
  sites?: SiteSummary[];
  siteFilter?: string;
  onSelectSite?: (siteFilter: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  cameras,
  events,
  onlineCount,
  offlineCount,
  onNavigate,
  onSelectCamera,
  healthMap = {},
  sites = [],
  siteFilter,
  onSelectSite,
}) => {
  // Determine greeting based on current local hour
  const currentHour = new Date().getHours();
  const greeting =
    currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';

  const issueCount = offlineCount;

  // Format timestamp into HH:MM
  const formatTime = (ts: string | Date): string => {
    try {
      const d = typeof ts === 'string' ? new Date(ts) : ts;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '12:00';
    }
  };

  // Humanize event title
  const formatEventTitle = (type: string): string => {
    switch (type) {
      case 'motion.detected':
        return 'Motion detected';
      case 'person.detected':
        return 'Person detected';
      case 'vehicle.detected':
        return 'Vehicle detected';
      case 'camera.offline':
        return 'Camera offline';
      case 'camera.added':
        return 'Camera added';
      case 'camera.online':
        return 'Camera online';
      case 'recording.started':
        return 'Recording started';
      default:
        return type.replace('.', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  };

  // Recent 6 events
  const recentEvents = events.slice(0, 6);

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 md:py-10 flex flex-col font-sans select-none overflow-y-auto">
      {/* Greeting & Header */}
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white">{greeting}</h1>
        <p className="text-xs text-zinc-500 mt-1 font-mono">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* Metric Summary Bar */}
      <div className="flex items-center gap-8 py-3 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-white tabular-nums">{cameras.length}</span>
          <span className="text-zinc-500 font-medium">cameras</span>
        </div>

        <div className="h-3 w-px bg-white/[0.08]" />

        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-emerald-400 tabular-nums">{onlineCount}</span>
          <span className="text-zinc-500 font-medium">online</span>
        </div>

        <div className="h-3 w-px bg-white/[0.08]" />

        <div className="flex items-baseline gap-2">
          <span
            className={`text-lg font-semibold tabular-nums ${
              issueCount > 0 ? 'text-amber-400' : 'text-zinc-500'
            }`}
          >
            {issueCount}
          </span>
          <span className="text-zinc-500 font-medium">
            {issueCount === 1 ? 'issue' : 'issues'}
          </span>
        </div>
      </div>

      {/* Thin Line Divider */}
      <div className="w-full h-px bg-white/[0.07] my-6" />

      {/* Per-site health (multi-site installs) */}
      {sites.length > 1 && onSelectSite && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Sites</h2>
            {siteFilter !== 'all' && (
              <button
                type="button"
                onClick={() => onSelectSite('all')}
                className="text-xs text-zinc-400 hover:text-white transition-colors"
              >
                Show all sites
              </button>
            )}
          </div>
          <SiteHealthCards sites={sites} selectedSite={siteFilter} onSelectSite={onSelectSite} />
        </div>
      )}

      {/* Camera Live Glance Grid */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Cameras</h2>
          <button
            type="button"
            onClick={() => onNavigate('live')}
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            <span>Live Grid</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {cameras.slice(0, 4).map((cam) => {
            const isOnline = healthMap[cam.id]?.status === 'ONLINE';
            return (
              <div
                key={cam.id}
                onClick={() => onSelectCamera(cam.id)}
                className="group relative rounded-xl bg-zinc-950/80 border border-white/[0.08] hover:border-white/20 p-3 flex flex-col justify-between aspect-video cursor-pointer transition-all hover:bg-zinc-900/60"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isOnline ? 'bg-emerald-400' : 'bg-zinc-600'
                      }`}
                    />
                    <span className="text-xs font-medium text-zinc-200 truncate group-hover:text-white transition-colors">
                      {cam.name}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                  <span>{cam.ipAddress}</span>
                  <span className="opacity-0 group-hover:opacity-100 text-zinc-300 transition-opacity">
                    View →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="rounded-xl border border-white/[0.07] bg-zinc-950/40 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Recent Activity
          </h2>
          <span className="text-[11px] text-zinc-500 font-mono">
            {events.length} logged today
          </span>
        </div>

        {recentEvents.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500 italic">
            No recent activity recorded today.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {recentEvents.map((evt) => {
              const camName =
                evt.metadata?.cameraName ||
                cameras.find((c) => c.id === evt.cameraId)?.name ||
                evt.cameraId ||
                'Appliance';
              const title = formatEventTitle(evt.type);
              const isMotion = evt.type.includes('motion') || evt.type.includes('person');
              const isWarning = evt.severity === 'warning' || evt.type.includes('offline');

              return (
                <div
                  key={evt.id}
                  onClick={() => evt.cameraId && onSelectCamera(evt.cameraId)}
                  className="flex items-center justify-between py-3 text-xs hover:bg-white/[0.02] px-2 rounded-lg transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-zinc-500 text-[11px] w-12 tabular-nums">
                      {formatTime(evt.timestamp)}
                    </span>

                    <div className="flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isWarning
                            ? 'bg-amber-400'
                            : isMotion
                            ? 'bg-emerald-400'
                            : 'bg-zinc-500'
                        }`}
                      />
                      <span className="font-medium text-zinc-200 group-hover:text-white transition-colors">
                        {title}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-zinc-500 text-[11px] group-hover:text-zinc-400 transition-colors">
                      {camName}
                    </span>
                    <ArrowRight className="w-3 h-3 text-zinc-600 group-hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* View All Events Button */}
        <div className="mt-5 pt-3 border-t border-white/[0.05] flex justify-center">
          <button
            type="button"
            onClick={() => onNavigate('events')}
            className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-colors flex items-center gap-1.5"
          >
            <span>View all events</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
