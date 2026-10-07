import React, { useState } from 'react';
import { ShieldAlert, KeyRound, Globe, CheckCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { apiFetch } from '../api/client.js';

export interface FirstBootWizardModalProps {
  isOpen: boolean;
  onCompleted: () => void;
  token: string;
}

export const FirstBootWizardModal: React.FC<FirstBootWizardModalProps> = ({
  isOpen,
  onCompleted,
  token,
}) => {
  const { login } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [siteName, setSiteName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch('/api/system/setup-complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          newPassword,
          siteName: siteName.trim() || 'CCTV Surveillance Site',
          timezone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Setup completion failed');
      }
      // Changing the factory password revokes older sessions; continue with the new token
      if (data.token && data.user) {
        login(data.token, data.user);
      }

      onCompleted();
    } catch (err: any) {
      setError(err.message || 'Failed to complete setup');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          border: '2px solid #ef4444',
          borderRadius: '12px',
          padding: '32px',
          width: '520px',
          maxWidth: '90vw',
          color: '#f8fafc',
          boxShadow: '0 25px 50px -12px rgba(239, 68, 68, 0.25)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              display: 'inline-flex',
              padding: '12px',
              backgroundColor: '#7f1d1d',
              borderRadius: '12px',
              marginBottom: '12px',
              color: '#fca5a5',
            }}
          >
            <ShieldAlert size={32} />
          </div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>
            First-Boot Security Provisioning
          </h2>
          <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
            The default administrator password (<code>admin123</code>) must be replaced before
            commissioning this CCTV appliance.
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              color: '#fca5a5',
              fontSize: '13px',
              marginBottom: '18px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              Site / Facility Name
            </label>
            <input
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="e.g. Warehouse North Gate"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              New Administrator Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              minLength={8}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              Confirm Administrator Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              required
              minLength={8}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              Timezone (Recording & Evidence Overlay)
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '14px',
              }}
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST - UTC+05:30)</option>
              <option value="UTC">UTC (Universal Coordinated Time)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST - UTC+04:00)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT - UTC+08:00)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              marginTop: '8px',
              padding: '12px 18px',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '14px',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {isSubmitting ? <RefreshCw size={16} className="animate-spin" /> : <KeyRound size={16} />}
            <span>{isSubmitting ? 'Updating Security Credentials...' : 'Complete Initial Provisioning'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default FirstBootWizardModal;
