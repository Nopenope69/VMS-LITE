import React, { useState, useRef } from 'react';
import { Download, Upload, AlertTriangle, CheckCircle, RefreshCw, X } from 'lucide-react';

export interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  token,
}) => {
  const [mode, setMode] = useState<'skip-existing' | 'overwrite'>('skip-existing');
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch('/api/system/backup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Backup failed: ${res.statusText}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const isoDate = new Date().toISOString().slice(0, 10);
      a.download = `vms-backup-${isoDate}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message || 'Failed to download backup');
    } finally {
      setDownloading(false);
    }
  };

  const handleRestore = async (file: File) => {
    setRestoring(true);
    setError(null);
    setResult(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const res = await fetch(`/api/system/restore?mode=${mode}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/gzip',
        },
        body: arrayBuffer,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `Restore failed (${res.status})`);
      }
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to restore configuration');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '24px',
          width: '520px',
          maxWidth: '90vw',
          color: '#f8fafc',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
            borderBottom: '1px solid #1e293b',
            paddingBottom: '12px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Appliance Backup & Restore
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Backup Section */}
        <div style={{ marginBottom: '24px' }}>
          <h4
            style={{
              margin: '0 0 8px 0',
              fontSize: '14px',
              fontWeight: 600,
              color: '#38bdf8',
            }}
          >
            1. System Configuration Backup
          </h4>
          <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#94a3b8' }}>
            Exports all cameras, motion zones, recording schedules, permissions, and bookmarks into
            a signed .tar.gz archive. Video recordings and audit logs are excluded.
          </p>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: downloading ? 'not-allowed' : 'pointer',
              opacity: downloading ? 0.7 : 1,
            }}
          >
            {downloading ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            <span>{downloading ? 'Generating Archive...' : 'Download Backup Archive'}</span>
          </button>
        </div>

        {/* Restore Section */}
        <div style={{ marginBottom: '20px' }}>
          <h4
            style={{
              margin: '0 0 8px 0',
              fontSize: '14px',
              fontWeight: 600,
              color: '#f59e0b',
            }}
          >
            2. Restore Configuration
          </h4>
          <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#94a3b8' }}>
            Restore system configuration from a previously downloaded .tar.gz archive.
          </p>

          {/* Mode Selector */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="restoreMode"
                value="skip-existing"
                checked={mode === 'skip-existing'}
                onChange={() => setMode('skip-existing')}
              />
              <span>Skip Existing (Safe Merge)</span>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="restoreMode"
                value="overwrite"
                checked={mode === 'overwrite'}
                onChange={() => setMode('overwrite')}
              />
              <span>Overwrite Existing</span>
            </label>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".tar.gz,.gz"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleRestore(file);
            }}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              backgroundColor: '#334155',
              color: '#ffffff',
              border: '1px solid #475569',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: restoring ? 'not-allowed' : 'pointer',
              opacity: restoring ? 0.7 : 1,
            }}
          >
            {restoring ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}
            <span>{restoring ? 'Verifying & Restoring...' : 'Upload & Restore Archive'}</span>
          </button>
        </div>

        {/* Results / Error */}
        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              color: '#f87171',
              fontSize: '13px',
              marginBottom: '12px',
            }}
          >
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div
            style={{
              padding: '12px',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid #22c55e',
              borderRadius: '6px',
              color: '#4ade80',
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <CheckCircle size={16} />
              <strong>Restore Successful!</strong>
            </div>
            <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
              Mode: {result.mode} | Cameras: {result.summary?.restored?.cameras ?? 0} restored,{' '}
              {result.summary?.skipped?.cameras ?? 0} skipped
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default BackupRestoreModal;
