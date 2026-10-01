import React, { useState } from 'react';
import {
  X,
  Activity,
  AlertTriangle,
  Info,
  CheckCheck,
  Trash2,
  Video,
  HardDrive,
} from 'lucide-react';
import { EventPayload } from '../utils/events-ws-client.js';

export interface EventNotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  events: EventPayload[];
  onClearEvents?: () => void;
  onSelectEvent?: (event: EventPayload) => void;
}

export const EventNotificationDrawer: React.FC<EventNotificationDrawerProps> = ({
  isOpen,
  onClose,
  events,
  onClearEvents,
  onSelectEvent,
}) => {
  const [filter, setFilter] = useState<'all' | 'motion' | 'system'>('all');

  if (!isOpen) return null;

  const filteredEvents = events.filter((e) => {
    if (filter === 'motion') {
      return e.type === 'motion.detected';
    }
    if (filter === 'system') {
      return e.type !== 'motion.detected';
    }
    return true;
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="flex items-center gap-1 text-[10px] font-medium text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-md border border-rose-500/20">
            <AlertTriangle className="w-3 h-3" />
            CRITICAL
          </span>
        );
      case 'warning':
        return (
          <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
            <Activity className="w-3 h-3" />
            MOTION
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-medium text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
            <Info className="w-3 h-3" />
            INFO
          </span>
        );
    }
  };

  const getEventIcon = (type: string) => {
    if (type.startsWith('camera.')) {
      return <Video className="w-4 h-4 text-emerald-400" />;
    }
    if (type.startsWith('storage.')) {
      return <HardDrive className="w-4 h-4 text-amber-400" />;
    }
    return <Activity className="w-4 h-4 text-amber-400" />;
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm alert-glass border-l border-white/10 shadow-2xl flex flex-col font-sans select-none animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.08] glass-bar">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-semibold text-zinc-100 tracking-wide uppercase">Incidents & Alert Feed</h2>
          <span className="text-[11px] hud-chip text-emerald-400 px-2 py-0.5 rounded-full font-mono font-medium">
            {events.length}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Tabs & Clear Action */}
      <div className="flex items-center justify-between px-4 py-2.5 glass-bar border-b border-white/[0.08] text-xs">
        <div className="flex items-center bg-zinc-950/60 p-0.5 rounded-lg border border-white/[0.07]">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === 'all'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('motion')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === 'motion'
                ? 'bg-zinc-800 text-amber-300 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Motion
          </button>
          <button
            type="button"
            onClick={() => setFilter('system')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === 'system'
                ? 'bg-zinc-800 text-cyan-300 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            System
          </button>
        </div>

        {onClearEvents && events.length > 0 && (
          <button
            type="button"
            onClick={onClearEvents}
            title="Clear all alerts"
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-rose-400 transition-colors font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-zinc-500">
            <CheckCheck className="w-8 h-8 mb-2 stroke-[1.5] text-emerald-400/60" />
            <p className="text-xs font-medium text-zinc-400">All clear — no active alerts</p>
          </div>
        ) : (
          filteredEvents.map((evt) => (
            <div
              key={evt.id}
              onClick={() => onSelectEvent?.(evt)}
              className="p-3 rounded-xl hud-chip border border-white/[0.08] hover:border-white/20 transition-all cursor-pointer group shadow-sm"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  {getEventIcon(evt.type)}
                  <span className="text-xs font-semibold text-zinc-100">
                    {evt.metadata?.cameraName || evt.cameraId || 'System Alert'}
                  </span>
                </div>
                {getSeverityBadge(evt.severity)}
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                <span className="text-emerald-400">{evt.type}</span>
                <span className="text-zinc-400">{formatTimestamp(evt.timestamp)}</span>
              </div>

              {evt.metadata?.topic && (
                <p className="text-[10px] text-zinc-400 font-mono truncate mt-1.5 bg-black/40 px-2 py-1 rounded border border-white/5">
                  {evt.metadata.topic}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default EventNotificationDrawer;
