import React, { useState } from 'react';
import { MapPin, Plus, Trash2, X, Check, Pencil } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { SiteSummary } from '../types/sites.js';
import { apiFetch } from '../api/client.js';

export interface SitesModalProps {
  isOpen: boolean;
  sites: SiteSummary[];
  onClose: () => void;
  onChanged: () => void;
}

const inputCls =
  'bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50';

/** Empty input clears the uplink; anything else must be a positive number of Mbps */
function parseUplink(value: string): number | null {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

/** Admin management of sites (locations whose cameras this server pulls). */
export const SitesModal: React.FC<SitesModalProps> = ({ isOpen, sites, onClose, onChanged }) => {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [uplink, setUplink] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editUplink, setEditUplink] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const call = async (method: string, url: string, body?: unknown) => {
    setError(null);
    const res = await apiFetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || `Request failed (HTTP ${res.status})`);
      return false;
    }
    onChanged();
    return true;
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await call('POST', '/api/sites', { name: name.trim(), address: address.trim() || null, uplinkMbps: parseUplink(uplink) })) {
      setName('');
      setAddress('');
      setUplink('');
    }
  };

  const saveEdit = async (id: string) => {
    if (
      await call('PATCH', `/api/sites/${id}`, {
        name: editName.trim(),
        address: editAddress.trim() || null,
        uplinkMbps: parseUplink(editUplink),
      })
    ) {
      setEditingId(null);
    }
  };

  const managed = sites.filter((s) => s.id !== null);
  const unassigned = sites.find((s) => s.id === null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[#111318] border border-white/10 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-400" /> Sites
          </h2>
          <button type="button" onClick={onClose} className="p-1 text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-500 mb-5">
          Group cameras by location. This server pulls each site's cameras over the LAN, a VPN or port-forwarded RTSP.
          Move cameras between sites from the Cameras page.
        </p>

        <form onSubmit={create} className="flex flex-wrap gap-2 mb-5">
          <input className={`${inputCls} flex-1 min-w-[160px]`} placeholder="Site name (e.g. Noida Branch)" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
          <input
            className={`${inputCls} w-[150px]`}
            placeholder="Uplink Mbps (optional)"
            title="Upload speed of the site's internet link, to show how full it is"
            type="number"
            min="0.1"
            step="0.1"
            value={uplink}
            onChange={(e) => setUplink(e.target.value)}
          />
          <button type="submit" className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add site
          </button>
        </form>

        {error && <div className="mb-4 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>}

        <div className="space-y-2">
          {managed.length === 0 && <p className="text-xs text-zinc-500 italic">No sites yet.</p>}
          {managed.map((site) => (
            <div key={site.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-3">
              {editingId === site.id ? (
                <>
                  <input className={`${inputCls} flex-1`} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <input className={`${inputCls} flex-1`} value={editAddress} placeholder="Address" onChange={(e) => setEditAddress(e.target.value)} />
                  <input
                    className={`${inputCls} w-[110px]`}
                    aria-label="Uplink Mbps"
                    placeholder="Uplink Mbps"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={editUplink}
                    onChange={(e) => setEditUplink(e.target.value)}
                  />
                  <button type="button" onClick={() => saveEdit(site.id!)} className="p-1.5 text-emerald-400 hover:text-emerald-300" title="Save">
                    <Check className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="p-1.5 text-zinc-400 hover:text-white" title="Cancel">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{site.name}</div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {site.cameraCount} camera{site.cameraCount === 1 ? '' : 's'}
                      {site.address ? ` · ${site.address}` : ''}
                      {site.uplinkMbps ? ` · ${site.uplinkMbps} Mbps uplink` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(site.id);
                      setEditName(site.name);
                      setEditAddress(site.address ?? '');
                      setEditUplink(site.uplinkMbps ? String(site.uplinkMbps) : '');
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white"
                    title="Rename"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={site.cameraCount > 0}
                    title={site.cameraCount > 0 ? 'Move or delete its cameras first' : 'Delete site'}
                    onClick={() => window.confirm(`Delete site ${site.name}?`) && call('DELETE', `/api/sites/${site.id}`)}
                    className="p-1.5 text-zinc-400 hover:text-red-400 disabled:opacity-30 disabled:hover:text-zinc-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          {unassigned && (
            <p className="text-[11px] text-amber-400/80 pt-1">
              {unassigned.cameraCount} camera{unassigned.cameraCount === 1 ? ' is' : 's are'} not assigned to a site.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
