import React, { useState, useEffect } from 'react';
import { Tv, Plus, Trash2, RefreshCw, CheckCircle, X, ExternalLink } from 'lucide-react';
import { GuardTourConfig } from './FocusTourLayout.js';

export interface DisplayStation {
  id: string;
  stationKey: string;
  name: string;
  assignedTourId: string | null;
  mode: 'DEDICATED' | 'QUAD_ZONE';
  isOnline: boolean;
  lastHeartbeat: string;
}

export interface DisplayStationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableTours: GuardTourConfig[];
  authToken?: string;
}

export const DisplayStationsModal: React.FC<DisplayStationsModalProps> = ({
  isOpen,
  onClose,
  availableTours,
  authToken,
}) => {
  const [stations, setStations] = useState<DisplayStation[]>([]);
  const [pairingCode, setPairingCode] = useState('');
  const [stationName, setStationName] = useState('');
  const [assignedTourId, setAssignedTourId] = useState('');
  const [mode, setMode] = useState<'DEDICATED' | 'QUAD_ZONE'>('DEDICATED');
  const [isPairing, setIsPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  const fetchStations = async () => {
    try {
      const res = await fetch('/api/kiosk/stations');
      if (res.ok) {
        const data = await res.json();
        setStations(data.stations || []);
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      fetchStations();
      if (availableTours.length > 0 && !assignedTourId) {
        setAssignedTourId(availableTours[0].id);
      }
    }
  }, [isOpen, availableTours]);

  if (!isOpen) return null;

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPairing(true);
    setPairError(null);

    try {
      const res = await fetch('/api/kiosk/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: pairingCode.trim(),
          name: stationName.trim() || 'Wall TV Display',
          assignedTourId: assignedTourId || undefined,
          mode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Pairing failed. Check the 4-digit code.');
      }

      setPairingCode('');
      setStationName('');
      fetchStations();
    } catch (err: any) {
      setPairError(err.message || 'Pairing failed');
    } finally {
      setIsPairing(false);
    }
  };

  const handleUnpair = async (id: string) => {
    try {
      const res = await fetch(`/api/kiosk/stations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchStations();
      }
    } catch {}
  };

  const handleUpdateTour = async (stationId: string, newTourId: string) => {
    try {
      const res = await fetch(`/api/kiosk/stations/${stationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTourId: newTourId }),
      });
      if (res.ok) {
        fetchStations();
      }
    } catch {}
  };

  const handleUpdateMode = async (stationId: string, newMode: 'DEDICATED' | 'QUAD_ZONE') => {
    try {
      const res = await fetch(`/api/kiosk/stations/${stationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        fetchStations();
      }
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2937] bg-[#090d16]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#4fc3f7]/20 border border-[#4fc3f7]/50 flex items-center justify-center text-[#4fc3f7]">
              <Tv className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 font-mono">DISPLAY STATIONS (WALL TVS)</h2>
              <p className="text-xs text-slate-400">
                Manage network URL TV kiosks with zero-touch auto login and power-cut recovery
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Pair New TV Box */}
          <div className="p-4 bg-[#090d16] border border-[#4fc3f7]/40 rounded-xl">
            <h3 className="text-xs font-bold text-slate-200 font-mono mb-2 flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#4fc3f7]" />
              <span>LINK NEW SMART TV / ANDROID TV STICK</span>
            </h3>
            <p className="text-[11px] text-slate-400 mb-4">
              Open <code className="text-[#4fc3f7] bg-[#111827] px-1.5 py-0.5 rounded">http://[SERVER-IP]:3000/pair</code> on your TV browser to display a 4-digit code.
            </p>

            {pairError && (
              <div className="mb-3 p-2.5 bg-red-950/60 border border-red-500/50 rounded-lg text-xs text-red-200">
                {pairError}
              </div>
            )}

            <form onSubmit={handlePair} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">4-Digit PIN</label>
                <input
                  type="text"
                  maxLength={4}
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value)}
                  placeholder="e.g. 7429"
                  required
                  className="w-full bg-[#111827] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-sm text-[#4fc3f7] font-mono font-bold text-center tracking-widest outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Display Name</label>
                <input
                  type="text"
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                  placeholder="e.g. Guard Cabin TV 1"
                  required
                  className="w-full bg-[#111827] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-xs text-slate-100 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Assigned Tour</label>
                <select
                  value={assignedTourId}
                  onChange={(e) => setAssignedTourId(e.target.value)}
                  className="w-full bg-[#111827] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-xs text-slate-100 outline-none"
                >
                  {availableTours.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isPairing || !pairingCode}
                  className="w-full py-2 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-lg shadow transition-all disabled:opacity-50"
                >
                  {isPairing ? 'Pairing...' : 'Pair Screen'}
                </button>
              </div>
            </form>
          </div>

          {/* Active Displays List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-200 font-mono">
                CONNECTED WALL DISPLAYS ({stations.length})
              </h3>
              <button
                onClick={fetchStations}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-mono"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            <div className="space-y-3">
              {stations.map((station) => (
                <div
                  key={station.id}
                  className="p-4 bg-[#090d16] border border-[#1f2937] rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        station.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-100 text-sm">{station.name}</span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                            station.isOnline
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {station.isOnline ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        Token: {station.stationKey.slice(0, 16)}... | Last Heartbeat:{' '}
                        {new Date(station.lastHeartbeat).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  {/* Remote Controls */}
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    {/* Mode Toggle: Dedicated vs Quad */}
                    <select
                      value={station.mode}
                      onChange={(e) => handleUpdateMode(station.id, e.target.value as any)}
                      className="bg-[#111827] border border-[#1f2937] text-slate-300 text-xs rounded-lg px-2.5 py-1.5 outline-none font-mono"
                    >
                      <option value="DEDICATED">Single Zone Tour (1 TV)</option>
                      <option value="QUAD_ZONE">Quad-Zone Multi-Tour (1 TV)</option>
                    </select>

                    {/* Change Tour Remotely */}
                    <select
                      value={station.assignedTourId || ''}
                      onChange={(e) => handleUpdateTour(station.id, e.target.value)}
                      className="bg-[#111827] border border-[#1f2937] text-[#4fc3f7] text-xs rounded-lg px-2.5 py-1.5 outline-none font-mono"
                    >
                      {availableTours.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => handleUnpair(station.id)}
                      title="Unpair TV"
                      className="p-2 text-slate-500 hover:text-red-400 rounded-lg hover:bg-[#111827] transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {stations.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-xs font-mono border-2 border-dashed border-[#1f2937] rounded-xl">
                  No display TVs paired yet. Open /pair on any Smart TV to link it.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DisplayStationsModal;
