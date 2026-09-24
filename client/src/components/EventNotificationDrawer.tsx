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
          <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-950/90 px-2 py-0.5 rounded border border-red-800">
            <AlertTriangle className="w-3 h-3" />
            CRITICAL
          </span>
        );
      case 'warning':
        return (
          <span className="flex items-center gap-1 text-[10px] font-bold text-gray-950 bg-[#fb923c] px-2 py-0.5 rounded shadow-sm">
            <Activity className="w-3 h-3" />
            MOTION
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-[#4fc3f7] bg-[#4fc3f7]/15 px-2 py-0.5 rounded border border-[#4fc3f7]/30">
            <Info className="w-3 h-3" />
            INFO
          </span>
        );
    }
  };

  const getEventIcon = (type: string) => {
    if (type.startsWith('camera.')) {
      return <Video className="w-4 h-4 text-[#4fc3f7]" />;
    }
    if (type.startsWith('storage.')) {
      return <HardDrive className="w-4 h-4 text-[#fb923c]" />;
    }
    return <Activity className="w-4 h-4 text-[#fb923c]" />;
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
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-[#111827] border-l border-[#1f2937] shadow-2xl flex flex-col font-sans select-none animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#1f2937] bg-[#090d16]">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#4fc3f7]" />
          <h2 className="text-sm font-bold text-slate-100 tracking-wide">INCIDENT & ALERT FEED</h2>
          <span className="text-xs bg-[#4fc3f7]/20 text-[#4fc3f7] px-2 py-0.5 rounded-full font-mono font-bold border border-[#4fc3f7]/40">
            {events.length}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-[#1f2937] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Filter Tabs & Clear Action */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#090d16]/60 border-b border-[#1f2937] text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              filter === 'all'
                ? 'bg-[#4fc3f7] text-[#090d16]'
                : 'bg-[#1f2937] text-slate-300 hover:text-white'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('motion')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              filter === 'motion'
                ? 'bg-[#fb923c] text-gray-950'
                : 'bg-[#1f2937] text-slate-300 hover:text-white'
            }`}
          >
            Motion
          </button>
          <button
            type="button"
            onClick={() => setFilter('system')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              filter === 'system'
                ? 'bg-[#4fc3f7] text-[#090d16]'
                : 'bg-[#1f2937] text-slate-300 hover:text-white'
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
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 transition-colors font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500">
            <CheckCheck className="w-9 h-9 mb-2 stroke-[1.5] text-[#4fc3f7]/50" />
            <p className="text-xs font-medium text-slate-400">All clear — no active alerts</p>
          </div>
        ) : (
          filteredEvents.map((evt) => (
            <div
              key={evt.id}
              onClick={() => onSelectEvent?.(evt)}
              className="p-3 rounded-lg bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/60 transition-all cursor-pointer group shadow-sm"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  {getEventIcon(evt.type)}
                  <span className="text-xs font-bold text-slate-100">
                    {evt.metadata?.cameraName || evt.cameraId || 'System Alert'}
                  </span>
                </div>
                {getSeverityBadge(evt.severity)}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span className="text-[#4fc3f7]">{evt.type}</span>
                <span className="text-slate-400">{formatTimestamp(evt.timestamp)}</span>
              </div>

              {evt.metadata?.topic && (
                <p className="text-[11px] text-slate-400 font-mono truncate mt-1.5 bg-[#111827] px-2 py-1 rounded border border-[#1f2937]">
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
