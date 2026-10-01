import React from 'react';
import {
  LayoutDashboard,
  Radio,
  Camera,
  Activity,
  Film,
  HeartPulse,
  Settings,
  LogOut,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { ViewType } from '../App.js';

export interface SidebarProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  onlineCount: number;
  totalCount: number;
  unreadEventsCount: number;
  userName?: string;
  userRole?: string;
  onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  onlineCount,
  totalCount,
  unreadEventsCount,
  userName = 'Admin',
  userRole = 'Administrator',
  onLogout,
}) => {
  const navItems: Array<{ id: ViewType; label: string; icon: React.ElementType; badge?: string | number }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'live', label: 'Live', icon: Radio, badge: `${onlineCount}` },
    { id: 'cameras', label: 'Cameras', icon: Camera },
    { id: 'events', label: 'Events', icon: Activity, badge: unreadEventsCount > 0 ? unreadEventsCount : undefined },
    { id: 'recordings', label: 'Recordings', icon: Film },
    { id: 'health', label: 'Health', icon: HeartPulse },
  ];

  return (
    <aside className="w-56 shrink-0 h-screen bg-[#090a0f] border-r border-white/[0.07] flex flex-col justify-between font-sans select-none z-40">
      {/* Brand Header */}
      <div>
        <div className="h-14 px-4 flex items-center gap-2.5 border-b border-white/[0.06]">
          <div className="w-6 h-6 rounded-md bg-zinc-900 border border-white/15 flex items-center justify-center text-white shadow-sm">
            <Shield className="w-3.5 h-3.5 text-zinc-100" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs tracking-tight text-white">VMS-LITE</span>
            <span className="text-[10px] text-zinc-500 font-mono px-1.5 py-0.2 rounded bg-white/[0.04] border border-white/[0.06]">
              v1.0
            </span>
          </div>
        </div>

        {/* Primary Navigation */}
        <nav className="p-2 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all group ${
                  isActive
                    ? 'bg-zinc-800/80 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive ? 'text-emerald-400' : 'text-zinc-500 group-hover:text-zinc-300'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge !== undefined && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-medium ${
                      isActive
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-white/[0.06] text-zinc-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Section: Settings & Profile */}
      <div className="p-2 border-t border-white/[0.06] space-y-1">
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all group ${
            currentView === 'settings'
              ? 'bg-zinc-800/80 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Settings
              className={`w-4 h-4 transition-colors ${
                currentView === 'settings'
                  ? 'text-emerald-400'
                  : 'text-zinc-500 group-hover:text-zinc-300'
              }`}
            />
            <span>Settings</span>
          </div>
        </button>

        {/* User Card */}
        <div className="pt-2 px-1 flex items-center justify-between">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded-md bg-zinc-800 border border-white/10 flex items-center justify-center text-[10px] font-semibold text-zinc-300 shrink-0">
              {userName.substring(0, 2).toUpperCase()}
            </div>
            <div className="flex flex-col truncate text-left">
              <span className="text-[11px] font-medium text-zinc-200 truncate">{userName}</span>
              <span className="text-[10px] text-zinc-500 capitalize">{userRole}</span>
            </div>
          </div>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              title="Sign Out"
              className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] rounded transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
