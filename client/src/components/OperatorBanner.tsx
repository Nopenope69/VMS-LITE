import React from 'react';
import { useAuth } from '../context/AuthContext.js';

export interface OperatorBannerProps {
  onLogout?: () => void;
}

export const OperatorBanner: React.FC<OperatorBannerProps> = ({ onLogout }) => {
  const { user, isOperator, logout } = useAuth();

  if (!isOperator) {
    return null;
  }

  const handleLogout = onLogout || logout;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        backgroundColor: '#111827',
        borderBottom: '2px solid #fb923c',
        color: '#f3f4f6',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 8px',
            backgroundColor: 'rgba(251, 146, 60, 0.15)',
            border: '1px solid #fb923c',
            borderRadius: '4px',
            color: '#fb923c',
            fontSize: '11px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#fb923c',
              animation: 'pulse 1.5s infinite',
            }}
          />
          Operator Station
        </span>
        <span style={{ color: '#9ca3af' }}>Guard Shift Mode:</span>
        <span style={{ color: '#ffffff', fontWeight: 700 }}>{user?.username}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{ color: '#9ca3af', fontSize: '12px' }}>
          Monitoring Active • System Configuration Locked
        </span>
        <button
          onClick={handleLogout}
          style={{
            padding: '4px 10px',
            backgroundColor: 'transparent',
            border: '1px solid #374151',
            borderRadius: '4px',
            color: '#9ca3af',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#ef4444';
            e.currentTarget.style.borderColor = '#ef4444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#9ca3af';
            e.currentTarget.style.borderColor = '#374151';
          }}
        >
          End Shift (Logout)
        </button>
      </div>
    </div>
  );
};
