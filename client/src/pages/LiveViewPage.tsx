import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Grid2X2,
  Grid3X3,
  Square,
  RefreshCw,
  Video,
  Shield,
  Maximize,
  AlertCircle,
  Film,
  Volume2,
  VolumeX,
  Users,
} from 'lucide-react';
import { LiveGrid, GridLayoutMode } from '../components/LiveGrid.js';
import { CameraStreamInfo } from '../components/LiveCameraTile.js';
import { MotionAlertBadge } from '../components/MotionAlertBadge.js';
import { EventNotificationDrawer } from '../components/EventNotificationDrawer.js';
import { EventsWsClient, EventPayload } from '../utils/events-ws-client.js';
import { useAuth } from '../context/AuthContext.js';
import { OperatorBanner } from '../components/OperatorBanner.js';
import { UserManagementModal } from '../components/UserManagementModal.js';

export interface LiveViewPageProps {
  apiBaseUrl?: string;
  authToken?: string;
  onNavigatePlayback?: () => void;
}

export const LiveViewPage: React.FC<LiveViewPageProps> = ({
  apiBaseUrl = '',
  authToken = '',
  onNavigatePlayback,
}) => {
  const [layout, setLayout] = useState<GridLayoutMode>('2x2');
  const [cameras, setCameras] = useState<CameraStreamInfo[]>([]);
  const [assignedSlots, setAssignedSlots] = useState<(CameraStreamInfo | null)[]>([]);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Authentication & RBAC state
  const { user, token: authContextToken, isAdmin, isOperator } = useAuth();
  const effectiveToken = authToken || authContextToken || '';
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);

  // Motion alerts and drawer state
  const [events, setEvents] = useState<EventPayload[]>([]);
  const [activeMotionCameraIds, setActiveMotionCameraIds] = useState<Set<string>>(new Set());
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [unreadAlertCount, setUnreadAlertCount] = useState<number>(0);
  const [chimeEnabled, setChimeEnabled] = useState<boolean>(true);

  const wsClientRef = useRef<EventsWsClient | null>(null);

  // Synthesize guard cabin notification chime (880Hz -> 1046Hz pleasant tone)
  const playGuardChime = useCallback(() => {
    if (!chimeEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // AudioContext policy might block until first user interaction
    }
  }, [chimeEnabled]);

  const fetchStreamingConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (effectiveToken) {
        headers['Authorization'] = `Bearer ${effectiveToken}`;
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

  // Connect to live WebSocket event feed
  useEffect(() => {
    let wsUrl = '';
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = apiBaseUrl ? new URL(apiBaseUrl).host : window.location.host;
      wsUrl = `${proto}//${host}/api/v1/events/feed`;
    }

    const client = new EventsWsClient({
      wsUrl,
      token: effectiveToken,
    });
    wsClientRef.current = client;

    const unsubscribe = client.subscribe((event) => {
      setEvents((prev) => [event, ...prev.slice(0, 49)]);

      if (event.type === 'motion.detected' && event.cameraId) {
        setActiveMotionCameraIds((prev) => new Set(prev).add(event.cameraId!));
        setUnreadAlertCount((c) => c + 1);
        playGuardChime();

        // Auto-clear active pulse border after 8 seconds
        setTimeout(() => {
          setActiveMotionCameraIds((prev) => {
            const next = new Set(prev);
            next.delete(event.cameraId!);
            return next;
          });
        }, 8000);
      }
    });

    client.connect();

    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, [apiBaseUrl, effectiveToken, playGuardChime]);

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

  const handleOpenDrawer = () => {
    setIsDrawerOpen(true);
    setUnreadAlertCount(0);
  };

  return (
    <div className="flex flex-col w-screen h-screen bg-[#090d16] text-slate-100 overflow-hidden font-sans">
      {/* Operator Shift Mode Banner */}
      <OperatorBanner />

      {/* Top Application Bar with Palette 1 Styling */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-[#111827] border-b border-[#1f2937] shrink-0">
        {/* Brand & System Health */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-bold tracking-tight text-sm text-slate-100">
            <div className="w-8 h-8 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#4fc3f7]" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs tracking-wider text-[#4fc3f7] font-mono">BASIC VMS</span>
              <span className="text-[10px] text-slate-400 font-normal">Security Monitoring</span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 pl-3 border-l border-[#1f2937] text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-[#4fc3f7] animate-pulse" />
            <Video className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono font-medium">
              {cameras.length} Active {cameras.length === 1 ? 'Camera' : 'Cameras'}
            </span>
          </div>
        </div>

        {/* Center Grid Mode Switcher with High-Affordance Touch Targets */}
        <div className="flex items-center gap-1.5 bg-[#090d16] p-1 rounded-lg border border-[#1f2937]">
          <button
            type="button"
            onClick={() => setLayout('1x1')}
            title="Single Camera Focus (1x1)"
            className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold transition-colors ${
              layout === '1x1'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Square className="w-4 h-4" />
            <span className="hidden sm:inline">1 Camera</span>
          </button>

          <button
            type="button"
            onClick={() => setLayout('2x2')}
            title="Quad Grid (2x2)"
            className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold transition-colors ${
              layout === '2x2'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Grid2X2 className="w-4 h-4" />
            <span className="hidden sm:inline">4 Grid (2x2)</span>
          </button>

          <button
            type="button"
            onClick={() => setLayout('3x3')}
            title="Nine Grid (3x3)"
            className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold transition-colors ${
              layout === '3x3'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Grid3X3 className="w-4 h-4" />
            <span className="hidden sm:inline">9 Grid (3x3)</span>
          </button>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Audio Chime Mute/Unmute */}
          <button
            type="button"
            onClick={() => setChimeEnabled((prev) => !prev)}
            title={chimeEnabled ? 'Guard Audio Alert Chime: ON' : 'Guard Audio Alert Chime: MUTED'}
            className={`p-2 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-md border transition-colors ${
              chimeEnabled
                ? 'bg-[#111827] text-[#4fc3f7] border-[#1f2937] hover:border-[#4fc3f7]/60'
                : 'bg-[#111827] text-slate-500 border-[#1f2937] hover:text-slate-300'
            }`}
          >
            {chimeEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Incident Alert Badge & Drawer Trigger */}
          <MotionAlertBadge
            unreadCount={unreadAlertCount}
            hasActiveMotion={activeMotionCameraIds.size > 0}
            onClick={handleOpenDrawer}
          />

          {/* Admin User & Permission Management */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setIsUserModalOpen(true)}
              title="Users & Camera Access Management"
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] bg-[#111827] hover:bg-[#1f2937] text-[#4fc3f7] border border-[#1f2937] hover:border-[#4fc3f7]/50 font-semibold text-xs rounded-md transition-all shadow-sm active:scale-95"
            >
              <Users className="w-4 h-4" />
              <span className="hidden lg:inline">Users & Access</span>
            </button>
          )}

          {/* Direct Navigate to Playback / History */}
          {onNavigatePlayback && (
            <button
              type="button"
              onClick={onNavigatePlayback}
              className="flex items-center gap-2 px-3.5 py-1.5 min-h-[38px] bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-md transition-all shadow-md active:scale-95"
            >
              <Film className="w-4 h-4" />
              <span>History</span>
            </button>
          )}

          {/* Refresh Feeds */}
          <button
            type="button"
            onClick={fetchStreamingConfig}
            title="Refresh Feeds"
            className="p-2 min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-300 hover:text-white rounded-md bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#4fc3f7]' : ''}`} />
          </button>

          {/* Fullscreen for Guard Monitors */}
          <button
            type="button"
            onClick={toggleFullScreen}
            title="Toggle Monitor Fullscreen"
            className="p-2 min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-300 hover:text-white rounded-md bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/50 transition-colors"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Grid View Area */}
      <main className="flex-1 w-full h-full relative overflow-hidden bg-[#090d16] flex">
        {error ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center">
            <AlertCircle className="w-12 h-12 text-[#fb923c] mb-3" />
            <h2 className="text-base font-bold text-slate-100 mb-1">Failed to Connect to Video Server</h2>
            <p className="text-xs text-slate-400 max-w-md mb-4">{error}</p>
            <button
              type="button"
              onClick={fetchStreamingConfig}
              className="px-5 py-2.5 min-h-[44px] bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-md transition-colors shadow-lg"
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
            activeMotionCameraIds={activeMotionCameraIds}
            iceServers={iceServers}
          />
        )}
      </main>

      {/* Event Notification Drawer */}
      <EventNotificationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        events={events}
        onClearEvents={() => setEvents([])}
        onSelectEvent={() => {
          if (onNavigatePlayback) {
            onNavigatePlayback();
          }
        }}
      />

      {/* Admin User Management Modal */}
      <UserManagementModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        availableCameras={cameras.map((c) => ({
          id: c.cameraId,
          name: c.name,
          status: 'online',
        }))}
      />
    </div>
  );
};

export default LiveViewPage;
