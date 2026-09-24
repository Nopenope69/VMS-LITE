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
          <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-950/80 px-1.5 py-0.5 rounded border border-red-800">
            <AlertTriangle className="w-3 h-3" />
            CRITICAL
          </span>
        );
      case 'warning':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800">
            <Activity className="w-3 h-3" />
            MOTION
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">
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
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col font-sans select-none animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/50">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Live Event Feed</h2>
          <span className="text-xs bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded-full font-mono">
            {events.length}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Tabs & Clear Action */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-950/30 border-b border-zinc-800 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2 py-1 rounded transition-colors ${
              filter === 'all' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('motion')}
            className={`px-2 py-1 rounded transition-colors ${
              filter === 'motion' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Motion
          </button>
          <button
            type="button"
            onClick={() => setFilter('system')}
            className={`px-2 py-1 rounded transition-colors ${
              filter === 'system' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
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
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60 p-2">
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-zinc-500">
            <CheckCheck className="w-8 h-8 mb-2 stroke-[1.5]" />
            <p className="text-xs">No active alerts</p>
          </div>
        ) : (
          filteredEvents.map((evt) => (
            <div
              key={evt.id}
              onClick={() => onSelectEvent?.(evt)}
              className="p-2.5 rounded hover:bg-zinc-800/60 transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  {getEventIcon(evt.type)}
                  <span className="text-xs font-semibold text-zinc-200">
                    {evt.metadata?.cameraName || evt.cameraId || 'System'}
                  </span>
                </div>
                {getSeverityBadge(evt.severity)}
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span className="font-mono text-zinc-300">{evt.type}</span>
                <span className="font-mono text-zinc-500">{formatTimestamp(evt.timestamp)}</span>
              </div>

              {evt.metadata?.topic && (
                <p className="text-[10px] text-zinc-500 font-mono truncate mt-1">
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
