import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CameraStreamInfo } from '../components/LiveCameraTile.js';
import { FocusTourLayout, GuardTourConfig } from '../components/FocusTourLayout.js';
import { EventsWsClient, EventPayload } from '../utils/events-ws-client.js';
import { AlertTriangle, RefreshCw, Tv, Shield } from 'lucide-react';

export interface KioskDisplayPageProps {
  stationKey: string;
  onUnpair?: () => void;
}

interface DisplayStation {
  id: string;
  name: string;
  assignedTourId: string;
  mode: 'DEDICATED' | 'QUAD_ZONE';
}

export const KioskDisplayPage: React.FC<KioskDisplayPageProps> = ({ stationKey, onUnpair }) => {
  const [station, setStation] = useState<DisplayStation | null>(null);
  const [cameras, setCameras] = useState<CameraStreamInfo[]>([]);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [activeTour, setActiveTour] = useState<GuardTourConfig | null>(null);
  const [allTours, setAllTours] = useState<GuardTourConfig[]>([]);
  const [alarmCameraId, setAlarmCameraId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // 1. Fetch Station Configuration
  const loadStation = useCallback(async () => {
    try {
      setConnectionError(null);
      const res = await fetch(`/api/kiosk/station/${stationKey}`);
      if (!res.ok) {
        throw new Error('Invalid or revoked station token');
      }
      const data = await res.json();
      setStation(data.station);

      // Load streaming config
      const streamRes = await fetch('/api/streaming/config');
      if (streamRes.ok) {
        const streamData = await streamRes.json();
        setCameras(streamData.cameras || []);
        setIceServers(streamData.iceServers || []);
      }

      // Load tours
      const tourRes = await fetch('/api/tours');
      if (tourRes.ok) {
        const tourData = await tourRes.json();
        const tours: GuardTourConfig[] = tourData.tours || [];
        setAllTours(tours);
        const assigned = tours.find((t) => t.id === data.station.assignedTourId) || tours[0];
        setActiveTour(assigned || null);
      }
    } catch (err: any) {
      setConnectionError(err.message || 'Connecting to VMS server...');
    } finally {
      setIsLoading(false);
    }
  }, [stationKey]);

  useEffect(() => {
    loadStation();
  }, [loadStation]);

  // 2. Heartbeat & Watchdog (Every 15s)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/kiosk/heartbeat/${stationKey}`, { method: 'POST' });
        if (!res.ok) {
          // If server restarted, reload
          loadStation();
        }
      } catch {
        setConnectionError('Network connection lost. Reconnecting...');
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [stationKey, loadStation]);

  // 3. Real-time WebSocket motion feed
  useEffect(() => {
    const ws = new EventsWsClient({
      url: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/events/feed`,
      onEvent: (event: EventPayload) => {
        if (event.type === 'camera.motion' && event.cameraId) {
          setAlarmCameraId(event.cameraId);
          const t = setTimeout(() => setAlarmCameraId(null), 15000);
          return () => clearTimeout(t);
        }
      },
    });

    ws.connect();
    return () => ws.disconnect();
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#090d16] text-[#4fc3f7] font-mono text-sm">
        <RefreshCw className="w-8 h-8 animate-spin mb-3 text-[#4fc3f7]" />
        <span>INITIALIZING TV KIOSK DISPLAY...</span>
      </div>
    );
  }

  if (connectionError && !station) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#090d16] text-slate-100 p-8 text-center select-none">
        <AlertTriangle className="w-12 h-12 text-[#fb923c] mb-4 animate-bounce" />
        <h2 className="text-xl font-bold font-mono mb-2">SELF-HEALING RECONNECT ACTIVE</h2>
        <p className="text-xs text-slate-400 max-w-md mb-6">{connectionError}</p>
        <button
          onClick={loadStation}
          className="px-6 py-2.5 bg-[#4fc3f7] text-[#090d16] font-bold rounded-lg text-xs"
        >
          Retry Now
        </button>
      </div>
    );
  }

  // MODE A: QUAD_ZONE (4 Independent Carousels on 1 Single TV)
  if (station?.mode === 'QUAD_ZONE') {
    return (
      <div className="h-screen w-screen grid grid-cols-2 grid-rows-2 bg-[#090d16] gap-1.5 p-1.5 select-none overflow-hidden">
        {allTours.slice(0, 4).map((t, idx) => (
          <div key={t.id} className="relative h-full w-full border border-[#1f2937] rounded-lg overflow-hidden">
            <div className="absolute top-1 left-1 z-30 px-2 py-0.5 rounded bg-black/80 text-[10px] font-bold text-[#4fc3f7] font-mono border border-[#4fc3f7]/30">
              QUAD {idx + 1}: {t.name}
            </div>
            <FocusTourLayout
              cameras={cameras}
              tour={t}
              iceServers={iceServers}
              alarmCameraId={alarmCameraId}
            />
          </div>
        ))}
      </div>
    );
  }

  // MODE B: DEDICATED (1 Fullscreen Zone Tour edge-to-edge)
  return (
    <div className="h-screen w-screen bg-[#090d16] select-none overflow-hidden flex flex-col">
      {/* Discreet OSD Header */}
      <div className="px-3 py-1 bg-black/70 flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-[#1f2937]/50">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-200 font-bold">{station?.name}</span>
          <span className="text-slate-500">|</span>
          <span className="text-[#4fc3f7]">{activeTour?.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-yellow-400">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="flex-1 w-full h-full relative overflow-hidden">
        {activeTour ? (
          <FocusTourLayout
            cameras={cameras}
            tour={activeTour}
            iceServers={iceServers}
            alarmCameraId={alarmCameraId}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-slate-500 font-mono text-xs">
            NO ACTIVE TOUR ASSIGNED TO THIS DISPLAY
          </div>
        )}
      </div>
    </div>
  );
};

export default KioskDisplayPage;
