import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Search,
  Activity,
  Play,
  Calendar,
  Clock,
  Filter,
  AlertTriangle,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import type { CameraOption } from '../hooks/usePlaybackSession.js';

export interface MotionEventItem {
  id: string;
  cameraId: string | null;
  timestamp: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  metadata: {
    zoneName?: string;
    score?: number;
    point?: { x: number; y: number };
    [key: string]: any;
  };
}

export interface SmartMotionSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: CameraOption[];
  selectedCameraId: string;
  currentPlaybackTime: Date;
  apiBaseUrl?: string;
  authToken?: string;
  onSelectTime: (time: Date) => void;
}

export const SmartMotionSearchModal: React.FC<SmartMotionSearchModalProps> = ({
  isOpen,
  onClose,
  cameras,
  selectedCameraId,
  currentPlaybackTime,
  apiBaseUrl = '',
  authToken = '',
  onSelectTime,
}) => {
  const [activeCamId, setActiveCamId] = useState<string>(selectedCameraId);
  const [timeRange, setTimeRange] = useState<'hour' | 'today' | 'custom'>('hour');
  const [selectedQuadrant, setSelectedQuadrant] = useState<number | null>(null); // 0=TL, 1=TR, 2=BL, 3=BR
  const [events, setEvents] = useState<MotionEventItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveCamId(selectedCameraId);
  }, [selectedCameraId]);

  const fetchMotionEvents = useCallback(async () => {
    if (!activeCamId) return;
    setIsLoading(true);
    setError(null);

    try {
      let since: Date;
      let until: Date;

      if (timeRange === 'hour') {
        since = new Date(currentPlaybackTime.getTime() - 30 * 60 * 1000);
        until = new Date(currentPlaybackTime.getTime() + 30 * 60 * 1000);
      } else {
        // Today
        const dateStr = currentPlaybackTime.toISOString().split('T')[0];
        since = new Date(`${dateStr}T00:00:00.000Z`);
        until = new Date(`${dateStr}T23:59:59.999Z`);
      }

      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const url = `${apiBaseUrl}/api/events?type=motion.detected&cameraId=${encodeURIComponent(
        activeCamId
      )}&since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(
        until.toISOString()
      )}&limit=100`;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Failed to load motion events: HTTP ${res.status}`);
      }

      const data = (await res.json()) as any;
      setEvents(data.events || []);
    } catch (err: any) {
      setError(err.message || 'Error searching motion events');
    } finally {
      setIsLoading(false);
    }
  }, [activeCamId, timeRange, currentPlaybackTime, apiBaseUrl, authToken]);

  useEffect(() => {
    if (isOpen) {
      fetchMotionEvents();
    }
  }, [isOpen, fetchMotionEvents]);

  if (!isOpen) return null;

  // Filter by Quadrant if selected
  const filteredEvents = events.filter((ev) => {
    if (selectedQuadrant === null) return true;
    const pt = ev.metadata?.point;
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return true;
    // 0: x<0.5, y<0.5; 1: x>=0.5, y<0.5; 2: x<0.5, y>=0.5; 3: x>=0.5, y>=0.5
    if (selectedQuadrant === 0) return pt.x < 0.5 && pt.y < 0.5;
    if (selectedQuadrant === 1) return pt.x >= 0.5 && pt.y < 0.5;
    if (selectedQuadrant === 2) return pt.x < 0.5 && pt.y >= 0.5;
    if (selectedQuadrant === 3) return pt.x >= 0.5 && pt.y >= 0.5;
    return true;
  });

  const activeCamName = cameras.find((c) => c.id === activeCamId)?.name || 'Selected Camera';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-[#0d131f] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#111827] border-b border-[#1f2937]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/30 text-[#4fc3f7]">
              <Search className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Smart Motion Search</span>
                <span className="text-[10px] font-mono text-[#4fc3f7] px-1.5 py-0.5 rounded bg-[#4fc3f7]/15">
                  AI & SPATIAL ROI
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Instantly scan hours of footage for motion anomalies and intrusions
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Controls */}
        <div className="p-4 bg-[#111827]/50 border-b border-[#1f2937] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Camera Selection */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-400 font-semibold">Camera Source</label>
            <select
              value={activeCamId}
              onChange={(e) => setActiveCamId(e.target.value)}
              className="bg-[#090d16] border border-[#1f2937] rounded-md px-3 py-1.5 text-slate-200 focus:outline-none focus:border-[#4fc3f7]"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Time Window */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-400 font-semibold">Time Horizon</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTimeRange('hour')}
                className={`flex-1 py-1.5 rounded border transition-colors ${
                  timeRange === 'hour'
                    ? 'bg-[#4fc3f7] text-[#090d16] font-bold border-[#4fc3f7]'
                    : 'bg-[#090d16] text-slate-300 border-[#1f2937] hover:border-slate-500'
                }`}
              >
                ±30 Min of Current
              </button>
              <button
                type="button"
                onClick={() => setTimeRange('today')}
                className={`flex-1 py-1.5 rounded border transition-colors ${
                  timeRange === 'today'
                    ? 'bg-[#4fc3f7] text-[#090d16] font-bold border-[#4fc3f7]'
                    : 'bg-[#090d16] text-slate-300 border-[#1f2937] hover:border-slate-500'
                }`}
              >
                Entire Day
              </button>
            </div>
          </div>

          {/* Spatial ROI Quadrant Filter */}
          <div className="sm:col-span-2 flex flex-col gap-1.5 mt-1">
            <div className="flex items-center justify-between">
              <label className="text-slate-400 font-semibold flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-[#4fc3f7]" />
                <span>Spatial Region of Interest (ROI Quadrant Filter)</span>
              </label>
              {selectedQuadrant !== null && (
                <button
                  type="button"
                  onClick={() => setSelectedQuadrant(null)}
                  className="text-[11px] text-[#4fc3f7] hover:underline"
                >
                  Clear Quadrant Filter
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 0, label: 'Top-Left' },
                { id: 1, label: 'Top-Right' },
                { id: 2, label: 'Bottom-Left' },
                { id: 3, label: 'Bottom-Right' },
              ].map((quad) => (
                <button
                  key={quad.id}
                  type="button"
                  onClick={() =>
                    setSelectedQuadrant((prev) => (prev === quad.id ? null : quad.id))
                  }
                  className={`py-1.5 px-2 rounded text-center border text-[11px] transition-colors ${
                    selectedQuadrant === quad.id
                      ? 'bg-[#fb923c] text-[#090d16] font-bold border-[#fb923c]'
                      : 'bg-[#090d16] text-slate-300 border-[#1f2937] hover:border-[#fb923c]/50'
                  }`}
                >
                  {quad.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-400">
              <Activity className="w-8 h-8 text-[#4fc3f7] animate-spin mb-2" />
              <span className="text-xs">Scanning motion logs and spatial zones...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-950/40 border border-red-800 rounded-lg text-red-200 text-xs text-center">
              {error}
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500 text-center">
              <ShieldAlert className="w-10 h-10 mb-2 opacity-40" />
              <span className="text-xs font-semibold text-slate-400">No Motion Events Detected</span>
              <span className="text-[11px] text-slate-500 max-w-sm mt-0.5">
                No motion activity matches the selected time range or spatial quadrant filter.
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pb-1">
                <span>FOUND {filteredEvents.length} MOTION INCIDENTS</span>
                <span>CLICK TO JUMP PLAYHEAD</span>
              </div>

              {filteredEvents.map((ev) => {
                const dateObj = new Date(ev.timestamp);
                const timeString = dateObj.toLocaleTimeString('en-IN', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                const dateString = dateObj.toISOString().split('T')[0];

                return (
                  <div
                    key={ev.id}
                    onClick={() => {
                      onSelectTime(dateObj);
                      onClose();
                    }}
                    className="flex items-center justify-between p-3 rounded-lg bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7] hover:bg-[#111827] transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-[#fb923c]/15 border border-[#fb923c]/30 flex items-center justify-center text-[#fb923c] shrink-0">
                        <Activity className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-100">
                            {timeString}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {dateString}
                          </span>
                          {ev.metadata?.zoneName && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#4fc3f7]/15 text-[#4fc3f7] border border-[#4fc3f7]/30">
                              Zone: {ev.metadata.zoneName}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          Motion detected on {activeCamName}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#4fc3f7]/15 group-hover:bg-[#4fc3f7] text-[#4fc3f7] group-hover:text-[#090d16] font-bold text-xs rounded transition-all"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Jump to Frame</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#111827] border-t border-[#1f2937] text-xs">
          <span className="text-slate-400">
            Total Results: <strong className="text-slate-200">{filteredEvents.length}</strong>
          </span>
          <button
            type="button"
            onClick={fetchMotionEvents}
            className="px-4 py-1.5 bg-[#1f2937] hover:bg-slate-700 text-slate-200 rounded font-semibold transition-colors"
          >
            Refresh Events
          </button>
        </div>
      </div>
    </div>
  );
};
