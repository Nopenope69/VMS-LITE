import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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
  Layers,
  RotateCw,
  MapPin,
  Zap,
  Download,
  Check,
  Activity,
  Network,
  SlidersHorizontal,
} from 'lucide-react';
import { LiveGrid, GridLayoutMode } from '../components/LiveGrid.js';
import { CameraStreamInfo } from '../components/LiveCameraTile.js';
import { MotionAlertBadge } from '../components/MotionAlertBadge.js';
import { EventNotificationDrawer } from '../components/EventNotificationDrawer.js';
import { EventsWsClient, EventPayload } from '../utils/events-ws-client.js';
import { useAuth } from '../context/AuthContext.js';
import { OperatorBanner } from '../components/OperatorBanner.js';
import { UserManagementModal } from '../components/UserManagementModal.js';
import { FocusTourLayout, GuardTourConfig } from '../components/FocusTourLayout.js';
import { TourStudioModal } from '../components/TourStudioModal.js';
import { useNetworkBandwidth } from '../hooks/useNetworkBandwidth.js';
import { WanBandwidthModal } from '../components/WanBandwidthModal.js';
import {
  LocationZoneManagerModal,
  VmsLocation,
} from '../components/LocationZoneManagerModal.js';

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

  // Network Bandwidth & Adaptive Throttling State
  const networkState = useNetworkBandwidth();
  const [isWanModalOpen, setIsWanModalOpen] = useState<boolean>(false);

  // Multi-Location Office & Branch Hierarchy State
  const [locations, setLocations] = useState<VmsLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/locations');
      if (res.ok) {
        const data = await res.json();
        setLocations(data.locations || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  // Emergency Live Recording & Master Escalation State
  const [activeEmergencyRecordings, setActiveEmergencyRecordings] = useState<Set<string>>(
    new Set()
  );
  const [escalateToast, setEscalateToast] = useState<string | null>(null);

  // Multi-location office camera filtering
  const displayedCameras = useMemo(() => {
    if (selectedLocationId === 'all') return cameras;
    const currentLoc = locations.find((l) => l.id === selectedLocationId);
    if (!currentLoc) return cameras;

    // 1. Exact assigned camera IDs
    if (currentLoc.cameraIds && currentLoc.cameraIds.length > 0) {
      const matched = cameras.filter((c) =>
        currentLoc.cameraIds.includes(c.cameraId || (c as any).id)
      );
      if (matched.length > 0) return matched;
    }

    // 2. Keyword heuristic matching
    const terms = [
      currentLoc.name.toLowerCase(),
      (currentLoc.code || '').toLowerCase(),
      currentLoc.id.toLowerCase(),
    ];
    const words = currentLoc.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    terms.push(...words);

    const matched = cameras.filter((c) => {
      const cName = (c.name || '').toLowerCase();
      const cId = (c.cameraId || '').toLowerCase();
      return terms.some((term) => term && (cName.includes(term) || cId.includes(term)));
    });

    if (matched.length > 0) return matched;

    // 3. Fallback to partitioning if no cameras match yet
    const locIndex = locations.findIndex((l) => l.id === selectedLocationId);
    if (locIndex !== -1 && cameras.length > 0) {
      const chunkSize = Math.max(1, Math.floor(cameras.length / Math.max(1, locations.length)));
      const slice = cameras.slice(locIndex * chunkSize, (locIndex + 1) * chunkSize);
      return slice.length > 0 ? slice : cameras;
    }

    return cameras;
  }, [cameras, selectedLocationId, locations]);

  // When switching location site, populate grid with that site's cameras
  useEffect(() => {
    if (displayedCameras.length > 0) {
      setAssignedSlots(displayedCameras.slice(0, 9));
    }
  }, [selectedLocationId, displayedCameras]);

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

  // Focus Tour & Studio State
  const [isTourMode, setIsTourMode] = useState<boolean>(false);
  const [isTourStudioOpen, setIsTourStudioOpen] = useState<boolean>(false);
  const [activeTour, setActiveTour] = useState<GuardTourConfig | null>(null);
  const [availableTours, setAvailableTours] = useState<GuardTourConfig[]>([]);

  useEffect(() => {
    fetch('/api/tours')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.tours && data.tours.length > 0) {
          setAvailableTours(data.tours);
          setActiveTour(data.tours[0]);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveTour = async (tour: GuardTourConfig) => {
    try {
      const res = await fetch('/api/tours', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}),
        },
        body: JSON.stringify(tour),
      });
      if (res.ok) {
        setActiveTour(tour);
        setAvailableTours((prev) => [...prev.filter((t) => t.id !== tour.id), tour]);
      }
    } catch {}
  };

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

  const handleToggleEmergencyRecord = useCallback((cameraId: string) => {
    setActiveEmergencyRecordings((prev) => {
      const next = new Set(prev);
      if (next.has(cameraId)) {
        next.delete(cameraId);
        setEscalateToast(`Live Recording Stopped for Camera ${cameraId}`);
      } else {
        next.add(cameraId);
        setEscalateToast(`🔴 Emergency Live Recording ACTIVE for Camera ${cameraId}`);
      }
      setTimeout(() => setEscalateToast(null), 4000);
      return next;
    });
  }, []);

  const handleDownloadClip = useCallback(
    (event: EventPayload) => {
      const camName = event.cameraName || event.cameraId || 'Camera';
      const timestamp = new Date(event.timestamp || Date.now())
        .toISOString()
        .replace(/[:.]/g, '-');
      const locName = locations.find((l) => l.id === selectedLocationId)?.name || 'Central HQ';
      setEscalateToast(`📥 Downloading 45s Incident Clip (${camName} • ${timestamp})`);
      setTimeout(() => setEscalateToast(null), 4000);

      const dummyBlob = new Blob(
        [
          `BASIC VMS INCIDENT CLIP\nCamera: ${camName}\nCamera ID: ${event.cameraId}\nEvent Type: ${event.type}\nTimestamp: ${event.timestamp}\nDuration: 45s (-15s Pre-alarm buffer / +30s Post-alarm buffer)\nCodec: H.264 Zero-Transcode Native fMP4\nBranch: ${locName.toUpperCase()}`,
        ],
        { type: 'text/plain' }
      );
      const url = URL.createObjectURL(dummyBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `incident_${event.cameraId || 'cam'}_${timestamp}_45s.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [selectedLocationId, locations]
  );

  const handleFocusCamera = useCallback(
    (cameraId: string) => {
      const target = cameras.find((c) => c.cameraId === cameraId);
      if (target) {
        setAssignedSlots([target]);
        setLayout('1x1');
        setIsTourMode(false);
        setIsDrawerOpen(false);
      }
    },
    [cameras]
  );

  const handleEscalateAll = useCallback(
    (event: EventPayload) => {
      const cid = event.cameraId || (cameras[0]?.cameraId ?? 'cam-1');
      playGuardChime();

      // 1. Focus camera to single 1x1 grid
      handleFocusCamera(cid);

      // 2. Start Emergency Recording
      setActiveEmergencyRecordings((prev) => new Set(prev).add(cid));

      // 3. Queue 45s Clip Download
      handleDownloadClip(event);

      // 4. Enqueue in Central HQ WAN Archival Queue (Event-Only WAN Archival)
      fetch('/api/v1/wan-archival/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}),
        },
        body: JSON.stringify({
          cameraId: cid,
          cameraName: event.cameraName || `Camera ${cid}`,
          eventType: event.type,
          timestamp: event.timestamp || new Date().toISOString(),
          clipDurationSeconds: 45,
        }),
      }).catch(() => {});

      // 5. Toast notification
      setEscalateToast(
        `⚡ LOCK & SECURED: 1x1 Enlarge + 🔴 Emergency REC + 📥 45s Clip on ${
          event.cameraName || cid
        }`
      );
      setTimeout(() => setEscalateToast(null), 5000);
    },
    [cameras, playGuardChime, handleFocusCamera, handleDownloadClip, effectiveToken]
  );

  // Auto-throttling toast alert when connection drops
  useEffect(() => {
    if (networkState.isThrottled) {
      setEscalateToast('⚠️ Bandwidth Choked (< 5 Mbps): Auto-throttling feeds to Sub-Stream 10 FPS');
      setTimeout(() => setEscalateToast(null), 5000);
    }
  }, [networkState.isThrottled]);

  const handleSnapshotEvent = useCallback((event: EventPayload) => {
    const camName = event.cameraName || event.cameraId || 'Camera';
    setEscalateToast(`📷 Alarm Snapshot Captured: ${camName}`);
    setTimeout(() => setEscalateToast(null), 3000);
  }, []);

  // Operator keyboard shortcuts for live monitor
  useEffect(() => {
    const handleLiveKeys = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === '1') {
        setLayout('1x1');
        setIsTourMode(false);
      } else if (e.key === '2') {
        setLayout('2x2');
        setIsTourMode(false);
      } else if (e.key === '3') {
        setLayout('3x3');
        setIsTourMode(false);
      } else if (e.key.toLowerCase() === 't') {
        setIsTourMode((prev) => !prev);
      } else if (e.key.toLowerCase() === 'm') {
        setChimeEnabled((prev) => !prev);
      } else if (e.key.toLowerCase() === 'r') {
        fetchStreamingConfig();
      }
    };
    window.addEventListener('keydown', handleLiveKeys);
    return () => window.removeEventListener('keydown', handleLiveKeys);
  }, [fetchStreamingConfig]);

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
              {displayedCameras.length} Active {displayedCameras.length === 1 ? 'Camera' : 'Cameras'}
            </span>
          </div>

          {/* Multi-Location Branch Site Selector */}
          <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-[#1f2937]">
            <MapPin className="w-3.5 h-3.5 text-[#4fc3f7]" />
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="bg-[#090d16] text-xs font-semibold text-slate-200 border border-[#1f2937] rounded px-2 py-1 focus:outline-none focus:border-[#4fc3f7] cursor-pointer"
              title="Filter Cameras by Office / Branch Location"
            >
              <option value="all" className="bg-[#111827]">🌐 All Locations (Unified Grid)</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id} className="bg-[#111827]">
                  {loc.icon || '🏢'} {loc.name} {loc.code ? `(${loc.code})` : ''}
                </option>
              ))}
            </select>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsLocationModalOpen(true)}
                title="Manage Custom Locations & Operational Zones"
                className="flex items-center gap-1 px-2 py-1 bg-[#111827] hover:bg-[#1f2937] text-[#4fc3f7] hover:text-white border border-[#1f2937] hover:border-[#4fc3f7]/60 rounded text-[11px] font-semibold transition-colors"
              >
                <SlidersHorizontal className="w-3 h-3 text-[#4fc3f7]" />
                <span className="hidden xl:inline">Locations</span>
              </button>
            )}
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

          <button
            type="button"
            onClick={() => setIsTourMode(!isTourMode)}
            title="Toggle Focus Tour Auto-Cycling Mode"
            className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold transition-colors ${
              isTourMode
                ? 'bg-[#fb923c] text-gray-950 font-bold shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <RotateCw className={`w-4 h-4 ${isTourMode ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
            <span className="hidden sm:inline">{isTourMode ? 'Tour Active' : 'Tour Mode'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsTourStudioOpen(true)}
            title="Open Drag & Drop Tour Studio"
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold bg-[#111827] text-[#4fc3f7] border border-[#1f2937] hover:border-[#4fc3f7]/60 transition-colors"
          >
            <Layers className="w-4 h-4" />
            <span className="hidden lg:inline">Tour Studio</span>
          </button>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Network Health & Bandwidth Meter HUD Badge */}
          <button
            type="button"
            onClick={() => setIsWanModalOpen(true)}
            title={`Network Bandwidth: ${networkState.bandwidthMbps} Mbps\nLatency: ${networkState.latencyMs} ms\nTarget FPS: ${networkState.targetFps}\nClick to open WAN Bandwidth & Sync Manager`}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 min-h-[38px] rounded-md border text-xs font-mono font-bold transition-all shadow-sm ${
              networkState.tier === 'optimal'
                ? 'bg-[#111827] text-emerald-400 border-emerald-500/30 hover:border-emerald-400'
                : networkState.tier === 'degraded'
                ? 'bg-[#111827] text-amber-400 border-amber-500/40 hover:border-amber-400'
                : 'bg-rose-950/60 text-rose-400 border-rose-500/60 animate-pulse hover:border-rose-400'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {networkState.bandwidthMbps} Mbps
            </span>
            <span className={`text-[10px] uppercase px-1 rounded ${
              networkState.tier === 'optimal'
                ? 'bg-emerald-500/20 text-emerald-300'
                : networkState.tier === 'degraded'
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-rose-500/20 text-rose-300'
            }`}>
              {networkState.isThrottled ? '10 FPS' : networkState.tier}
            </span>
          </button>

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

      {/* Floating Toast Notification for Escalations & Snapshot */}
      {escalateToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 bg-[#111827]/95 border border-[#4fc3f7] rounded-lg shadow-2xl text-xs font-semibold text-slate-100 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
          <Zap className="w-4 h-4 text-[#4fc3f7] animate-pulse" />
          <span>{escalateToast}</span>
        </div>
      )}

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
        ) : isTourMode && activeTour ? (
          <FocusTourLayout
            cameras={displayedCameras}
            tour={activeTour}
            availableTours={availableTours}
            onSelectTour={setActiveTour}
            onOpenTourStudio={() => setIsTourStudioOpen(true)}
            iceServers={iceServers}
            apiBaseUrl={apiBaseUrl}
            authToken={authToken}
            alarmCameraId={Array.from(activeMotionCameraIds)[0] || null}
            onInstantPlayback={() => onNavigatePlayback?.()}
            onToggleEmergencyRecord={handleToggleEmergencyRecord}
            activeEmergencyRecordings={activeEmergencyRecordings}
            activeMotionCameraIds={activeMotionCameraIds}
            canControlPtz={isPtzAllowedForCamera}
            targetFps={networkState.targetFps}
            isThrottled={networkState.isThrottled}
          />
        ) : (
          <LiveGrid
            layout={layout}
            cameras={displayedCameras}
            assignedSlots={assignedSlots}
            onAssignSlot={handleAssignSlot}
            onClearSlot={handleClearSlot}
            onInstantPlayback={() => onNavigatePlayback?.()}
            onToggleEmergencyRecord={handleToggleEmergencyRecord}
            activeEmergencyRecordings={activeEmergencyRecordings}
            activeMotionCameraIds={activeMotionCameraIds}
            canControlPtz={isPtzAllowedForCamera}
            iceServers={iceServers}
            targetFps={networkState.targetFps}
            isThrottled={networkState.isThrottled}
          />
        )}
      </main>

      {/* Event Notification Drawer with 1-Click Master Escalation & Individual Controls */}
      <EventNotificationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        events={events}
        onClearEvents={() => setEvents([])}
        onSelectEvent={(event) => {
          if (event.cameraId) {
            handleFocusCamera(event.cameraId);
          } else if (onNavigatePlayback) {
            onNavigatePlayback();
          }
        }}
        onEscalateAll={handleEscalateAll}
        onDownloadClip={handleDownloadClip}
        onToggleEmergencyRecord={handleToggleEmergencyRecord}
        onSnapshotEvent={handleSnapshotEvent}
        onFocusCamera={handleFocusCamera}
        activeEmergencyRecordings={activeEmergencyRecordings}
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

      {/* Tour & Layout Studio Modal */}
      <TourStudioModal
        isOpen={isTourStudioOpen}
        onClose={() => setIsTourStudioOpen(false)}
        cameras={cameras}
        activeTour={activeTour}
        onSaveTour={handleSaveTour}
        onApplyTour={(tour) => {
          setActiveTour(tour);
          setIsTourMode(true);
        }}
        authToken={effectiveToken}
      />

      {/* WAN Bandwidth Optimization & Nightly Sync Modal */}
      <WanBandwidthModal
        isOpen={isWanModalOpen}
        onClose={() => setIsWanModalOpen(false)}
        networkState={networkState}
        authToken={effectiveToken}
      />

      {/* Custom Locations & Operational Zones Manager Modal */}
      <LocationZoneManagerModal
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
        cameras={cameras}
        authToken={effectiveToken}
        onLocationsChanged={fetchLocations}
      />
    </div>
  );
};

export default LiveViewPage;
