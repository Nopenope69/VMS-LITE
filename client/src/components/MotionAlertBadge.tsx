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
      title="Alert Notifications"
      className={`relative p-2 rounded-md transition-colors ${
        hasActiveMotion
          ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
          : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
      } ${className}`}
    >
      {hasActiveMotion ? (
        <Activity className="w-4 h-4 animate-pulse text-amber-400" />
      ) : (
        <Bell className="w-4 h-4" />
      )}

      {/* Unread Count Badge */}
      {unreadCount > 0 && (
        <span
          className={`absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full text-white shadow-sm ${
            hasActiveMotion
              ? 'bg-amber-500 animate-bounce'
              : 'bg-emerald-600'
          }`}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}

      {/* Active Motion Pulse Dot */}
      {hasActiveMotion && (
        <span className="absolute bottom-1 right-1 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
      )}
    </button>
  );
};

export default MotionAlertBadge;
