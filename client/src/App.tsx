import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield,
  RefreshCw,
  Info,
  Search,
  X,
  Plus,
} from 'lucide-react';
import { useAuth, UserRole } from './context/AuthContext.js';
import { Sidebar } from './components/Sidebar.js';
import { OverviewView } from './views/OverviewView.js';
import { LiveView } from './views/LiveView.js';
import { CameraFocusedView } from './views/CameraFocusedView.js';
import { CamerasListView } from './views/CamerasListView.js';
import { EventsView } from './views/EventsView.js';
import { HealthView } from './views/HealthView.js';
import { SettingsView } from './views/SettingsView.js';
import { PlaybackPage } from './pages/PlaybackPage.js';
import { useCameraHealth, CameraHealthTelemetry } from './hooks/useCameraHealth.js';
import { UserManagementModal } from './components/UserManagementModal.js';
import { NotificationSettingsModal } from './components/NotificationSettingsModal.js';
import { MotionZoneEditorModal } from './components/MotionZoneEditorModal.js';
import { CameraOnboardingWizardModal } from './components/CameraOnboardingWizardModal.js';
import { OperationalSettingsModal } from './components/OperationalSettingsModal.js';
import { FirstBootWizardModal } from './components/FirstBootWizardModal.js';
import { AuditLogViewerModal } from './components/AuditLogViewerModal.js';
import { BookmarkModal } from './components/BookmarkModal.js';
import { ClipExportModal } from './components/ClipExportModal.js';
import { BackupRestoreModal } from './components/BackupRestoreModal.js';
import { EventsWsClient, EventPayload } from './utils/events-ws-client.js';
import { SitesModal } from './components/SitesModal.js';
import { ALL_SITES, SiteFilter, SiteSummary, matchesSiteFilter } from './types/sites.js';

const SITE_FILTER_KEY = 'vms_site_filter';
function readStoredSiteFilter(): SiteFilter {
  try {
    return localStorage.getItem(SITE_FILTER_KEY) || ALL_SITES;
  } catch {
    return ALL_SITES;
  }
}

export type ViewType =
  | 'overview'
  | 'live'
  | 'camera'
  | 'cameras'
  | 'events'
  | 'recordings'
  | 'health'
  | 'settings';

export interface CameraRecord {
  id: string;
  name: string;
  siteId?: string | null;
  ipAddress: string;
  mediaMtxPath?: string;
  /** Authenticated media-proxy URLs from /api/streaming/config */
  whepUrl?: string;
  hlsUrl?: string;
  subStreamWhepUrl?: string | null;
  subStreamHlsUrl?: string | null;
  rtspPort?: number;
  onvifPort?: number;
  streamPath: string;
  manufacturer?: string;
  model?: string;
  status: string;
  createdAt: string;
}

export const App: React.FC = () => {
  const { user, token, role, isAdmin, isOperator, isLoading: isAuthLoading, login, logout, handleUnauthorized } = useAuth();

  // Navigation state
  const [currentView, setCurrentView] = useState<ViewType>('overview');
  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);
  const [isQuickSearchOpen, setIsQuickSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState<boolean>(false);
  const [isOperationalSettingsOpen, setIsOperationalSettingsOpen] = useState<boolean>(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState<boolean>(false);
  const [isFirstBootModalOpen, setIsFirstBootModalOpen] = useState<boolean>(false);
  const [selectedCameraForZones, setSelectedCameraForZones] = useState<CameraRecord | null>(null);
  const [isAddCameraModalOpen, setIsAddCameraModalOpen] = useState<boolean>(false);

  // Focus View action modals
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState<boolean>(false);
  const [bookmarkCameraId, setBookmarkCameraId] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [exportCameraId, setExportCameraId] = useState<string | null>(null);

  // Data states
  const [cameras, setCameras] = useState<CameraRecord[]>([]);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [playbackCameraId, setPlaybackCameraId] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [siteFilter, setSiteFilterState] = useState<SiteFilter>(readStoredSiteFilter);
  const [isSitesModalOpen, setIsSitesModalOpen] = useState<boolean>(false);
  const setSiteFilter = useCallback((value: SiteFilter) => {
    setSiteFilterState(value);
    try {
      localStorage.setItem(SITE_FILTER_KEY, value);
    } catch {
      // Storage unavailable (private mode); the filter still applies for this session
    }
  }, []);
  const [events, setEvents] = useState<EventPayload[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // Camera health telemetry polling (15s)
  const { healthMap, summary: healthSummary, refresh: refreshHealth } = useCameraHealth({
    intervalMs: 15000,
    enabled: Boolean(token),
  });

  // Login form state
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Global ⌘K shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsQuickSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch cameras roster
  const fetchCameras = useCallback(async () => {
    if (!token) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [res, streamingRes] = await Promise.all([
        fetch('/api/cameras', { headers }),
        fetch('/api/streaming/config', { headers }),
      ]);
      if (res.status === 401) {
        handleUnauthorized(token);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const raw = Array.isArray(data) ? data : data.cameras || [];

        // Live URLs (WHEP/HLS via the authenticated media proxy) and ICE servers
        const streams = new Map<string, any>();
        if (streamingRes.ok) {
          const streaming = await streamingRes.json();
          for (const info of streaming.cameras || []) streams.set(info.cameraId, info);
          setIceServers(streaming.iceServers || []);
        }

        const normalized: CameraRecord[] = raw.map((c: any) => {
          const stream = streams.get(c.id);
          return {
            ...c,
            name: c.name || 'Camera',
            ipAddress: c.ipAddress || c.ip || '',
            streamPath: c.streamPath || c.mediaMtxPath || c.id || '',
            status: c.status || 'UNKNOWN',
            createdAt: c.createdAt || new Date().toISOString(),
            whepUrl: stream?.whepUrl,
            hlsUrl: stream?.hlsUrl,
            subStreamWhepUrl: stream?.subStreamWhepUrl ?? null,
            subStreamHlsUrl: stream?.subStreamHlsUrl ?? null,
          };
        });
        setCameras(normalized);
      }
    } catch (err) {
      console.warn('[App] Failed to fetch cameras:', err);
    }
  }, [token, handleUnauthorized]);

  // Check initial first-boot setup status
  useEffect(() => {
    if (!token || !isAdmin) return;
    fetch('/api/system/setup-status')
      .then((r) => r.json())
      .then((data) => {
        if (data.isFirstBoot || data.defaultPasswordActive) {
          setIsFirstBootModalOpen(true);
        }
      })
      .catch(() => {});
  }, [token, isAdmin]);

  // Fetch recent events
  const fetchEvents = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/events?limit=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.events || [];
        setEvents(list);
      }
    } catch (err) {
      console.warn('[App] Failed to fetch events:', err);
    }
  }, [token]);

  // Initial data load upon authentication
  useEffect(() => {
    if (token) {
      fetchCameras();
      fetchEvents();
      refreshHealth();
    }
  }, [token, fetchCameras, fetchEvents, refreshHealth]);

  // Real-time Event Stream via WebSocket
  useEffect(() => {
    if (!token) return;

    // Default URL is the server's feed endpoint (/api/events/feed) on this origin
    const wsClient = new EventsWsClient({ token });

    wsClient.connect();

    const unsubscribe = wsClient.subscribe((event: EventPayload) => {
      setEvents((prev) => [event, ...prev.slice(0, 99)]);
      setUnreadCount((c) => c + 1);

      // Refresh health if camera online/offline event occurs
      if (event.type === 'camera.offline' || event.type === 'camera.online') {
        refreshHealth();
      }
    });

    return () => {
      unsubscribe();
      wsClient.disconnect();
    };
  }, [token, refreshHealth]);

  // Handle Login submission
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.message || 'Invalid username or password');
      }

      const data = await res.json();
      login(data.token, data.user);
    } catch (err: any) {
      setLoginError(err.message || 'Login failed. Please check backend connection.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Sites (with live per-site health), refreshed with camera health
  const fetchSites = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/sites', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setSites((await res.json()).sites || []);
    } catch (err) {
      console.warn('[App] Failed to fetch sites:', err);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchSites();
    const timer = setInterval(fetchSites, 15000);
    return () => clearInterval(timer);
  }, [token, fetchSites]);

  // A remembered filter for a site that no longer exists falls back to all sites
  useEffect(() => {
    if (siteFilter === ALL_SITES || sites.length === 0) return;
    if (!sites.some((site) => (site.id ?? 'unassigned') === siteFilter)) setSiteFilter(ALL_SITES);
  }, [sites, siteFilter, setSiteFilter]);

  // Everything below works on the selected site's cameras
  const siteCameras = useMemo(
    () => cameras.filter((c) => matchesSiteFilter(c.siteId, siteFilter)),
    [cameras, siteFilter]
  );
  const siteEvents = useMemo(() => {
    if (siteFilter === ALL_SITES) return events;
    const ids = new Set(siteCameras.map((c) => c.id));
    // System events (no camera) stay visible
    return events.filter((e) => !e.cameraId || ids.has(e.cameraId));
  }, [events, siteCameras, siteFilter]);

  // Online / Offline count calculations (live health, for the selected site)
  const onlineCount = useMemo(
    () => siteCameras.filter((c) => healthMap[c.id]?.status === 'ONLINE').length,
    [siteCameras, healthMap]
  );

  const offlineCount = Math.max(0, siteCameras.length - onlineCount);

  // Active focused camera
  const focusedCamera = useMemo(() => {
    if (focusedCameraId) {
      const match = cameras.find((c) => c.id === focusedCameraId);
      if (match) return match;
    }
    return siteCameras[0] || null;
  }, [cameras, siteCameras, focusedCameraId]);

  // If loading auth session
  if (isAuthLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#090a0f] text-zinc-400 font-sans">
        <div className="text-center flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-emerald-400 shadow-md">
            <RefreshCw size={18} className="animate-spin" />
          </div>
          <p className="text-xs font-mono tracking-widest text-zinc-500">INITIALIZING VMS-LITE...</p>
        </div>
      </div>
    );
  }

  // If unauthenticated: VMS-LITE Login View
  if (!token) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#090a0f] p-4 relative overflow-hidden select-none font-sans">
        {/* Ambient subtle glow background */}
        <div className="absolute w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[140px] pointer-events-none -top-40 -left-40" />

        <div className="max-w-[380px] w-full bg-[#111318] border border-white/10 rounded-2xl p-7 shadow-2xl relative z-10">
          <div className="text-center mb-6">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/15 mx-auto flex items-center justify-center text-white shadow-md mb-3">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <h1 className="text-lg font-bold text-white tracking-tight">VMS-LITE</h1>
            <p className="text-xs text-zinc-400 mt-1 font-normal">Physical Security OS · Core Control</p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center font-medium">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                Username
              </label>
              <input
                type="text"
                required
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="admin"
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs rounded-lg transition-all shadow-md shadow-emerald-950/50 flex items-center justify-center gap-2 disabled:opacity-50 mt-2 active:scale-[0.99]"
            >
              {isLoggingIn && <RefreshCw size={14} className="animate-spin" />}
              {isLoggingIn ? 'Authenticating...' : 'Sign In to Console'}
            </button>
          </form>

        </div>
      </div>
    );
  }

  // Filtered cameras for ⌘K Quick Search
  const filteredCameras = siteCameras.filter((c) => {
    const q = searchQuery.toLowerCase();
    const name = (c.name || '').toLowerCase();
    const ip = (c.ipAddress || (c as any).ip || '').toLowerCase();
    return name.includes(q) || ip.includes(q);
  });

  return (
    <div className="flex h-screen w-screen bg-[#090a0f] text-zinc-200 overflow-hidden font-sans">
      {/* ================= PRIMARY SIDEBAR (Linear / Raycast Style) ================= */}
      <Sidebar
        currentView={currentView}
        onNavigate={(view) => {
          if (view !== 'camera') {
            setFocusedCameraId(null);
          }
          if (view === 'events') {
            setUnreadCount(0);
          }
          setCurrentView(view);
        }}
        onlineCount={onlineCount}
        totalCount={siteCameras.length}
        sites={sites}
        siteFilter={siteFilter}
        onSiteFilterChange={setSiteFilter}
        unreadEventsCount={unreadCount}
        userName={user?.username || 'Admin'}
        userRole={role || 'Administrator'}
        onLogout={logout}
      />

      {/* ================= MAIN CONTENT CANVAS ================= */}
      <main className="flex-1 h-screen overflow-y-auto flex flex-col bg-[#090a0f] relative">
        {/* 1. Overview */}
        {currentView === 'overview' && (
          <OverviewView
            cameras={siteCameras}
            events={siteEvents}
            healthMap={healthMap}
            sites={sites}
            siteFilter={siteFilter}
            onSelectSite={setSiteFilter}
            onlineCount={onlineCount}
            offlineCount={offlineCount}
            onNavigate={(v) => setCurrentView(v)}
            onSelectCamera={(id) => {
              setFocusedCameraId(id);
              setCurrentView('camera');
            }}
          />
        )}

        {/* 2. Live Grid */}
        {currentView === 'live' && (
          <LiveView
            cameras={siteCameras
              .filter((c) => c.whepUrl || c.hlsUrl)
              .map((c) => ({
                cameraId: c.id,
                name: c.name,
                mediaMtxPath: c.mediaMtxPath || c.streamPath,
                whepUrl: c.whepUrl || '',
                hlsUrl: c.hlsUrl || '',
                subStreamWhepUrl: c.subStreamWhepUrl,
                subStreamHlsUrl: c.subStreamHlsUrl,
              }))}
            iceServers={iceServers}
            healthMap={healthMap}
            onlineCount={onlineCount}
            onSelectCamera={(id) => {
              setFocusedCameraId(id);
              setCurrentView('camera');
            }}
          />
        )}

        {/* 3. Focused Camera */}
        {currentView === 'camera' && (
          focusedCamera ? (
            <CameraFocusedView
              camera={focusedCamera}
              iceServers={iceServers}
              health={healthMap[focusedCamera.id] ?? null}
              onOpenPlayback={(id) => {
                setPlaybackCameraId(id);
                setCurrentView('recordings');
              }}
              onBack={() => setCurrentView('live')}
              onOpenBookmark={(id) => {
                setBookmarkCameraId(id);
                setIsBookmarkModalOpen(true);
              }}
              onOpenExport={(id) => {
                setExportCameraId(id);
                setIsExportModalOpen(true);
              }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <p className="text-sm text-zinc-400">No camera available.</p>
              <button
                type="button"
                onClick={() => setCurrentView('live')}
                className="mt-4 px-3 py-1.5 rounded-lg bg-white/[0.04] text-xs text-white hover:bg-white/[0.08]"
              >
                Return to Live
              </button>
            </div>
          )
        )}

        {/* 4. Cameras List */}
        {currentView === 'cameras' && (
          <CamerasListView
            cameras={siteCameras}
            healthMap={healthMap}
            sites={sites}
            groupBySite={siteFilter === ALL_SITES}
            onMoveCamera={async (cameraId, siteId) => {
              const res = await fetch(`/api/cameras/${cameraId}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId }),
              });
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                window.alert(data.message || 'Failed to move camera');
              }
              await Promise.all([fetchCameras(), fetchSites()]);
            }}
            isAdmin={isAdmin}
            onSelectCamera={(id) => {
              setFocusedCameraId(id);
              setCurrentView('camera');
            }}
            onOpenAddCamera={() => setIsAddCameraModalOpen(true)}
            onOpenMotionZones={(camera) => setSelectedCameraForZones(camera)}
          />
        )}

        {/* 5. Events */}
        {currentView === 'events' && (
          <EventsView
            cameras={siteCameras}
            events={siteEvents}
            onSelectCamera={(id) => {
              setFocusedCameraId(id);
              setCurrentView('camera');
            }}
          />
        )}

        {/* 6. Recordings (Synchronized Multi-Lane Playback) */}
        {currentView === 'recordings' && (
          <div className="flex-1 h-full flex flex-col overflow-hidden">
            <PlaybackPage
              authToken={token || ''}
              siteFilter={siteFilter}
              initialCameraId={playbackCameraId ?? undefined}
              onNavigateLive={() => setCurrentView('live')}
            />
          </div>
        )}

        {/* 7. Health */}
        {currentView === 'health' && (
          <HealthView
            cameras={siteCameras}
            healthMap={healthMap}
            onlineCount={onlineCount}
            offlineCount={offlineCount}
            onRefreshHealth={refreshHealth}
            onSelectCamera={(id) => {
              setFocusedCameraId(id);
              setCurrentView('camera');
            }}
          />
        )}

        {/* 8. Settings */}
        {currentView === 'settings' && (
          <SettingsView
            isAdmin={isAdmin}
            onOpenOperationalSettings={() => setIsOperationalSettingsOpen(true)}
            onOpenNotificationSettings={() => setIsNotificationModalOpen(true)}
            onOpenUserManagement={() => setIsUserModalOpen(true)}
            onOpenAuditLogs={() => setIsAuditModalOpen(true)}
            onOpenBackupRestore={() => setIsBackupModalOpen(true)}
            onOpenSites={() => setIsSitesModalOpen(true)}
          />
        )}
      </main>

      {/* ================= ⌘K COMMAND PALETTE ================= */}
      {isQuickSearchOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-24 p-4"
          onClick={() => setIsQuickSearchOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[#111318] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center px-4 border-b border-white/10">
              <Search className="w-4 h-4 text-zinc-500 mr-2 shrink-0" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Jump to camera, view, or action..."
                className="w-full bg-transparent py-3.5 text-xs text-white placeholder-zinc-500 focus:outline-none font-sans"
              />
              <button
                type="button"
                onClick={() => setIsQuickSearchOpen(false)}
                className="text-zinc-500 hover:text-white text-xs p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2 max-h-80 overflow-y-auto space-y-1">
              <button
                type="button"
                onClick={() => {
                  setCurrentView('overview');
                  setIsQuickSearchOpen(false);
                }}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/10 text-xs text-zinc-200 transition-colors"
              >
                <span>Overview Dashboard</span>
                <span className="text-[10px] font-mono text-zinc-500">Jump</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCurrentView('live');
                  setIsQuickSearchOpen(false);
                }}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/10 text-xs text-zinc-200 transition-colors"
              >
                <span>Live View</span>
                <span className="text-[10px] font-mono text-zinc-500">Jump</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCurrentView('events');
                  setIsQuickSearchOpen(false);
                }}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/10 text-xs text-zinc-200 transition-colors"
              >
                <span>Events & Incidents</span>
                <span className="text-[10px] font-mono text-zinc-500">Jump</span>
              </button>

              {/* Cameras List */}
              <div className="px-2 py-1 mt-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                Cameras ({filteredCameras.length})
              </div>
              {filteredCameras.map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => {
                    setFocusedCameraId(cam.id);
                    setCurrentView('camera');
                    setIsQuickSearchOpen(false);
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/10 text-xs text-zinc-200 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="font-medium">{cam.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{cam.ipAddress}</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">Open Focus</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= MODALS & DRAWERS ================= */}
      <UserManagementModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        availableCameras={cameras.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status || 'ONLINE',
        }))}
      />

      <NotificationSettingsModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
      />

      <OperationalSettingsModal
        isOpen={isOperationalSettingsOpen}
        onClose={() => setIsOperationalSettingsOpen(false)}
        token={token}
        isAdmin={isAdmin}
        cameras={cameras.map((c) => ({ id: c.id, name: c.name }))}
        onSettingsSaved={fetchCameras}
      />

      {selectedCameraForZones && (
        <MotionZoneEditorModal
          isOpen={Boolean(selectedCameraForZones)}
          onClose={() => setSelectedCameraForZones(null)}
          cameraId={selectedCameraForZones.id}
          cameraName={selectedCameraForZones.name}
          authToken={token || ''}
        />
      )}

      <CameraOnboardingWizardModal
        isOpen={isAddCameraModalOpen}
        onClose={() => setIsAddCameraModalOpen(false)}
        sites={sites.filter((site) => site.id !== null)}
        defaultSiteId={siteFilter !== ALL_SITES && siteFilter !== 'unassigned' ? siteFilter : null}
        onSuccess={() => {
          fetchCameras();
          fetchSites();
          refreshHealth();
        }}
      />

      {isAdmin && (
        <SitesModal
          isOpen={isSitesModalOpen}
          sites={sites}
          onClose={() => setIsSitesModalOpen(false)}
          onChanged={() => {
            fetchSites();
            fetchCameras();
          }}
        />
      )}

      <FirstBootWizardModal
        isOpen={isFirstBootModalOpen}
        onCompleted={() => {
          setIsFirstBootModalOpen(false);
          fetchCameras();
        }}
        token={token || ''}
      />

      <AuditLogViewerModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        token={token || ''}
      />

      <BackupRestoreModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        token={token || ''}
      />

      {isBookmarkModalOpen && bookmarkCameraId && (
        <BookmarkModal
          isOpen={isBookmarkModalOpen}
          onClose={() => setIsBookmarkModalOpen(false)}
          onSaved={() => setIsBookmarkModalOpen(false)}
          cameraId={bookmarkCameraId}
          cameraName={cameras.find((c) => c.id === bookmarkCameraId)?.name || 'Camera'}
          timestamp={new Date()}
          authToken={token || ''}
        />
      )}

      {isExportModalOpen && exportCameraId && (
        <ClipExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          cameraId={exportCameraId}
          cameraName={cameras.find((c) => c.id === exportCameraId)?.name || 'Camera'}
          authToken={token || ''}
        />
      )}
    </div>
  );
};

export default App;
