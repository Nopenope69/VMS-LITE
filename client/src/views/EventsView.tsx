import React, { useState, useMemo } from 'react';
import {
  Activity,
  Filter,
  User,
  Car,
  Eye,
  Camera,
  Search,
  ArrowRight,
  ShieldAlert,
  Play,
  Clock,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { CameraRecord } from '../App.js';
import { EventPayload } from '../utils/events-ws-client.js';

export interface EventsViewProps {
  cameras: CameraRecord[];
  events: EventPayload[];
  onSelectCamera: (cameraId: string) => void;
}

type EventFilterType = 'all' | 'motion' | 'person' | 'vehicle' | 'system';

export const EventsView: React.FC<EventsViewProps> = ({
  cameras,
  events,
  onSelectCamera,
}) => {
  const [selectedType, setSelectedType] = useState<EventFilterType>('all');
  const [selectedCameraId, setSelectedCameraId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Map camera lookup for fast metadata
  const cameraMap = useMemo(() => {
    const map = new Map<string, CameraRecord>();
    cameras.forEach((c) => map.set(c.id, c));
    return map;
  }, [cameras]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // Camera filter
      if (selectedCameraId !== 'all' && ev.cameraId !== selectedCameraId) {
        return false;
      }

      const evTypeStr = (ev.type || '').toLowerCase();

      // Type filter
      if (selectedType === 'motion' && !evTypeStr.includes('motion')) {
        return false;
      }
      if (selectedType === 'person' && !evTypeStr.includes('person')) {
        return false;
      }
      if (selectedType === 'vehicle' && !evTypeStr.includes('vehicle')) {
        return false;
      }
      if (
        selectedType === 'system' &&
        (evTypeStr.includes('motion') ||
          evTypeStr.includes('person') ||
          evTypeStr.includes('vehicle'))
      ) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const camName = String(
          ev.metadata?.cameraName ?? ev.metadata?.siteName ?? cameraMap.get(ev.cameraId ?? '')?.name ?? ''
        ).toLowerCase();
        return camName.includes(q) || evTypeStr.includes(q);
      }

      return true;
    });
  }, [events, selectedType, selectedCameraId, searchQuery, cameraMap]);

  // Humanize event title
  const getEventTitle = (type: string): string => {
    const lower = type.toLowerCase();
    if (lower.includes('person')) return 'Person detected';
    if (lower.includes('vehicle')) return 'Vehicle detected';
    if (lower.includes('motion')) return 'Motion detected';
    if (lower.includes('offline')) return 'Camera offline';
    if (lower.includes('online')) return 'Camera online';
    if (lower.includes('recording')) return 'Recording started';
    return type.replace('.', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const getEventIcon = (type: string) => {
    const lower = type.toLowerCase();
    if (lower.includes('person')) return <User className="w-4 h-4 text-amber-400" />;
    if (lower.includes('vehicle')) return <Car className="w-4 h-4 text-blue-400" />;
    if (lower.includes('motion')) return <Activity className="w-4 h-4 text-emerald-400" />;
    return <Eye className="w-4 h-4 text-purple-400" />;
  };

  const formatTimestamp = (ts: string | Date): { time: string; fullTime: string; date: string } => {
    try {
      const d = typeof ts === 'string' ? new Date(ts) : ts;
      return {
        time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        fullTime: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      };
    } catch {
      return { time: '12:00', fullTime: '12:00:00', date: 'Today' };
    }
  };

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 md:py-10 flex flex-col font-sans select-none overflow-y-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white">Events</h1>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            Today · {events.length} {events.length === 1 ? 'event' : 'events'}
          </p>
        </div>

        {/* Search input */}
        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter by camera or event..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all font-sans"
          />
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 pb-6 border-b border-white/[0.06]">
        {/* Camera Selector */}
        <div className="relative">
          <select
            value={selectedCameraId}
            onChange={(e) => setSelectedCameraId(e.target.value)}
            className="appearance-none bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.08] rounded-full pl-3.5 pr-8 py-1 text-xs text-zinc-300 font-medium cursor-pointer focus:outline-none focus:border-white/20 transition-colors"
          >
            <option value="all" className="bg-[#111318] text-white">All cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id} className="bg-[#111318] text-white">
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <div className="h-4 w-px bg-white/[0.08] mx-1" />

        {/* Category Pills */}
        <button
          type="button"
          onClick={() => setSelectedType('all')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            selectedType === 'all'
              ? 'bg-zinc-800 text-white border border-white/20 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
          }`}
        >
          All
        </button>

        <button
          type="button"
          onClick={() => setSelectedType('motion')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
            selectedType === 'motion'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
          }`}
        >
          <Activity className="w-3 h-3 text-emerald-400" />
          <span>Motion</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedType('person')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
            selectedType === 'person'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
          }`}
        >
          <User className="w-3 h-3 text-amber-400" />
          <span>Person</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedType('vehicle')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
            selectedType === 'vehicle'
              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
          }`}
        >
          <Car className="w-3 h-3 text-blue-400" />
          <span>Vehicle</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedType('system')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            selectedType === 'system'
              ? 'bg-zinc-800 text-white border border-white/20 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
          }`}
        >
          System
        </button>
      </div>

      {/* Events List */}
      <div className="mt-6 space-y-3">
        {filteredEvents.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-white/[0.08] rounded-xl">
            <Sparkles className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-zinc-400">No events found</p>
            <p className="text-xs text-zinc-600 mt-1">
              {searchQuery || selectedType !== 'all' || selectedCameraId !== 'all'
                ? 'Try broadening your filters or search terms.'
                : 'Activity captured by cameras will appear here automatically.'}
            </p>
          </div>
        ) : (
          filteredEvents.map((ev) => {
            const timeObj = formatTimestamp(ev.timestamp);
            const cam = ev.cameraId ? cameraMap.get(ev.cameraId) : undefined;
            // System events (storage, etc.) have no camera
            const cameraName =
              ev.metadata?.cameraName ||
              cam?.name ||
              (ev.siteId ? `Site: ${ev.metadata?.siteName ?? 'Unknown'}` : ev.cameraId ? 'Unknown Camera' : 'System');

            return (
              <div
                key={ev.id}
                onClick={() => ev.cameraId && onSelectCamera(ev.cameraId)}
                className="group relative flex items-center justify-between p-3.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/15 rounded-xl cursor-pointer transition-all shadow-sm"
              >
                <div className="flex items-center gap-4">
                  {/* Thumbnail / Visual Badge */}
                  <div className="relative w-16 h-11 rounded-lg bg-zinc-900 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 group-hover:border-emerald-500/40 transition-colors">
                    {/* Background subtle gradient / grid effect */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-black via-zinc-950 to-zinc-900" />
                    
                    {/* Simulated visual radar/sensor marker */}
                    <div className="relative z-10 p-1.5 rounded-full bg-white/[0.05] border border-white/10">
                      {getEventIcon(ev.type)}
                    </div>

                    {/* Small play hint on hover */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play className="w-4 h-4 text-white fill-white" />
                    </div>
                  </div>

                  {/* Details */}
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-100 group-hover:text-white transition-colors">
                        {getEventTitle(ev.type)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <span className="text-zinc-300 font-medium">{cameraName}</span>
                      <span>•</span>
                      <span className="font-mono text-zinc-500">{timeObj.fullTime}</span>
                    </div>
                  </div>
                </div>

                {/* Right Action */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
                    {timeObj.time}
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-white/[0.03] group-hover:bg-white/10 border border-white/[0.06] flex items-center justify-center text-zinc-400 group-hover:text-white transition-all">
                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
