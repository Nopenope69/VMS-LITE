import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LiveViewPage } from './pages/LiveViewPage.js';
import { PlaybackPage } from './pages/PlaybackPage.js';
import { KioskPairingPage } from './pages/KioskPairingPage.js';
import { KioskDisplayPage } from './pages/KioskDisplayPage.js';
import { DisplayStationsModal } from './components/DisplayStationsModal.js';
import { GuardTourConfig } from './components/FocusTourLayout.js';
import { EMapPage } from './pages/EMapPage.js';
import { CameraManagementModal } from './components/CameraManagementModal.js';
import { SystemHealthModal } from './components/SystemHealthModal.js';
import { NotificationSettingsModal } from './components/NotificationSettingsModal.js';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal.js';
import { WanBandwidthModal } from './components/WanBandwidthModal.js';
import { useNetworkBandwidth } from './hooks/useNetworkBandwidth.js';
import {
  Shield,
  Video,
  History,
  LogOut,
  KeyRound,
  Tv,
  Compass,
  Camera,
  HardDrive,
  Keyboard,
  Network,
} from 'lucide-react';

const VmsConsole: React.FC = () => {
  const { user, token, logout, login, isLoading, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'live' | 'playback' | 'emap'>('live');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStationsModalOpen, setIsStationsModalOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isWanModalOpen, setIsWanModalOpen] = useState(false);
  const [availableTours, setAvailableTours] = useState<GuardTourConfig[]>([]);
  const networkState = useNetworkBandwidth();

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, []);

  // Check URL parameters for Kiosk / Pairing modes
  const urlParams = new URLSearchParams(window.location.search);
  const pathname = window.location.pathname;
  const isPairMode = pathname === '/pair' || urlParams.get('mode') === 'pair';
  const stationKey = urlParams.get('station') || (pathname === '/kiosk' ? localStorage.getItem('vms_kiosk_station_key') : null);

  useEffect(() => {
    fetch('/api/tours')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.tours) setAvailableTours(data.tours);
      })
      .catch(() => {});
  }, []);

  if (isPairMode) {
    return <KioskPairingPage onPaired={(key) => { window.location.href = `/?station=${key}`; }} />;
  }

  if (stationKey) {
    return <KioskDisplayPage stationKey={stationKey} />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Login failed');
      }

      login(data.token, data.user);
    } catch (err: any) {
      setLoginError(err.message || 'Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#090d16] text-[#4fc3f7] font-mono text-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#4fc3f7] border-t-transparent rounded-full animate-spin" />
          <span>INITIALIZING VMS CONSOLE...</span>
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#090d16] p-4">
        <div className="w-full max-w-md bg-[#111827] border border-[#1f2937] rounded-xl p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 flex items-center justify-center glow-ion mb-3">
              <Shield className="w-6 h-6 text-[#4fc3f7]" />
            </div>
            <h1 className="text-xl font-bold tracking-wider text-slate-100 font-mono">BASIC VMS LITE</h1>
            <span className="text-xs text-slate-400 mt-1">CP Plus & Hikvision Parity Console</span>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-red-950/60 border border-red-500/50 rounded-lg text-xs text-red-200">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Username / Operator ID</label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="admin"
                required
                className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] text-slate-100 rounded-lg px-3 py-2 text-sm outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] text-slate-100 rounded-lg px-3 py-2 text-sm outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-2.5 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-sm rounded-lg shadow-md transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4" />
              <span>{isSubmitting ? 'Authenticating...' : 'Sign In to Console'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100 overflow-hidden select-none">
      {/* Top Console Navigation Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#111827] border-b border-[#1f2937] shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 flex items-center justify-center glow-ion">
              <Shield className="w-4 h-4 text-[#4fc3f7]" />
            </div>
            <span className="text-sm font-extrabold tracking-wider text-[#4fc3f7] font-mono">BASIC VMS LITE</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#4fc3f7]/15 text-[#4fc3f7] border border-[#4fc3f7]/30">
              COMMERCIAL
            </span>
          </div>
        </div>

        {/* View Switchers */}
        <div className="flex items-center bg-[#090d16] p-1 rounded-lg border border-[#1f2937]">
          <button
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeTab === 'live'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>LIVE MONITOR</span>
          </button>
          <button
            onClick={() => setActiveTab('playback')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeTab === 'playback'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>PLAYBACK (24H)</span>
          </button>
          <button
            onClick={() => setActiveTab('emap')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeTab === 'emap'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>SITE E-MAP</span>
          </button>
        </div>

        {/* User Info & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Admin Devices Management Button */}
          {isAdmin && (
            <button
              onClick={() => setIsCameraModalOpen(true)}
              title="Camera Management & ONVIF LAN Scanner"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#1f2937] hover:border-[#4fc3f7]/50 bg-[#090d16] text-[#4fc3f7] text-xs font-semibold transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Devices</span>
            </button>
          )}

          {/* Admin Storage Health & Quota Button */}
          {isAdmin && (
            <button
              onClick={() => setIsHealthModalOpen(true)}
              title="Storage Quota & Retention Health"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#1f2937] hover:border-emerald-500/50 bg-[#090d16] text-emerald-400 text-xs font-semibold transition-colors"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Storage</span>
            </button>
          )}

          {/* Wall Displays Kiosks Button */}
          {isAdmin && (
            <button
              onClick={() => setIsStationsModalOpen(true)}
              title="Manage Wall Displays & TV Kiosks"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#1f2937] hover:border-[#4fc3f7]/50 bg-[#090d16] text-slate-300 hover:text-white text-xs font-semibold transition-colors"
            >
              <Tv className="w-3.5 h-3.5 text-[#4fc3f7]" />
              <span className="hidden md:inline">Wall Displays</span>
            </button>
          )}

          {/* WAN Bandwidth & Sync Button */}
          {isAdmin && (
            <button
              onClick={() => setIsWanModalOpen(true)}
              title="WAN Bandwidth Optimization & Off-Peak Nightly Sync"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#1f2937] hover:border-[#4fc3f7]/50 bg-[#090d16] text-[#4fc3f7] text-xs font-semibold transition-colors"
            >
              <Network className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">WAN & Sync</span>
            </button>
          )}

          {/* Keyboard Shortcuts Cheat Sheet Button */}
          <button
            onClick={() => setIsShortcutsModalOpen(true)}
            title="Keyboard Shortcuts (?)"
            className="p-1.5 rounded-lg border border-[#1f2937] hover:border-[#4fc3f7]/50 bg-[#090d16] text-slate-400 hover:text-[#4fc3f7] transition-colors"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          <div className="hidden sm:flex flex-col items-end text-xs pl-1">
            <span className="font-bold text-slate-200">{user.username}</span>
            <span className="text-[10px] text-[#4fc3f7] font-mono font-semibold">{user.role}</span>
          </div>
          <button
            onClick={logout}
            title="Log Out"
            className="p-1.5 rounded-lg border border-[#1f2937] hover:border-red-500/50 hover:bg-red-950/30 text-slate-400 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 w-full h-full relative overflow-hidden">
        {activeTab === 'live' ? (
          <LiveViewPage onNavigatePlayback={() => setActiveTab('playback')} />
        ) : activeTab === 'playback' ? (
          <PlaybackPage onNavigateLive={() => setActiveTab('live')} />
        ) : (
          <EMapPage
            onNavigateLive={() => setActiveTab('live')}
            onNavigatePlayback={() => setActiveTab('playback')}
          />
        )}
      </main>

      {/* Admin Wall Displays Modal */}
      <DisplayStationsModal
        isOpen={isStationsModalOpen}
        onClose={() => setIsStationsModalOpen(false)}
        availableTours={availableTours}
        authToken={token || undefined}
      />

      {/* Camera Management & LAN Auto-Discovery Modal */}
      <CameraManagementModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        authToken={token || undefined}
        onCamerasChanged={() => {
          // Re-fetch tours or trigger feed refresh if needed
        }}
      />

      {/* Storage Health & Retention Modal */}
      <SystemHealthModal
        isOpen={isHealthModalOpen}
        onClose={() => setIsHealthModalOpen(false)}
        authToken={token || undefined}
        onOpenNotifications={() => setIsNotificationModalOpen(true)}
      />

      {/* Anti-Theft WhatsApp & Telegram Notifications Modal */}
      <NotificationSettingsModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
      />

      {/* Operator Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* WAN Bandwidth Optimization & Nightly Sync Modal */}
      <WanBandwidthModal
        isOpen={isWanModalOpen}
        onClose={() => setIsWanModalOpen(false)}
        networkState={networkState}
        authToken={token || undefined}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <VmsConsole />
    </AuthProvider>
  );
};

export default App;
