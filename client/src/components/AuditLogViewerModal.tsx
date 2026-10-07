import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Search, Filter, Download, X, Calendar, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api/client.js';

export interface AuditLogItem {
  id: string;
  timestamp: string;
  userId: string | null;
  username: string | null;
  action: string;
  resource: string | null;
  ipAddress: string | null;
  metadata: any;
}

export interface AuditLogViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
}

export const AuditLogViewerModal: React.FC<AuditLogViewerModalProps> = ({
  isOpen,
  onClose,
  token,
}) => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  const [usernameFilter, setUsernameFilter] = useState('');

  const fetchLogs = useCallback(async () => {
    if (!token || !isOpen) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.append('action', actionFilter);
      if (usernameFilter) params.append('username', usernameFilter);
      params.append('limit', '100');

      const res = await apiFetch(`/api/audit/logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [token, isOpen, actionFilter, usernameFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (!isOpen) return null;

  const exportCsv = () => {
    const headers = ['Timestamp,Action,Username,User ID,Resource,IP Address,Metadata'];
    const rows = logs.map((l) =>
      [
        `"${l.timestamp}"`,
        `"${l.action}"`,
        `"${l.username || ''}"`,
        `"${l.userId || ''}"`,
        `"${l.resource || ''}"`,
        `"${l.ipAddress || ''}"`,
        `"${JSON.stringify(l.metadata).replace(/"/g, '""')}"`,
      ].join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `vms-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          width: '900px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
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
            marginBottom: '16px',
            borderBottom: '1px solid #1e293b',
            paddingBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={20} style={{ color: '#38bdf8' }} />
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              System & Operator Security Audit Trail
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={exportCsv}
              disabled={logs.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#cbd5e1',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              <Download size={14} /> Export CSV
            </button>
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
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Filter by Username..."
            value={usernameFilter}
            onChange={(e) => setUsernameFilter(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '13px',
            }}
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '13px',
            }}
          >
            <option value="">All Security Actions</option>
            <option value="AUTH_LOGIN">AUTH_LOGIN</option>
            <option value="AUTH_FAILURE">AUTH_FAILURE</option>
            <option value="EVIDENCE_EXPORT">EVIDENCE_EXPORT</option>
            <option value="CONFIG_CHANGE">CONFIG_CHANGE</option>
            <option value="INITIAL_SETUP_COMPLETED">INITIAL_SETUP_COMPLETED</option>
          </select>
          <button
            onClick={fetchLogs}
            style={{
              padding: '8px 14px',
              backgroundColor: '#0284c7',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #1e293b', borderRadius: '6px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b', color: '#94a3b8', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>Timestamp</th>
                <th style={{ padding: '10px 12px' }}>Action</th>
                <th style={{ padding: '10px 12px' }}>User</th>
                <th style={{ padding: '10px 12px' }}>Target Resource</th>
                <th style={{ padding: '10px 12px' }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                    {loading ? 'Loading audit records...' : 'No audit events found'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isFail = log.action.includes('FAILURE');
                  const isExport = log.action.includes('EXPORT');

                  return (
                    <tr
                      key={log.id}
                      style={{
                        borderBottom: '1px solid #1e293b',
                        backgroundColor: isFail ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '11px', color: '#94a3b8' }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: isFail ? '#7f1d1d' : isExport ? '#0369a1' : '#1e293b',
                            color: isFail ? '#fca5a5' : isExport ? '#7dd3fc' : '#cbd5e1',
                          }}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                        {log.username || log.userId || 'system'}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: '12px' }}>
                        {log.resource || '-'}
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '12px', color: '#64748b' }}>
                        {log.ipAddress || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '12px', fontSize: '12px', color: '#64748b', textAlign: 'right' }}>
          Showing {logs.length} of {total} audit records
        </div>
      </div>
    </div>
  );
};

export default AuditLogViewerModal;
