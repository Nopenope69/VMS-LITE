import React, { useState, useEffect } from 'react';
import {
  X,
  MapPin,
  Shield,
  Plus,
  Trash2,
  Edit2,
  Check,
  Video,
  Layers,
  RotateCcw,
  Search,
  CheckCircle2,
} from 'lucide-react';
import { CameraStreamInfo } from './LiveCameraTile.js';

export interface VmsLocation {
  id: string;
  name: string;
  code: string;
  icon?: string;
  cameraIds: string[];
  isDefault?: boolean;
}

export interface VmsZone {
  id: string;
  name: string;
  color: string;
  icon?: string;
  cameraIds: string[];
}

export interface LocationZoneManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: CameraStreamInfo[];
  authToken?: string;
  onLocationsChanged?: () => void;
}

const AVAILABLE_ICONS = ['🏢', '🏭', '🏙️', '💻', '🏪', '🏦', '🚪', '⚙️', '🛡️', '🚗', '📦', '📹'];
const AVAILABLE_COLORS = ['#4fc3f7', '#10b981', '#fb923c', '#a78bfa', '#f43f5e', '#eab308', '#06b6d4', '#ec4899'];

export const LocationZoneManagerModal: React.FC<LocationZoneManagerModalProps> = ({
  isOpen,
  onClose,
  cameras,
  authToken = '',
  onLocationsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'locations' | 'zones'>('locations');
  const [locations, setLocations] = useState<VmsLocation[]>([]);
  const [zones, setZones] = useState<VmsZone[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // Edit / Create Form State
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formCode, setFormCode] = useState<string>('');
  const [formIcon, setFormIcon] = useState<string>('🏢');
  const [formColor, setFormColor] = useState<string>('#4fc3f7');
  const [formSelectedCameraIds, setFormSelectedCameraIds] = useState<Set<string>>(new Set());
  const [camFilter, setCamFilter] = useState<string>('');

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/locations');
      if (res.ok) {
        const data = await res.json();
        setLocations(data.locations || []);
        setZones(data.zones || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      fetchConfig();
      setIsEditing(false);
      setEditingId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 3500);
  };

  const startCreateLocation = () => {
    setIsEditing(true);
    setEditingId(null);
    setFormName('');
    setFormCode('');
    setFormIcon('🏢');
    setFormSelectedCameraIds(new Set());
    setCamFilter('');
  };

  const startEditLocation = (loc: VmsLocation) => {
    setIsEditing(true);
    setEditingId(loc.id);
    setFormName(loc.name);
    setFormCode(loc.code);
    setFormIcon(loc.icon || '🏢');
    setFormSelectedCameraIds(new Set(loc.cameraIds || []));
    setCamFilter('');
  };

  const startCreateZone = () => {
    setIsEditing(true);
    setEditingId(null);
    setFormName('');
    setFormIcon('🛡️');
    setFormColor('#4fc3f7');
    setFormSelectedCameraIds(new Set());
    setCamFilter('');
  };

  const startEditZone = (zone: VmsZone) => {
    setIsEditing(true);
    setEditingId(zone.id);
    setFormName(zone.name);
    setFormIcon(zone.icon || '🛡️');
    setFormColor(zone.color || '#4fc3f7');
    setFormSelectedCameraIds(new Set(zone.cameraIds || []));
    setCamFilter('');
  };

  const toggleCameraSelection = (camId: string) => {
    setFormSelectedCameraIds((prev) => {
      const next = new Set(prev);
      if (next.has(camId)) {
        next.delete(camId);
      } else {
        next.add(camId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      showToast('Name is required');
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };

    try {
      if (activeTab === 'locations') {
        const payload = {
          name: formName.trim(),
          code: formCode.trim() || formName.slice(0, 3).toUpperCase(),
          icon: formIcon,
          cameraIds: Array.from(formSelectedCameraIds),
        };

        if (editingId) {
          // Update
          const res = await fetch(`/api/v1/locations/${editingId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            showToast(`Location "${formName}" updated`);
          }
        } else {
          // Create
          const res = await fetch('/api/v1/locations', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            showToast(`New location "${formName}" created`);
          }
        }
      } else {
        // Operational Zone
        const payload = {
          name: formName.trim(),
          color: formColor,
          icon: formIcon,
          cameraIds: Array.from(formSelectedCameraIds),
        };

        if (editingId) {
          const res = await fetch(`/api/v1/locations/zones/${editingId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            showToast(`Zone "${formName}" updated`);
          }
        } else {
          const res = await fetch('/api/v1/locations/zones', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            showToast(`New zone "${formName}" created`);
          }
        }
      }

      setIsEditing(false);
      setEditingId(null);
      await fetchConfig();
      onLocationsChanged?.();
    } catch {
      showToast('Failed to save changes');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    try {
      const url = activeTab === 'locations' ? `/api/v1/locations/${id}` : `/api/v1/locations/zones/${id}`;
      const res = await fetch(url, { method: 'DELETE', headers });
      if (res.ok) {
        showToast(`Deleted "${name}"`);
        await fetchConfig();
        onLocationsChanged?.();
      }
    } catch {
      showToast('Failed to delete item');
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all locations and operational zones to system defaults?')) return;
    try {
      const res = await fetch('/api/v1/locations/reset', {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (res.ok) {
        showToast('Reset to default locations and zones');
        await fetchConfig();
        onLocationsChanged?.();
      }
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-sans">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[90vh] bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2937] bg-[#090d16]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 text-[#4fc3f7]">
              {activeTab === 'locations' ? <MapPin className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100 tracking-tight">
                  Locations & Operational Zones Customizer
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#4fc3f7]/20 text-[#4fc3f7] border border-[#4fc3f7]/40">
                  ENTERPRISE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Customize office branches, sites, and security zones with camera assignments
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toast */}
        {actionToast && (
          <div className="bg-[#4fc3f7]/20 border-b border-[#4fc3f7]/40 px-6 py-2 flex items-center gap-2 text-xs font-semibold text-[#4fc3f7]">
            <CheckCircle2 className="w-4 h-4" />
            <span>{actionToast}</span>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex border-b border-[#1f2937] bg-[#0d1424] px-6 gap-2 justify-between items-center">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('locations');
                setIsEditing(false);
              }}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'locations'
                  ? 'border-[#4fc3f7] text-[#4fc3f7]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <MapPin className="w-4 h-4" />
              <span>1. Office & Branch Locations ({locations.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('zones');
                setIsEditing(false);
              }}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'zones'
                  ? 'border-[#4fc3f7] text-[#4fc3f7]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>2. Operational Zones & Areas ({zones.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2 py-1">
            <button
              type="button"
              onClick={handleReset}
              title="Reset all to defaults"
              className="flex items-center gap-1 px-2.5 py-1 text-slate-400 hover:text-white text-xs rounded hover:bg-[#1f2937]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset Defaults</span>
            </button>

            {!isEditing && (
              <button
                type="button"
                onClick={activeTab === 'locations' ? startCreateLocation : startCreateZone}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add {activeTab === 'locations' ? 'Location' : 'Zone'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {isEditing ? (
            /* CREATE / EDIT FORM */
            <div className="space-y-5 bg-[#090d16] p-5 rounded-lg border border-[#1f2937]">
              <div className="flex items-center justify-between pb-3 border-b border-[#1f2937]">
                <h3 className="text-sm font-bold text-[#4fc3f7]">
                  {editingId ? `Edit ${activeTab === 'locations' ? 'Location' : 'Zone'}` : `Create New ${activeTab === 'locations' ? 'Location' : 'Zone'}`}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {activeTab === 'locations' ? 'Location Name' : 'Zone / Area Name'} *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={activeTab === 'locations' ? 'e.g. Kolkata Regional Office' : 'e.g. Server Room & Vault'}
                    className="w-full bg-[#111827] border border-[#1f2937] rounded px-3 py-2 text-xs text-slate-100 outline-none focus:border-[#4fc3f7]"
                  />
                </div>

                {activeTab === 'locations' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Site Code (Optional)
                    </label>
                    <input
                      type="text"
                      value={formCode}
                      onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                      placeholder="e.g. KOL-01"
                      className="w-full bg-[#111827] border border-[#1f2937] rounded px-3 py-2 text-xs text-slate-100 outline-none focus:border-[#4fc3f7] uppercase font-mono"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Zone Highlight Color
                    </label>
                    <div className="flex items-center gap-2">
                      {AVAILABLE_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setFormColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-6 h-6 rounded-full border-2 transition-transform ${
                            formColor === c ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:scale-105'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Select Visual Icon
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setFormIcon(icon)}
                      className={`w-9 h-9 rounded-lg border text-lg flex items-center justify-center transition-all ${
                        formIcon === icon
                          ? 'border-[#4fc3f7] bg-[#4fc3f7]/20 shadow-md scale-105'
                          : 'border-[#1f2937] bg-[#111827] hover:border-[#4fc3f7]/50'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Camera Multi-Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <Video className="w-3.5 h-3.5 text-[#4fc3f7]" />
                    <span>Assign Cameras ({formSelectedCameraIds.size} selected)</span>
                  </label>
                  <div className="relative w-48">
                    <Search className="w-3 h-3 absolute left-2 top-2.5 text-slate-500" />
                    <input
                      type="text"
                      value={camFilter}
                      onChange={(e) => setCamFilter(e.target.value)}
                      placeholder="Filter cameras..."
                      className="w-full bg-[#111827] border border-[#1f2937] rounded px-2 py-1 pl-7 text-[11px] text-slate-100 outline-none"
                    />
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto border border-[#1f2937] rounded-lg p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-[#111827]">
                  {cameras.length === 0 ? (
                    <div className="text-xs text-slate-500 p-2 col-span-2 text-center">
                      No cameras registered in system
                    </div>
                  ) : (
                    cameras
                      .filter((c) => c.name.toLowerCase().includes(camFilter.toLowerCase()))
                      .map((c) => {
                        const isChecked = formSelectedCameraIds.has(c.cameraId);
                        return (
                          <label
                            key={c.cameraId}
                            className={`flex items-center gap-2 p-2 rounded border cursor-pointer select-none transition-colors ${
                              isChecked
                                ? 'bg-[#4fc3f7]/15 border-[#4fc3f7]/50 text-slate-100'
                                : 'bg-[#090d16] border-[#1f2937] text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCameraSelection(c.cameraId)}
                              className="accent-[#4fc3f7]"
                            />
                            <span className="text-xs font-medium truncate">{c.name}</span>
                          </label>
                        );
                      })
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#1f2937]">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 bg-[#1f2937] hover:bg-[#374151] text-xs font-semibold rounded text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-5 py-2 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded shadow-md"
                >
                  Save {activeTab === 'locations' ? 'Location' : 'Zone'}
                </button>
              </div>
            </div>
          ) : (
            /* LIST VIEW */
            <div className="space-y-4">
              {activeTab === 'locations' ? (
                /* LOCATIONS LIST */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {locations.map((loc) => {
                    const assignedCams = cameras.filter((c) => loc.cameraIds?.includes(c.cameraId));
                    return (
                      <div
                        key={loc.id}
                        className="p-4 rounded-lg bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/50 transition-colors flex flex-col justify-between shadow-md"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2.5">
                            <span className="text-2xl">{loc.icon || '🏢'}</span>
                            <div>
                              <h4 className="text-sm font-bold text-slate-100">{loc.name}</h4>
                              <span className="text-[10px] font-mono text-[#4fc3f7] bg-[#4fc3f7]/10 px-1.5 py-0.5 rounded border border-[#4fc3f7]/30">
                                {loc.code}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEditLocation(loc)}
                              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-[#1f2937]"
                              title="Edit Location"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(loc.id, loc.name)}
                              className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-[#1f2937]"
                              title="Delete Location"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-[#1f2937]/80 text-[11px] text-slate-400 flex items-center justify-between">
                          <span>
                            {assignedCams.length > 0
                              ? `${assignedCams.length} Assigned Cameras`
                              : `${loc.cameraIds?.length || 0} Cameras`}
                          </span>
                          <span className="text-slate-500 font-mono text-[10px]">ID: {loc.id}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ZONES LIST */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {zones.map((zone) => {
                    const assignedCams = cameras.filter((c) => zone.cameraIds?.includes(c.cameraId));
                    return (
                      <div
                        key={zone.id}
                        className="p-4 rounded-lg bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/50 transition-colors flex flex-col justify-between shadow-md"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2.5">
                            <span className="text-2xl">{zone.icon || '🛡️'}</span>
                            <div>
                              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                                <span
                                  className="w-2.5 h-2.5 rounded-full inline-block"
                                  style={{ backgroundColor: zone.color }}
                                />
                                {zone.name}
                              </h4>
                              <span
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                                style={{
                                  color: zone.color,
                                  borderColor: `${zone.color}50`,
                                  backgroundColor: `${zone.color}15`,
                                }}
                              >
                                {zone.id.toUpperCase()}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEditZone(zone)}
                              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-[#1f2937]"
                              title="Edit Zone"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(zone.id, zone.name)}
                              className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-[#1f2937]"
                              title="Delete Zone"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-[#1f2937]/80 text-[11px] text-slate-400 flex items-center justify-between">
                          <span>
                            {assignedCams.length > 0
                              ? `${assignedCams.length} Assigned Cameras`
                              : `${zone.cameraIds?.length || 0} Cameras`}
                          </span>
                          <span className="text-slate-500 font-mono text-[10px]">ID: {zone.id}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocationZoneManagerModal;
