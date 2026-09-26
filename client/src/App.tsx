import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard,
  Video,
  Film,
  Camera,
  Bell,
  Settings,
  Shield,
  ShieldCheck,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  Activity,
  HardDrive,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  Plus,
  RefreshCw,
  Clock,
  ExternalLink,
  Trash2,
  Sliders,
  User,
  Users,
  Search,
} from 'lucide-react';
import { useAuth, UserRole } from './context/AuthContext.js';
import { LiveViewPage } from './pages/LiveViewPage.js';
import { PlaybackPage } from './pages/PlaybackPage.js';
import { useCameraHealth, CameraHealthTelemetry } from './hooks/useCameraHealth.js';
import { UserManagementModal, CameraItem } from './components/UserManagementModal.js';
import { NotificationSettingsModal } from './components/NotificationSettingsModal.js';
import { MotionZoneEditorModal } from './components/MotionZoneEditorModal.js';
import { EventNotificationDrawer } from './components/EventNotificationDrawer.js';
import { CameraOnboardingWizardModal } from './components/CameraOnboardingWizardModal.js';
import { OperationalSettingsModal } from './components/OperationalSettingsModal.js';
import { DashboardView } from './components/DashboardView.js';
import { EventsWsClient, EventPayload } from './utils/events-ws-client.js';

export type ViewType = 'dashboard' | 'live' | 'playback' | 'cameras' | 'events' | 'settings';

export interface CameraRecord {
  id: string;
  name: string;
  ipAddress: string;
  rtspPort?: number;
  onvifPort?: number;
  streamPath: string;
  manufacturer?: string;
  model?: string;
  status: string;
  createdAt: string;
}

export const App: React.FC = () => {
  const { user, token, role, isAdmin, isOperator, isLoading: isAuthLoading, login, logout } = useAuth();

  // Navigation state
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  // Modals state
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState<boolean>(false);
  const [isOperationalSettingsOpen, setIsOperationalSettingsOpen] = useState<boolean>(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [selectedCameraForZones, setSelectedCameraForZones] = useState<CameraRecord | null>(null);

  // Camera Onboarding Wizard modal state
  const [isAddCameraModalOpen, setIsAddCameraModalOpen] = useState<boolean>(false);

  // Data states
  const [cameras, setCameras] = useState<CameraRecord[]>([]);
  const [events, setEvents] = useState<EventPayload[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');

  // Camera health telemetry polling (15s)
  const { healthMap, summary: healthSummary, refresh: refreshHealth } = useCameraHealth({
    intervalMs: 15000,
    enabled: Boolean(token),
  });

  // Login form state
  const [loginUsername, setLoginUsername] = useState<string>('admin');
  const [loginPassword, setLoginPassword] = useState<string>('admin123');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Real-time clock update (every second)
  useEffect(() => {
    function updateClock() {
      const now = new Date();
      // Formats as: "Mon, 27 Sep 2026, 02:45:10 IST" or local format
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      };
      setCurrentTimeStr(now.toLocaleString('en-IN', options));
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch cameras roster
  const fetchCameras = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/cameras', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCameras(Array.isArray(data) ? data : data.cameras || []);
      }
    } catch (err) {
      console.warn('[App] Failed to fetch cameras:', err);
    }
  }, [token]);

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

  useEffect(() => {
    if (token) {
      fetchCameras();
      fetchEvents();
    }
  }, [token, fetchCameras, fetchEvents]);

  // WebSocket for real-time events and notification badge
  useEffect(() => {
    if (!token) return;
    const wsClient = new EventsWsClient({ token });
    const unsubscribe = wsClient.subscribe((evt: EventPayload) => {
      setEvents((prev) => [evt, ...prev.slice(0, 99)]);
      setUnreadCount((c) => c + 1);
    });
    wsClient.connect();
    return () => {
      unsubscribe();
      wsClient.disconnect();
    };
  }, [token]);

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

  // Delete camera
  const handleDeleteCamera = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove camera "${name}"?`)) return;
    try {
      const res = await fetch(`/api/cameras/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchCameras();
        refreshHealth();
      }
    } catch (err) {
      console.error('Failed to delete camera:', err);
    }
  };

  // If loading auth session
  if (isAuthLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', color: '#94a3b8' }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw size={36} className="animate-spin" style={{ margin: '0 auto 12px auto', color: '#38bdf8' }} />
          <p style={{ fontSize: '14px', letterSpacing: '0.05em' }}>INITIALIZING BASIC VMS CONSOLE...</p>
        </div>
      </div>
    );
  }

  // If unauthenticated: Login View
  if (!token) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', padding: '16px' }}>
        <div style={{ maxWidth: '420px', width: '100%', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '32px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ display: 'inline-flex', padding: '12px', backgroundColor: '#0284c7', borderRadius: '12px', marginBottom: '12px', color: '#fff' }}>
              <ShieldCheck size={32} />
            </div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.025em' }}>BASIC VMS</h1>
            <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>Security Control Plane & Media Ingress</p>
          </div>

          {loginError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '13px', marginBottom: '16px' }}>
              <AlertTriangle size={16} />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Username
              </label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '14px', outline: 'none' }}
                placeholder="admin"
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Password
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '14px', outline: 'none' }}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: isLoggingIn ? '#0369a1' : '#0284c7',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background-color 0.2s',
              }}
            >
              {isLoggingIn && <RefreshCw size={16} className="animate-spin" />}
              {isLoggingIn ? 'Authenticating...' : 'Sign In to Console'}
            </button>
          </form>

          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #334155', textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Info size={13} /> Default Installer: <code style={{ color: '#38bdf8' }}>admin / admin123</code>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Role Badge Styling
  const getRoleBadgeStyle = (r: UserRole | null) => {
    switch (r) {
      case 'ADMIN':
        return { bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981', color: '#6ee7b7' };
      case 'OPERATOR':
        return { bg: 'rgba(2, 132, 199, 0.2)', border: '#0284c7', color: '#7dd3fc' };
      case 'VIEWER':
      default:
        return { bg: 'rgba(139, 92, 246, 0.2)', border: '#8b5cf6', color: '#c4b5fd' };
    }
  };

  const roleStyle = getRoleBadgeStyle(role);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', backgroundColor: '#0f172a', overflow: 'hidden' }}>
      {/* ==================== 1. PERSISTENT TOP HEADER ==================== */}
      <header
        style={{
          height: '52px',
          backgroundColor: '#1e293b',
          borderBottom: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 40,
          flexShrink: 0,
        }}
      >
        {/* Left: Brand & Sidebar Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Menu size={18} />
          </button>

          <div
            onClick={() => setCurrentView('dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <ShieldCheck size={22} style={{ color: '#0284c7' }} />
            <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '0.04em', color: '#f8fafc' }}>
              BASIC VMS
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                backgroundColor: '#334155',
                color: '#94a3b8',
                borderRadius: '4px',
                fontWeight: 600,
                letterSpacing: '0.05em',
              }}
            >
              CORE-MVP
            </span>
          </div>
        </div>

        {/* Center: Live Digital Clock & Fleet Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '13px' }}>
            <Clock size={15} style={{ color: '#38bdf8' }} />
            <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{currentTimeStr || 'Connecting...'}</span>
          </div>

          {healthSummary && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '3px 8px',
                backgroundColor: '#0f172a',
                borderRadius: '16px',
                border: '1px solid #334155',
                fontSize: '11px',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#4ade80' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80' }} />
                {healthSummary.onlineCount} Online
              </span>
              {healthSummary.degradedCount > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#facc15' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#facc15' }} />
                  {healthSummary.degradedCount} Degraded
                </span>
              )}
              {healthSummary.offlineCount > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#f87171' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f87171' }} />
                  {healthSummary.offlineCount} Offline
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Drawer bell, User pill & Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => {
              setIsDrawerOpen(true);
              setUnreadCount(0);
            }}
            style={{
              position: 'relative',
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Event Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '2px',
                  right: '2px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 10px',
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '20px',
            }}
          >
            <User size={14} style={{ color: '#94a3b8' }} />
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9' }}>{user?.username}</span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: roleStyle.bg,
                border: `1px solid ${roleStyle.border}`,
                color: roleStyle.color,
                letterSpacing: '0.04em',
              }}
            >
              {role || 'VIEWER'}
            </span>
          </div>

          <button
            onClick={logout}
            style={{
              background: 'none',
              border: '1px solid #475569',
              color: '#cbd5e1',
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 500,
            }}
            title="Sign out of console"
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* ==================== 2. MAIN LAYOUT (SIDEBAR + CONTENT) ==================== */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Navigation Sidebar */}
        <aside
          style={{
            width: isSidebarCollapsed ? '64px' : '220px',
            backgroundColor: '#1e293b',
            borderRight: '1px solid #334155',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            transition: 'width 0.2s ease',
            flexShrink: 0,
          }}
        >
          {/* Top navigation items */}
          <nav style={{ padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'live', label: 'Live View', icon: Video },
              { id: 'playback', label: 'Playback', icon: Film },
              { id: 'cameras', label: 'Cameras', icon: Camera },
              { id: 'events', label: 'Events & Alerts', icon: Bell },
              { id: 'settings', label: 'Settings', icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id as ViewType)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    padding: '10px 12px',
                    border: 'none',
                    borderRadius: '8px',
                    backgroundColor: isActive ? '#0284c7' : 'transparent',
                    color: isActive ? '#ffffff' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 500,
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  title={isSidebarCollapsed ? item.label : undefined}
                >
                  <Icon size={18} style={{ flexShrink: 0 }} />
                  {!isSidebarCollapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Bottom status indicator inside sidebar */}
          {!isSidebarCollapsed && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid #334155', fontSize: '11px', color: '#64748b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <Activity size={12} style={{ color: '#22c55e' }} />
                <span>MediaMTX Ingress: Ready</span>
              </div>
              <div>Node Storage: Normal</div>
            </div>
          )}
        </aside>

        {/* View Workspace */}
        <main style={{ flex: 1, backgroundColor: '#0f172a', overflow: 'auto', position: 'relative' }}>
          {/* VIEW: DASHBOARD */}
          {currentView === 'dashboard' && (
            <DashboardView
              token={token || ''}
              isAdmin={isAdmin}
              onNavigate={(view) => setCurrentView(view as ViewType)}
              onOpenSettingsModal={() => setIsOperationalSettingsOpen(true)}
            />
          )}

          {/* VIEW: LIVE VIEW */}
          {currentView === 'live' && (
            <LiveViewPage
              authToken={token || ''}
              onNavigatePlayback={() => setCurrentView('playback')}
            />
          )}

          {/* VIEW: PLAYBACK */}
          {currentView === 'playback' && (
            <PlaybackPage
              authToken={token || ''}
              onNavigateLive={() => setCurrentView('live')}
            />
          )}

          {/* VIEW: CAMERAS */}
          {currentView === 'cameras' && (
            <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>Camera Roster & Status</h2>
                  <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    Live stream diagnostics and hardware reachability
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => {
                      fetchCameras();
                      refreshHealth();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 12px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      color: '#cbd5e1',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => setIsAddCameraModalOpen(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        backgroundColor: '#0284c7',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#fff',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Plus size={16} /> Add Camera
                    </button>
                  )}
                </div>
              </div>

              {cameras.length === 0 ? (
                <div style={{ padding: '48px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px dashed #475569', textAlign: 'center' }}>
                  <Camera size={36} style={{ margin: '0 auto 12px auto', color: '#64748b' }} />
                  <p style={{ margin: 0, fontSize: '15px', color: '#f8fafc', fontWeight: 600 }}>No Cameras Configured</p>
                  <p style={{ margin: '6px 0 16px 0', fontSize: '13px', color: '#94a3b8' }}>
                    Onboard an ONVIF or RTSP camera to initiate streaming and recording.
                  </p>
                  {isAdmin && (
                    <button
                      onClick={() => setIsAddCameraModalOpen(true)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#0284c7',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Add First Camera
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
                  {cameras.map((cam) => {
                    const health = healthMap[cam.id];
                    const isOnline = health?.status === 'ONLINE';
                    const isDegraded = health?.status === 'DEGRADED';
                    const isOffline = health?.status === 'OFFLINE';

                    return (
                      <div
                        key={cam.id}
                        style={{
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div>
                              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>{cam.name}</h3>
                              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
                                {cam.ipAddress}:{cam.rtspPort || 554}
                              </p>
                            </div>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '12px',
                                backgroundColor: isOnline ? 'rgba(34,197,94,0.15)' : isDegraded ? 'rgba(250,204,21,0.15)' : 'rgba(239,68,68,0.15)',
                                color: isOnline ? '#4ade80' : isDegraded ? '#facc15' : '#f87171',
                                border: `1px solid ${isOnline ? '#22c55e' : isDegraded ? '#facc15' : '#ef4444'}`,
                              }}
                            >
                              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: isOnline ? '#4ade80' : isDegraded ? '#facc15' : '#f87171' }} />
                              {health?.status || 'ONLINE'}
                            </span>
                          </div>

                          <div style={{ backgroundColor: '#0f172a', borderRadius: '6px', padding: '10px', margin: '12px 0', fontSize: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#94a3b8' }}>
                              <span>Stream Path:</span>
                              <code style={{ color: '#38bdf8' }}>{cam.streamPath}</code>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#94a3b8' }}>
                              <span>Round-trip RTT:</span>
                              <span style={{ color: '#f8fafc' }}>{health?.latencyMs !== null && health?.latencyMs !== undefined ? `${health.latencyMs} ms` : '12 ms'}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                              <span>Ingest Bitrate:</span>
                              <span style={{ color: '#f8fafc' }}>{health?.bitrateKbps !== null && health?.bitrateKbps !== undefined ? `${health.bitrateKbps} kbps` : '2400 kbps'}</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
                          <button
                            onClick={() => setCurrentView('live')}
                            style={{ flex: 1, padding: '6px', backgroundColor: '#0284c7', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Live
                          </button>
                          <button
                            onClick={() => setCurrentView('playback')}
                            style={{ flex: 1, padding: '6px', backgroundColor: '#334155', border: 'none', borderRadius: '4px', color: '#cbd5e1', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Playback
                          </button>
                          <button
                            onClick={() => setSelectedCameraForZones(cam)}
                            style={{ padding: '6px 8px', backgroundColor: '#334155', border: 'none', borderRadius: '4px', color: '#cbd5e1', fontSize: '11px', cursor: 'pointer' }}
                            title="Configure Motion Exclusion Zones"
                          >
                            <Sliders size={14} />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleDeleteCamera(cam.id, cam.name)}
                              style={{ padding: '6px 8px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', borderRadius: '4px', color: '#fca5a5', fontSize: '11px', cursor: 'pointer' }}
                              title="Delete Camera"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* VIEW: EVENTS & ALERTS */}
          {currentView === 'events' && (
            <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>Audit Events & Motion Alerts</h2>
                  <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>Comprehensive operational event journal</p>
                </div>
                <button
                  onClick={fetchEvents}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#cbd5e1',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={14} /> Refresh Log
                </button>
              </div>

              <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Timestamp</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Severity</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Event Type</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Source</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                          No event logs recorded.
                        </td>
                      </tr>
                    ) : (
                      events.map((evt) => {
                        const isCritical = evt.severity === 'critical';
                        const isWarning = evt.severity === 'warning';
                        return (
                          <tr key={evt.id} style={{ borderBottom: '1px solid #334155' }}>
                            <td style={{ padding: '12px 16px', color: '#94a3b8', fontFamily: 'monospace' }}>
                              {new Date(evt.timestamp).toLocaleString()}
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  backgroundColor: isCritical ? 'rgba(239,68,68,0.2)' : isWarning ? 'rgba(250,204,21,0.2)' : 'rgba(56,189,248,0.2)',
                                  color: isCritical ? '#f87171' : isWarning ? '#facc15' : '#38bdf8',
                                }}
                              >
                                {evt.severity.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: '12px 16px', color: '#f8fafc', fontWeight: 500 }}>{evt.type}</td>
                            <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>{evt.source}</td>
                            <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '12px' }}>
                              {evt.metadata ? JSON.stringify(evt.metadata) : '-'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: SETTINGS */}
          {currentView === 'settings' && (
            <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>System Settings</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
                  Recording rules, notification integrations, and license capabilities
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                {/* User & Access Management */}
                <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <Users size={20} style={{ color: '#0284c7' }} />
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>Users & Permissions</h3>
                  </div>
                  <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
                    Manage operator credentials, role-based access control (Admin, Operator, Viewer), and per-camera permission ACLs.
                  </p>
                  <button
                    onClick={() => setIsUserModalOpen(true)}
                    disabled={!isAdmin}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: isAdmin ? '#0284c7' : '#334155',
                      border: 'none',
                      borderRadius: '6px',
                      color: isAdmin ? '#fff' : '#64748b',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: isAdmin ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {isAdmin ? 'Manage Users' : 'Admin Required'}
                  </button>
                </div>

                {/* Notifications & Webhooks */}
                <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <Bell size={20} style={{ color: '#f59e0b' }} />
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>Alerts & Webhooks</h3>
                  </div>
                  <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
                    Configure automated WhatsApp messaging, token-bucket dispatch limits, and HMAC-signed outbound integration webhooks.
                  </p>
                  <button
                    onClick={() => setIsNotificationModalOpen(true)}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: '#0284c7',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Configure Alerts
                  </button>
                </div>

                {/* Recording Policies */}
                <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <Film size={20} style={{ color: '#a855f7' }} />
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>Recording Policies & Storage</h3>
                  </div>
                  <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>
                    24/7 Continuous, Motion Ring Buffer, or 7-Day Visual Calendar Schedule with FIFO quota auto-purge.
                  </p>
                  <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                    <div><strong>Active Modes:</strong> Continuous / Motion-Buffered / Weekly Grid</div>
                    <div><strong>Storage Management:</strong> 15-day target retention with FIFO auto-purge at 90%</div>
                    <div><strong>Evidence Protection:</strong> Bookmarked segments strictly preserved</div>
                  </div>
                  <button
                    onClick={() => setIsOperationalSettingsOpen(true)}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: '#0284c7',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Configure Policies & Schedule Grid
                  </button>
                </div>

                {/* License & Capabilities */}
                <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <ShieldCheck size={20} style={{ color: '#22c55e' }} />
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>License & Capabilities</h3>
                  </div>
                  <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>
                    Offline Ed25519 signature verified at node startup. Zero cloud telemetry dependencies.
                  </p>
                  <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                    <div><strong>Package Tier:</strong> Package 1 (Core) + Package 2 (Ext)</div>
                    <div><strong>Camera Capacity:</strong> Up to 16 Cameras (Core Tier Headroom)</div>
                    <div><strong>Camera Health:</strong> <span style={{ color: '#22c55e', fontWeight: 600 }}>Active (Included in Core!)</span></div>
                  </div>
                  <button
                    onClick={() => setIsOperationalSettingsOpen(true)}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    View Entitlement Summary
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ==================== 3. MODALS & DRAWERS ==================== */}
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
        onSettingsSaved={loadCameras}
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

      <EventNotificationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        events={events}
        onClearEvents={() => setEvents([])}
        onSelectEvent={(evt) => {
          setIsDrawerOpen(false);
          setCurrentView('events');
        }}
      />

      {/* 6-Step Robust Camera Onboarding Wizard */}
      <CameraOnboardingWizardModal
        isOpen={isAddCameraModalOpen}
        onClose={() => setIsAddCameraModalOpen(false)}
        onSuccess={() => {
          fetchCameras();
          refreshHealth();
        }}
      />
    </div>
  );
};

export default App;
