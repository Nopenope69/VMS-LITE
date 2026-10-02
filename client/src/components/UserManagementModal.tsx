import React, { useState, useEffect } from 'react';
import { useAuth, UserRole } from '../context/AuthContext.js';

export interface UserItem {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface CameraItem {
  id: string;
  name: string;
  status: string;
  siteId?: string | null;
}

type PermissionFlag = 'canViewLive' | 'canViewPlayback' | 'canControlPtz' | 'canExportClips';
type PermissionFlags = Record<PermissionFlag, boolean>;
const FLAG_LABELS: Array<[PermissionFlag, string, string]> = [
  ['canViewLive', 'Live View', '#4fc3f7'],
  ['canViewPlayback', 'Playback', '#4fc3f7'],
  ['canControlPtz', 'PTZ Control', '#fb923c'],
  ['canExportClips', 'Export', '#fb923c'],
];
const NO_FLAGS: PermissionFlags = { canViewLive: false, canViewPlayback: false, canControlPtz: false, canExportClips: false };

export interface CameraPermissionItem {
  cameraId: string;
  canViewLive: boolean;
  canViewPlayback: boolean;
  canControlPtz: boolean;
  canExportClips: boolean;
}

export interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableCameras: CameraItem[];
  /** Sites an operator can be granted as a whole */
  sites?: Array<{ id: string; name: string }>;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  availableCameras,
  sites = [],
}) => {
  const [sitePermissions, setSitePermissions] = useState<Record<string, PermissionFlags>>({});
  const toggleSitePermission = (siteId: string, key: PermissionFlag) =>
    setSitePermissions((prev) => ({
      ...prev,
      [siteId]: { ...(prev[siteId] ?? NO_FLAGS), [key]: !prev[siteId]?.[key] },
    }));
  const { token, isAdmin, user: currentUser } = useAuth();
  const [resetPassword, setResetPassword] = useState('');
  const [users, setUsers] = useState<UserItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [permissions, setPermissions] = useState<Record<string, CameraPermissionItem>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // New user form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('OPERATOR');
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && isAdmin) {
      fetchUsers();
    }
  }, [isOpen, isAdmin]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/auth/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error('[UserManagement] Failed to fetch users:', err);
    }
  };

  /** Account actions; each one also signs the user out of existing sessions server-side. */
  const accountAction = async (
    label: string,
    method: string,
    url: string,
    body?: unknown,
    confirmText?: string
  ) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setStatusMessage(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      setStatusMessage(`${label}: done`);
      if (method === 'DELETE') setSelectedUser(null);
      else if (data.user && selectedUser) setSelectedUser({ ...selectedUser, role: data.user.role });
      setResetPassword('');
      await fetchUsers();
    } catch (err: any) {
      setStatusMessage(`Error: ${label} failed - ${err.message}`);
    }
  };

  const loadPermissions = async (user: UserItem) => {
    setSelectedUser(user);
    setStatusMessage(null);

    if (user.role !== 'OPERATOR') {
      return;
    }

    try {
      const res = await fetch(`/api/auth/users/${user.id}/permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const permMap: Record<string, CameraPermissionItem> = {};

      // Initialize defaults for all available cameras
      availableCameras.forEach((cam) => {
        permMap[cam.id] = {
          cameraId: cam.id,
          canViewLive: false,
          canViewPlayback: false,
          canControlPtz: false,
          canExportClips: false,
        };
      });

      if (res.ok) {
        const data = await res.json();
        (data.permissions || []).forEach((p: any) => {
          permMap[p.cameraId] = {
            cameraId: p.cameraId,
            canViewLive: p.canViewLive ?? false,
            canViewPlayback: p.canViewPlayback ?? false,
            canControlPtz: p.canControlPtz ?? false,
            canExportClips: p.canExportClips ?? false,
          };
        });
      }

      setPermissions(permMap);

      // Site-wide grants (cover every camera at the site, including future ones)
      const siteMap: Record<string, PermissionFlags> = {};
      sites.forEach((site) => (siteMap[site.id] = { ...NO_FLAGS }));
      const siteRes = await fetch(`/api/auth/users/${user.id}/site-permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (siteRes.ok) {
        ((await siteRes.json()).permissions || []).forEach((p: any) => {
          siteMap[p.siteId] = {
            canViewLive: Boolean(p.canViewLive),
            canViewPlayback: Boolean(p.canViewPlayback),
            canControlPtz: Boolean(p.canControlPtz),
            canExportClips: Boolean(p.canExportClips),
          };
        });
      }
      setSitePermissions(siteMap);
    } catch (err) {
      console.error('[UserManagement] Failed to load permissions:', err);
    }
  };

  const handleTogglePermission = (
    cameraId: string,
    key: 'canViewLive' | 'canViewPlayback' | 'canControlPtz' | 'canExportClips'
  ) => {
    setPermissions((prev) => ({
      ...prev,
      [cameraId]: {
        ...prev[cameraId],
        [key]: !prev[cameraId]?.[key],
      },
    }));
  };

  const handleSavePermissions = async () => {
    if (!selectedUser) return;
    setIsSaving(true);
    setStatusMessage(null);

    const payload = Object.values(permissions);

    try {
      const res = await fetch(`/api/auth/users/${selectedUser.id}/permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ permissions: payload }),
      });

      if (!res.ok) {
        const data = await res.json();
        setStatusMessage(`Error: ${data.message || 'Failed to update'}`);
        return;
      }
      if (sites.length > 0) {
        const siteRes = await fetch(`/api/auth/users/${selectedUser.id}/site-permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            permissions: Object.entries(sitePermissions).map(([siteId, flags]) => ({ siteId, ...flags })),
          }),
        });
        if (!siteRes.ok) {
          const data = await siteRes.json().catch(() => ({}));
          setStatusMessage(`Error: ${data.message || 'Failed to update site access'}`);
          return;
        }
      }
      setStatusMessage('Permissions updated successfully');
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!newUsername || !newPassword) {
      setCreateError('Username and password required');
      return;
    }

    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
        }),
      });

      if (res.ok) {
        setNewUsername('');
        setNewPassword('');
        fetchUsers();
      } else {
        const data = await res.json();
        setCreateError(data.message || 'Failed to create user');
      }
    } catch (err: any) {
      setCreateError(err.message);
    }
  };

  if (!isOpen || !isAdmin) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(9, 10, 15, 0.82)',
        backdropFilter: 'blur(20px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '920px',
          maxHeight: '85vh',
          backgroundColor: '#111318',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden',
          color: '#f3f4f6',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            backgroundColor: 'rgba(12, 14, 20, 0.95)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#f4f4f5', fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em' }}>
              Users & Camera Permissions (RBAC)
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 8px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                color: '#34d399',
                borderRadius: '9999px',
                fontWeight: 500,
              }}
            >
              Enterprise Tier
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body: Two Columns */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Column: Users List & Create */}
          <div
            style={{
              width: '320px',
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#090a0f',
            }}
          >
            {/* Create User Form */}
            <form
              onSubmit={handleCreateUser}
              style={{
                padding: '14px',
                borderBottom: '1px solid #1f2937',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#9ca3af' }}>
                Add New User
              </span>
              <input
                type="text"
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                style={{
                  padding: '6px 8px',
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              />
              <input
                type="password"
                placeholder="Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{
                  padding: '6px 8px',
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                style={{
                  padding: '6px 8px',
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              >
                <option value="OPERATOR">OPERATOR (Guard Station)</option>
                <option value="VIEWER">VIEWER (Read Only)</option>
                <option value="ADMIN">ADMIN (Full Control)</option>
              </select>
              {createError && (
                <span style={{ color: '#ef4444', fontSize: '11px' }}>{createError}</span>
              )}
              <button
                type="submit"
                style={{
                  padding: '6px',
                  backgroundColor: '#4fc3f7',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#090d16',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                + Create User
              </button>
            </form>

            {/* Users List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
              <span style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase' }}>
                Existing Users ({users.length})
              </span>
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {users.map((u) => {
                  const isSelected = selectedUser?.id === u.id;
                  return (
                    <div
                      key={u.id}
                      onClick={() => loadPermissions(u)}
                      style={{
                        padding: '10px',
                        backgroundColor: isSelected ? '#1f2937' : '#111827',
                        border: `1px solid ${isSelected ? '#4fc3f7' : '#1f2937'}`,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>
                          {u.username}
                        </div>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                          Role: <strong style={{ color: u.role === 'ADMIN' ? '#4fc3f7' : u.role === 'OPERATOR' ? '#fb923c' : '#9ca3af' }}>{u.role}</strong>
                        </div>
                      </div>
                      {u.role === 'OPERATOR' && (
                        <span style={{ fontSize: '10px', color: '#fb923c', border: '1px solid #fb923c', padding: '1px 4px', borderRadius: '3px' }}>
                          ACL
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Camera Permission Matrix */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#090d16',
              padding: '16px 20px',
              overflowY: 'auto',
            }}
          >
            {selectedUser ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', color: '#ffffff' }}>
                      Permissions for: <span style={{ color: '#4fc3f7' }}>{selectedUser.username}</span>
                    </h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#9ca3af' }}>
                      {selectedUser.role === 'OPERATOR'
                        ? 'Select which cameras this operator can monitor live, playback, or control.'
                        : selectedUser.role === 'ADMIN'
                        ? 'Admin has unrestricted bypass across all cameras.'
                        : 'Viewer has default read-only monitoring across all cameras.'}
                    </p>
                  </div>
                  {selectedUser.role === 'OPERATOR' && (
                    <button
                      onClick={handleSavePermissions}
                      disabled={isSaving}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#fb923c',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#090d16',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: isSaving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isSaving ? 'Saving...' : 'Save Permissions'}
                    </button>
                  )}
                </div>

                {statusMessage && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: '4px',
                      marginBottom: '14px',
                      fontSize: '12px',
                      backgroundColor: statusMessage.startsWith('Error') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: statusMessage.startsWith('Error') ? '#ef4444' : '#10b981',
                      border: `1px solid ${statusMessage.startsWith('Error') ? '#ef4444' : '#10b981'}`,
                    }}
                  >
                    {statusMessage}
                  </div>
                )}

                {/* Account management */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px',
                    marginBottom: '16px',
                    border: '1px solid #1f2937',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                >
                  <label style={{ color: '#9ca3af' }}>
                    Role{' '}
                    <select
                      value={selectedUser.role}
                      disabled={selectedUser.id === currentUser?.id}
                      onChange={(e) =>
                        accountAction('Role change', 'PATCH', `/api/auth/users/${selectedUser.id}`, {
                          role: e.target.value,
                        })
                      }
                      style={{ marginLeft: '4px', backgroundColor: '#111827', color: '#fff', border: '1px solid #374151', borderRadius: '4px', padding: '4px' }}
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="OPERATOR">OPERATOR</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  </label>
                  <input
                    type="password"
                    placeholder="New password (min. 8)"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    style={{ backgroundColor: '#111827', color: '#fff', border: '1px solid #374151', borderRadius: '4px', padding: '5px 8px' }}
                  />
                  <button
                    type="button"
                    disabled={resetPassword.length < 8}
                    onClick={() =>
                      accountAction('Password reset', 'POST', `/api/auth/users/${selectedUser.id}/reset-password`, {
                        password: resetPassword,
                      })
                    }
                    style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid #374151', backgroundColor: '#1f2937', color: '#e5e7eb', cursor: 'pointer' }}
                  >
                    Reset password
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      accountAction(
                        'Sign out everywhere',
                        'POST',
                        `/api/auth/users/${selectedUser.id}/revoke-sessions`,
                        undefined,
                        `Sign ${selectedUser.username} out of all devices?`
                      )
                    }
                    style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid #374151', backgroundColor: '#1f2937', color: '#e5e7eb', cursor: 'pointer' }}
                  >
                    Sign out everywhere
                  </button>
                  {selectedUser.id !== currentUser?.id && (
                    <button
                      type="button"
                      onClick={() =>
                        accountAction(
                          'Delete user',
                          'DELETE',
                          `/api/auth/users/${selectedUser.id}`,
                          undefined,
                          `Delete user ${selectedUser.username}? This cannot be undone.`
                        )
                      }
                      style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid #7f1d1d', backgroundColor: '#450a0a', color: '#fecaca', cursor: 'pointer', marginLeft: 'auto' }}
                    >
                      Delete user
                    </button>
                  )}
                </div>

                {selectedUser.role === 'OPERATOR' && sites.length > 0 && (
                  <div style={{ marginBottom: '18px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>Site access</div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>
                      Applies to every camera at the site, including cameras added later.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {sites.map((site) => {
                        const flags = sitePermissions[site.id] ?? NO_FLAGS;
                        return (
                          <div
                            key={site.id}
                            style={{ padding: '10px 12px', backgroundColor: '#0f1a2b', border: '1px solid #1e3a5f', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                          >
                            <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{site.name}</div>
                            <div style={{ display: 'flex', gap: '14px', fontSize: '12px' }}>
                              {FLAG_LABELS.map(([key, label, color]) => (
                                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#e5e7eb' }}>
                                  <input
                                    type="checkbox"
                                    aria-label={`${site.name} ${label}`}
                                    checked={flags[key]}
                                    onChange={() => toggleSitePermission(site.id, key)}
                                    style={{ accentColor: color }}
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#cbd5e1', margin: '16px 0 4px' }}>Individual cameras</div>
                  </div>
                )}

                {selectedUser.role === 'OPERATOR' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {availableCameras.length === 0 ? (
                      <div style={{ color: '#6b7280', fontSize: '13px', fontStyle: 'italic' }}>
                        No cameras onboarded yet.
                      </div>
                    ) : (
                      availableCameras.map((cam) => {
                        const perm = permissions[cam.id] || {
                          canViewLive: false,
                          canViewPlayback: false,
                          canControlPtz: false,
                          canExportClips: false,
                        };

                        return (
                          <div
                            key={cam.id}
                            style={{
                              padding: '12px',
                              backgroundColor: '#111827',
                              border: '1px solid #1f2937',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>
                                {cam.name}
                              </div>
                              <div style={{ fontSize: '11px', color: '#6b7280' }}>
                                {(() => {
                                  const siteFlags = cam.siteId ? sitePermissions[cam.siteId] : undefined;
                                  const viaSite = FLAG_LABELS.filter(([key]) => siteFlags?.[key]).map(([, label]) => label);
                                  const siteName = sites.find((site) => site.id === cam.siteId)?.name;
                                  return viaSite.length > 0
                                    ? `Via site ${siteName}: ${viaSite.join(', ')}`
                                    : siteName ?? 'No site';
                                })()}
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: '14px', fontSize: '12px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#e5e7eb' }}>
                                <input
                                  type="checkbox"
                                  checked={perm.canViewLive}
                                  onChange={() => handleTogglePermission(cam.id, 'canViewLive')}
                                  style={{ accentColor: '#4fc3f7' }}
                                />
                                Live View
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#e5e7eb' }}>
                                <input
                                  type="checkbox"
                                  checked={perm.canViewPlayback}
                                  onChange={() => handleTogglePermission(cam.id, 'canViewPlayback')}
                                  style={{ accentColor: '#4fc3f7' }}
                                />
                                Playback
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#e5e7eb' }}>
                                <input
                                  type="checkbox"
                                  checked={perm.canControlPtz}
                                  onChange={() => handleTogglePermission(cam.id, 'canControlPtz')}
                                  style={{ accentColor: '#fb923c' }}
                                />
                                PTZ Control
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#e5e7eb' }}>
                                <input
                                  type="checkbox"
                                  checked={perm.canExportClips}
                                  onChange={() => handleTogglePermission(cam.id, 'canExportClips')}
                                  style={{ accentColor: '#fb923c' }}
                                />
                                Export Clips
                              </label>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ margin: 'auto', color: '#6b7280', fontSize: '13px', fontStyle: 'italic' }}>
                Select a user on the left to configure camera permissions.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
