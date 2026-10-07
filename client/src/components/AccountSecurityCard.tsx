import React, { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { apiFetch } from '../api/client.js';

/**
 * Self-service account security: change own password (other sessions are signed
 * out, this one continues with a fresh token) and sign out of every device.
 */
export const AccountSecurityCard: React.FC = () => {
  const { token, user, login, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setMessage({ ok: false, text: 'New passwords do not match' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/auth/me/password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      login(data.token, data.user);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ ok: true, text: 'Password changed. Other devices have been signed out.' });
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    if (!user || !window.confirm('Sign out of all devices, including this one?')) return;
    await apiFetch(`/api/auth/users/${user.id}/revoke-sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    logout();
  };

  const input =
    'bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50';

  return (
    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <KeyRound className="w-4 h-4 text-zinc-400" />
          My account <span className="text-xs text-zinc-500 font-mono">({user?.username})</span>
        </div>
        <button
          type="button"
          onClick={signOutEverywhere}
          className="px-2.5 py-1 rounded-md text-xs text-zinc-300 bg-zinc-900 border border-white/10 hover:bg-zinc-800 flex items-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out everywhere
        </button>
      </div>
      <form onSubmit={changePassword} className="flex flex-wrap gap-2 items-center">
        <input type="password" required placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} autoComplete="current-password" />
        <input type="password" required minLength={8} placeholder="New password (min. 8)" value={next} onChange={(e) => setNext(e.target.value)} className={input} autoComplete="new-password" />
        <input type="password" required placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} autoComplete="new-password" />
        <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold disabled:opacity-50">
          Change password
        </button>
      </form>
      {message && (
        <p className={`mt-2 text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>
      )}
    </div>
  );
};
