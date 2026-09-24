import React, { useEffect, useState, useCallback } from 'react';
import {
  Grid,
  Grid2X2,
  Grid3X3,
  Square,
  RefreshCw,
  Video,
  Shield,
  Maximize,
  AlertCircle,
} from 'lucide-react';
import { LiveGrid, GridLayoutMode } from '../components/LiveGrid.js';
import { CameraStreamInfo } from '../components/LiveCameraTile.js';

export interface LiveViewPageProps {
  apiBaseUrl?: string;
  authToken?: string;
}

export const LiveViewPage: React.FC<LiveViewPageProps> = ({
  apiBaseUrl = '',
  authToken = '',
}) => {
  const [layout, setLayout] = useState<GridLayoutMode>('2x2');
  const [cameras, setCameras] = useState<CameraStreamInfo[]>([]);
  const [assignedSlots, setAssignedSlots] = useState<(CameraStreamInfo | null)[]>([]);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStreamingConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch(`${apiBaseUrl}/api/streaming/config`, { headers });
      if (!res.ok) {
        throw new Error(`Failed to load streaming config: HTTP ${res.status}`);
      }

      const data = await res.json();
      const fetchedCameras: CameraStreamInfo[] = data.cameras || [];
      setCameras(fetchedCameras);
      setIceServers(data.iceServers || []);

      // Auto-assign first N cameras to initial slots
      setAssignedSlots((prevSlots) => {
        if (prevSlots.length > 0 && prevSlots.some(Boolean)) {
          return prevSlots;
        }
        return fetchedCameras.slice(0, 9);
      });
    } catch (err: any) {
      setError(err.message || 'Error loading live video feeds');
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    fetchStreamingConfig();
  }, [fetchStreamingConfig]);

  const handleAssignSlot = (slotIndex: number, camera: CameraStreamInfo) => {
    setAssignedSlots((prev) => {
      const updated = [...prev];
      updated[slotIndex] = camera;
      return updated;
    });
  };

  const handleClearSlot = (slotIndex: number) => {
    setAssignedSlots((prev) => {
      const updated = [...prev];
      updated[slotIndex] = null;
      return updated;
    });
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="flex flex-col w-screen h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Top Application Bar */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold tracking-tight text-sm text-zinc-100">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span>BASIC VMS</span>
          </div>
          <span className="text-zinc-600">|</span>
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <Video className="w-3.5 h-3.5 text-zinc-500" />
            <span>{cameras.length} Active {cameras.length === 1 ? 'Camera' : 'Cameras'}</span>
          </div>
        </div>

        {/* Center Grid Mode Switcher */}
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800">
          <button
            type="button"
            onClick={() => setLayout('1x1')}
            title="Single Camera (1x1)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              layout === '1x1'
                ? 'bg-zinc-800 text-white font-medium shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">1x1</span>
          </button>

          <button
            type="button"
            onClick={() => setLayout('2x2')}
            title="Quad Grid (2x2)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              layout === '2x2'
                ? 'bg-zinc-800 text-white font-medium shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Grid2X2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">2x2</span>
          </button>

          <button
            type="button"
            onClick={() => setLayout('3x3')}
            title="Nine Grid (3x3)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              layout === '3x3'
                ? 'bg-zinc-800 text-white font-medium shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">3x3</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchStreamingConfig}
            title="Refresh Feeds"
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={toggleFullScreen}
            title="Toggle Fullscreen"
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Grid View Area */}
      <main className="flex-1 w-full h-full relative overflow-hidden bg-black flex">
        {error ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center">
            <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
            <h2 className="text-base font-semibold text-zinc-200 mb-1">Failed to Connect to Media Plane</h2>
            <p className="text-xs text-zinc-400 max-w-md mb-4">{error}</p>
            <button
              type="button"
              onClick={fetchStreamingConfig}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium rounded text-zinc-100 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        ) : (
          <LiveGrid
            layout={layout}
            cameras={cameras}
            assignedSlots={assignedSlots}
            onAssignSlot={handleAssignSlot}
            onClearSlot={handleClearSlot}
            iceServers={iceServers}
          />
        )}
      </main>
    </div>
  );
};

export default LiveViewPage;
