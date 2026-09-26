import React from 'react';
import { Bell, Activity } from 'lucide-react';

export interface MotionAlertBadgeProps {
  unreadCount: number;
  hasActiveMotion?: boolean;
  onClick: () => void;
  className?: string;
}

export const MotionAlertBadge: React.FC<MotionAlertBadgeProps> = ({
  unreadCount,
  hasActiveMotion = false,
  onClick,
  className = '',
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Alert Notifications Feed"
      className={`relative min-h-[40px] px-3 py-1.5 flex items-center gap-2 rounded-md transition-all duration-200 border font-medium text-xs ${
        hasActiveMotion
          ? 'bg-[#fb923c]/20 text-[#fb923c] border-[#fb923c] shadow-[0_0_12px_rgba(251,146,60,0.3)] animate-pulse'
          : 'bg-[#111827] text-slate-300 border-[#1f2937] hover:text-white hover:border-[#4fc3f7]/60'
      } ${className}`}
    >
      {hasActiveMotion ? (
        <Activity className="w-4 h-4 text-[#fb923c] animate-spin" />
      ) : (
        <Bell className="w-4 h-4 text-slate-400" />
      )}
      <span className="hidden sm:inline font-semibold">
        {hasActiveMotion ? 'MOTION' : 'ALERTS'}
      </span>

      {/* Unread Count Badge in Solar Amber or Ion Blue */}
      {unreadCount > 0 && (
        <span
          className={`flex items-center justify-center min-w-[20px] h-[20px] px-1.5 text-[11px] font-bold rounded-full shadow-sm font-mono ${
            hasActiveMotion
              ? 'bg-[#fb923c] text-gray-950 animate-bounce'
              : 'bg-[#4fc3f7] text-gray-950'
          }`}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}

      {/* Active Motion Pulse Dot */}
      {hasActiveMotion && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#fb923c] opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-[#fb923c]" />
        </span>
      )}
    </button>
  );
};

export default MotionAlertBadge;
