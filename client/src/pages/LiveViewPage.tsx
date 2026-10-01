import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Grid2X2,
  Grid3X3,
  Square,
  RefreshCw,
  Video,
  Shield,
  Maximize,
  Minimize,
  AlertCircle,
  Film,
  Volume2,
  VolumeX,
  Users,
  Keyboard,
} from 'lucide-react';
import { LiveGrid, GridLayoutMode } from '../components/LiveGrid.js';
import { CameraStreamInfo } from '../components/LiveCameraTile.js';
import { MotionAlertBadge } from '../components/MotionAlertBadge.js';
import { EventNotificationDrawer } from '../components/EventNotificationDrawer.js';
import { EventsWsClient, EventPayload } from '../utils/events-ws-client.js';
import { useAuth } from '../context/AuthContext.js';
import { OperatorBanner } from '../components/OperatorBanner.js';
import { UserManagementModal } from '../components/UserManagementModal.js';
import { useCctvHotkeys } from '../hooks/useCctvHotkeys.js';
import { FloatingHudBadge } from '../components/FloatingHudBadge.js';
import { ChannelSwitcherModal } from '../components/ChannelSwitcherModal.js';
import { KeyboardShortcutsModal } from '../components/KeyboardShortcutsModal.js';
import { captureVideoSnapshot } from '../utils/snapshot.js';

export interface LiveViewPageProps {
  apiBaseUrl?: string;
  authToken?: string;
  layout?: GridLayoutMode;
  onLayoutChange?: (layout: GridLayoutMode) => void;
  onNavigatePlayback?: (cameraId?: string) => void;
  embedded?: boolean;
}

export const LiveViewPage: React.FC<LiveViewPageProps> = ({
  apiBaseUrl = '',
  authToken = '',
  layout: externalLayout,
  onLayoutChange,
  onNavigatePlayback,
  embedded = true,
}) => {
  const [internalLayout, setInternalLayout] = useState<GridLayoutMode>('2x2');
  const layout = externalLayout || internalLayout;
  const setLayout = onLayoutChange || setInternalLayout;

  const [cameras, setCameras] = useState<CameraStreamInfo[]>([]);
  const [assignedSlots, setAssignedSlots] = useState<(CameraStreamInfo | null)[]>([]);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Authentication & RBAC state
  const { user, token: authContextToken, isAdmin, isOperator } = useAuth();
  const effectiveToken = authToken || authContextToken || '';
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);
  const [ptzAllowedMap, setPtzAllowedMap] = useState<Map<string, boolean>>(new Map());

  // Fetch operator permissions for PTZ control check
  useEffect(() => {
    if (isAdmin) return;
    if (isOperator && user && effectiveToken) {
      fetch(`/api/auth/users/${user.id}/permissions`, {
        headers: { Authorization: `Bearer ${effectiveToken}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.permissions) {
            const map = new Map<string, boolean>();
            for (const p of data.permissions) {
              map.set(p.cameraId, Boolean(p.canControlPtz));
            }
            setPtzAllowedMap(map);
          }
        })
        .catch(() => {});
    } else {
      setPtzAllowedMap(new Map());
    }
  }, [user, isAdmin, isOperator, effectiveToken]);

  const isPtzAllowedForCamera = useCallback(
    (cameraId: string) => {
      if (isAdmin) return true;
      if (isOperator) return ptzAllowedMap.get(cameraId) ?? false;
      return false;
    },
    [isAdmin, isOperator, ptzAllowedMap]
  );

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
  }, [apiBaseUrl, effectiveToken]);

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

  const [isKioskFullscreen, setIsKioskFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const handleFsChange = () => {
      setIsKioskFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const [previousMultiLayout, setPreviousMultiLayout] = useState<GridLayoutMode>('2x2');

  const {
    isChannelSwitcherOpen,
    setIsChannelSwitcherOpen,
    isShortcutsOpen,
    setIsShortcutsOpen,
    hudBadgeText,
    triggerHud,
  } = useCctvHotkeys({
    mode: 'LIVE',
    onFocusChannel: (channelNumber) => {
      const idx = channelNumber - 1;
      if (cameras[idx]) {
        if (layout !== '1x1') {
          setPreviousMultiLayout(layout);
        }
        setLayout('1x1');
        setAssignedSlots([cameras[idx]]);
      }
    },
    onReturnToGrid: () => {
      setLayout(previousMultiLayout || '2x2');
      setAssignedSlots(cameras.slice(0, 9));
    },
    onToggleChannelSwitcher: () => {
      setIsChannelSwitcherOpen((prev) => !prev);
    },
    onToggleFullscreen: () => {
      toggleFullScreen();
    },
    onToggleShortcutsModal: () => {
      setIsShortcutsOpen((prev) => !prev);
    },
  });

  const handleSelectChannelFromModal = (cam: any, channelIndex: number) => {
    if (layout !== '1x1') {
      setPreviousMultiLayout(layout);
    }
    const targetCam = cameras.find((c) => c.cameraId === cam.id) || {
      cameraId: cam.id,
      name: cam.name,
      mediaMtxPath: '',
      whepUrl: '',
      hlsUrl: '',
    };
    setLayout('1x1');
    setAssignedSlots([targetCam]);
    triggerHud(`[ Switched: CH ${channelIndex + 1} - ${cam.name} ]`);
  };

  const handleFocusFeed = (cam: CameraStreamInfo) => {
    if (layout === '1x1' && assignedSlots[0]?.cameraId === cam.cameraId) {
      // Toggle back to multi-grid
      setLayout(previousMultiLayout || '2x2');
      setAssignedSlots(cameras.slice(0, 9));
      triggerHud('[ Restored Multi-Grid ]');
    } else {
      if (layout !== '1x1') {
        setPreviousMultiLayout(layout);
      }
      setLayout('1x1');
      setAssignedSlots([cam]);
      triggerHud(`[ Focus: ${cam.name} ]`);
    }
  };

  // Tactile frame capture with shutter screen flash animation
  const triggerCapture = useCallback(() => {
    const flash = document.createElement('div');
    flash.className = 'fixed inset-0 bg-white/20 z-[9999] pointer-events-none transition-opacity duration-150';
    document.body.appendChild(flash);
    setTimeout(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 150);
    }, 40);

    // Capture from the first visible video element
    const activeVideo = document.querySelector('video') as HTMLVideoElement | null;
    const targetName = assignedSlots[0]?.name || 'Live_Stream';
    if (activeVideo) {
      captureVideoSnapshot(activeVideo, targetName);
      triggerHud('[ Frame Captured ]');
    }
  }, [assignedSlots, triggerHud]);

  // Space hotkey listener for instant snapshot in Live view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault();
          triggerCapture();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerCapture]);

  return (
    <div className="flex flex-col flex-1 w-full h-full bg-brand text-slate-100 overflow-hidden font-sans relative">
      {/* Operator Shift Mode Banner */}
      <OperatorBanner />

      {/* Standalone Top Application Bar (only when not embedded in App.tsx) */}
      {!embedded && (
        <header className="h-13 px-4 lg:px-6 glass-bar border-b border-white/[0.07] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-md bg-zinc-900 border border-white/15 flex items-center justify-center text-white shadow-sm">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
            </div>
            <span className="font-semibold text-xs tracking-tight text-white">PRISM</span>
            <span className="text-zinc-600 text-xs">/</span>
            <span className="text-zinc-400 text-xs">Physical Security</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setLayout('2x2')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${layout === '2x2' ? 'bg-zinc-800 text-white' : 'text-zinc-400'}`}
            >
              Quad 2×2
            </button>
            <button
              onClick={() => setLayout('1x1')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${layout === '1x1' ? 'bg-zinc-800 text-white' : 'text-zinc-400'}`}
            >
              Focus
            </button>
          </div>
        </header>
      )}

      {/* Main Surveillance Canvas */}
      <main className="flex-1 p-2 md:p-3 lg:p-4 flex flex-col gap-3 max-w-[1920px] mx-auto w-full overflow-hidden relative">
        {error ? (
          <div className="flex flex-col items-center justify-center w-full h-full p-6 text-center alert-glass border border-white/10 rounded-xl my-auto">
            <AlertCircle className="w-12 h-12 text-amber-400 mb-3" />
            <h2 className="text-base font-bold text-zinc-100 mb-1">Failed to Connect to Video Server</h2>
            <p className="text-xs text-zinc-400 max-w-md mb-4">{error}</p>
            <button
              type="button"
              onClick={fetchStreamingConfig}
              className="px-5 py-2 min-h-[40px] bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs rounded-lg transition-colors shadow-lg"
            >
              Retry Connection
            </button>
          </div>
        ) : (
          <div className="flex-1 w-full h-full overflow-hidden rounded-xl border border-white/5 bg-brand">
            <LiveGrid
              layout={layout}
              cameras={cameras}
              assignedSlots={assignedSlots}
              onAssignSlot={handleAssignSlot}
              onClearSlot={handleClearSlot}
              onNavigatePlayback={onNavigatePlayback}
              activeMotionCameraIds={activeMotionCameraIds}
              canControlPtz={isPtzAllowedForCamera}
              iceServers={iceServers}
            />
          </div>
        )}
      </main>

      {/* ================= REFINED ENTERPRISE DOCK (Apple Pro / Linear) ================= */}
      <footer className="sticky bottom-4 z-40 px-4 pointer-events-none shrink-0">
        <div className="max-w-2xl mx-auto dock-glass px-3 py-1.5 rounded-xl flex items-center justify-between gap-4 pointer-events-auto">
          {/* Camera switcher chips */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar">
            <span className="text-[11px] text-zinc-500 font-medium px-1.5 hidden sm:inline select-none">
              Feeds
            </span>
            {cameras.length === 0 ? (
              <span className="text-[11px] text-zinc-600 px-2 italic">No feeds configured</span>
            ) : (
              cameras.map((c, i) => {
                const isSelected = assignedSlots[0]?.cameraId === c.cameraId && layout === '1x1';
                const hasMotion = activeMotionCameraIds.has(c.cameraId);
                return (
                  <button
                    key={c.cameraId}
                    type="button"
                    onClick={() => handleFocusFeed(c)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-all shrink-0 select-none ${
                      hasMotion
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : isSelected
                        ? 'bg-white/10 text-white border-white/20 shadow-sm'
                        : 'hover:bg-white/5 text-zinc-400 hover:text-zinc-200 border-transparent'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        hasMotion ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                      }`}
                    />
                    <span className="truncate max-w-[100px]">{c.name.split(' ')[0] || `Cam ${i + 1}`}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Audio chime mute */}
            <button
              type="button"
              onClick={() => setChimeEnabled(!chimeEnabled)}
              className="w-7 h-7 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-all"
              title={chimeEnabled ? 'Mute Alert Chime' : 'Unmute Alert Chime'}
            >
              <span className="material-symbols-outlined text-[15px]">
                {chimeEnabled ? 'volume_up' : 'volume_off'}
              </span>
            </button>

            {/* Tactile Linear / Vercel style CTA button */}
            <button
              type="button"
              id="btn-snapshot"
              onClick={triggerCapture}
              className="h-7 px-3 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium text-xs tracking-tight flex items-center gap-1.5 shadow-sm shadow-emerald-950/50 transition-all active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-[14px]">photo_camera</span>
              <span>Capture Frame</span>
              <kbd className="ml-1 px-1 py-0.2 rounded text-[10px] bg-black/15 font-mono text-zinc-950 font-semibold">
                Space
              </kbd>
            </button>

            {/* Keyboard Shortcuts Trigger */}
            <button
              type="button"
              onClick={() => setIsShortcutsOpen(true)}
              className="w-7 h-7 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-all"
              title="Keyboard Shortcuts & Jog-Shuttle"
            >
              <span className="material-symbols-outlined text-[15px]">keyboard</span>
            </button>
          </div>
        </div>
      </footer>

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

      {/* Accessible Floating HUD Badge Overlay */}
      <FloatingHudBadge text={hudBadgeText} />

      {/* Quick Channel Switcher Modal (Hotkey: G) */}
      <ChannelSwitcherModal
        isOpen={isChannelSwitcherOpen}
        onClose={() => setIsChannelSwitcherOpen(false)}
        cameras={cameras.map((c, i) => {
          let ipAddress: string | undefined;
          try {
            if (c.rtspUrl) ipAddress = new URL(c.rtspUrl).hostname;
          } catch {}
          return {
            id: c.cameraId,
            name: c.name,
            channelNumber: i + 1,
            ipAddress,
            status: 'online',
          };
        })}
        onSelectCamera={handleSelectChannelFromModal}
        activeCameraId={assignedSlots[0]?.cameraId}
      />

      {/* Keyboard Shortcuts Cheat Sheet Modal (Hotkey: ?) */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
};

export default LiveViewPage;

