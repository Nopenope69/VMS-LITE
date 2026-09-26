import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Camera,
  Search,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Radio,
  Server,
  Activity,
  Layers,
  Shield,
} from 'lucide-react';

export interface DiscoveredDevice {
  urn?: string;
  name?: string;
  ip: string;
  port: number;
  xaddr?: string;
  xaddrs?: string;
  endpoint?: string;
  hardware?: string;
  location?: string;
  manufacturer?: string;
}

export interface CameraManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  authToken?: string;
  onCamerasChanged?: () => void;
}

export const CameraManagementModal: React.FC<CameraManagementModalProps> = ({
  isOpen,
  onClose,
  authToken,
  onCamerasChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'discover' | 'manual' | 'inventory'>('discover');

  // Discovery state
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  // Onboarding credentials per device, keyed uniquely by URN or XADDR
  const [onboardForm, setOnboardForm] = useState<{
    [devKey: string]: { name: string; username: string; password: string };
  }>({});
  const [onboardingKey, setOnboardingKey] = useState<string | null>(null);

  // Manual RTSP state
  const [manualName, setManualName] = useState('');
  const [manualRtspUrl, setManualRtspUrl] = useState('');
  const [manualSubStreamUrl, setManualSubStreamUrl] = useState('');
  const [manualZone, setManualZone] = useState('General');
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  // Active inventory state
  const [registeredCameras, setRegisteredCameras] = useState<any[]>([]);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);

  const authHeaders = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };

  // Fetch registered cameras
  const fetchCameras = useCallback(async () => {
    setIsLoadingInventory(true);
    try {
      const res = await fetch('/api/cameras', { credentials: 'omit', headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setRegisteredCameras(data.cameras || data || []);
      }
    } catch {}
    setIsLoadingInventory(false);
  }, [authToken]);

  useEffect(() => {
    if (isOpen) {
      fetchCameras();
    }
  }, [isOpen, fetchCameras]);

  // Run ONVIF WS-Discovery Scan
  const handleScanSubnet = async () => {
    setIsScanning(true);
    setScanError(null);
    try {
      const res = await fetch('/api/cameras/discover', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ timeoutMs: 3500 }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Discovery scan failed');
      }
      setDiscoveredDevices(data.devices || []);
    } catch (err: any) {
      setScanError(err.message || 'Subnet scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  // Onboard Discovered ONVIF Camera
  const handleOnboardDiscovered = async (dev: DiscoveredDevice) => {
    const devKey = dev.urn || dev.xaddr || dev.xaddrs || `${dev.ip}:${dev.port}`;
    const creds = onboardForm[devKey] || {
      name: dev.name || `Camera-${dev.ip.split('.').pop()}`,
      username: 'admin',
      password: 'admin123',
    };

    const targetUrl = dev.xaddr || dev.xaddrs || `http://${dev.ip}:${dev.port || 80}/onvif/device_service`;

    setOnboardingKey(devKey);
    try {
      const res = await fetch('/api/cameras', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: creds.name || dev.name || `Camera ${dev.ip}`,
          ip: dev.ip,
          port: dev.port || 80,
          xaddr: targetUrl,
          onvifUrl: targetUrl,
          username: creds.username || 'admin',
          password: creds.password || 'admin123',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to onboard camera');
      }

      await fetchCameras();
      onCamerasChanged?.();
      // Remove from discovered list
      setDiscoveredDevices((prev) =>
        prev.filter((d) => (d.urn || d.xaddr || d.xaddrs || `${d.ip}:${d.port}`) !== devKey)
      );
    } catch (err: any) {
      alert(`Onboarding failed: ${err.message}`);
    } finally {
      setOnboardingKey(null);
    }
  };

  // Onboard Manual RTSP Camera
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingManual(true);
    setManualError(null);
    setManualSuccess(null);

    try {
      const res = await fetch('/api/cameras', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: manualName,
          rtspUrl: manualRtspUrl,
          subStreamUrl: manualSubStreamUrl || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to onboard camera');
      }

      setManualSuccess(`Camera "${manualName}" successfully registered!`);
      setManualName('');
      setManualRtspUrl('');
      setManualSubStreamUrl('');
      await fetchCameras();
      onCamerasChanged?.();
    } catch (err: any) {
      setManualError(err.message || 'Failed to register manual RTSP camera');
    } finally {
      setIsSubmittingManual(false);
    }
  };

  // Delete Camera
  const handleDeleteCamera = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove "${name}" from Basic VMS?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/cameras/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        await fetchCameras();
        onCamerasChanged?.();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-3xl bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#090d16] border-b border-[#1f2937]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/30 text-[#4fc3f7]">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 font-mono tracking-wide">
                CAMERA MANAGEMENT & DISCOVERY
              </h2>
              <p className="text-[11px] text-slate-400">
                1-Click ONVIF scan, RTSP onboarding & zero-transcode configuration
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-5 py-2.5 bg-[#090d16]/60 border-b border-[#1f2937] text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all ${
              activeTab === 'discover'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>LAN Auto-Discovery (ONVIF)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all ${
              activeTab === 'manual'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Manual RTSP Stream</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all ${
              activeTab === 'inventory'
                ? 'bg-[#4fc3f7] text-[#090d16] shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Active Cameras ({registeredCameras.length})</span>
          </button>
        </div>

        {/* Body Area */}
        <div className="p-5 overflow-y-auto flex-1">
          {/* TAB 1: ONVIF LAN DISCOVERY */}
          {activeTab === 'discover' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3.5 rounded-lg bg-[#090d16] border border-[#1f2937]">
                <div>
                  <h3 className="text-xs font-bold text-slate-100 font-mono">
                    SUBNET WS-DISCOVERY SCANNER
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Scans local IP network for CP Plus, Hikvision, Dahua & ONVIF Profile T/S devices
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isScanning}
                  onClick={handleScanSubnet}
                  className="flex items-center gap-2 px-4 py-2 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-lg shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                  <span>{isScanning ? 'Scanning LAN Subnet...' : 'Scan Local Network'}</span>
                </button>
              </div>

              {scanError && (
                <div className="p-3 bg-red-950/60 border border-red-500/50 rounded-lg text-xs text-red-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{scanError}</span>
                </div>
              )}

              {/* Scan Results */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono text-slate-400 font-semibold uppercase">
                  Discovered IP Cameras ({discoveredDevices.length})
                </span>

                {discoveredDevices.length === 0 && !isScanning ? (
                  <div className="p-8 text-center bg-[#090d16] border border-[#1f2937] rounded-lg">
                    <Search className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">
                      No un-onboarded ONVIF cameras found. Click "Scan Local Network" to search.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {discoveredDevices.map((dev, idx) => {
                      const devKey = dev.urn || dev.xaddr || dev.xaddrs || `${dev.ip}:${dev.port}-${idx}`;
                      const creds = onboardForm[devKey] || {
                        name: dev.name || `Camera-${idx + 1}`,
                        username: 'admin',
                        password: 'admin123',
                      };

                      return (
                        <div
                          key={devKey}
                          className="p-3.5 rounded-lg bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-3"
                        >
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-100 text-xs font-mono">
                                {dev.location || `${dev.ip}:${dev.port}`}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#4fc3f7]/15 text-[#4fc3f7] border border-[#4fc3f7]/30">
                                {dev.hardware || dev.manufacturer || 'ONVIF Profile S/T'}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono truncate block mt-0.5 max-w-sm" title={dev.xaddr || dev.xaddrs}>
                              {dev.xaddr || dev.xaddrs}
                            </span>
                          </div>

                          {/* Quick Onboard Inline Form */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <input
                              type="text"
                              placeholder="Camera Name"
                              value={creds.name}
                              onChange={(e) =>
                                setOnboardForm((prev) => ({
                                  ...prev,
                                  [devKey]: { ...creds, name: e.target.value },
                                }))
                              }
                              className="w-48 bg-[#111827] border border-[#1f2937] rounded px-2 py-1 text-xs text-slate-100 outline-none focus:border-[#4fc3f7]"
                            />
                            <input
                              type="text"
                              placeholder="Username"
                              value={creds.username}
                              onChange={(e) =>
                                setOnboardForm((prev) => ({
                                  ...prev,
                                  [devKey]: { ...creds, username: e.target.value },
                                }))
                              }
                              className="w-20 bg-[#111827] border border-[#1f2937] rounded px-2 py-1 text-xs text-slate-100 outline-none focus:border-[#4fc3f7]"
                            />
                            <input
                              type="password"
                              placeholder="Password"
                              value={creds.password}
                              onChange={(e) =>
                                setOnboardForm((prev) => ({
                                  ...prev,
                                  [devKey]: { ...creds, password: e.target.value },
                                }))
                              }
                              className="w-24 bg-[#111827] border border-[#1f2937] rounded px-2 py-1 text-xs text-slate-100 outline-none focus:border-[#4fc3f7]"
                            />
                            <button
                              type="button"
                              disabled={onboardingKey === devKey}
                              onClick={() => handleOnboardDiscovered(dev)}
                              className="px-3 py-1 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded transition-colors disabled:opacity-50 shrink-0"
                            >
                              {onboardingKey === devKey ? 'Onboarding...' : 'Onboard'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: MANUAL RTSP ONBOARDING */}
          {activeTab === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-4 max-w-xl">
              <div>
                <h3 className="text-xs font-bold text-slate-100 font-mono">
                  MANUAL RTSP STREAM ONBOARDING
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Direct packet-preserving RTSP ingest without ONVIF discovery
                </p>
              </div>

              {manualSuccess && (
                <div className="p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-lg text-xs text-emerald-200 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{manualSuccess}</span>
                </div>
              )}

              {manualError && (
                <div className="p-3 bg-red-950/60 border border-red-500/50 rounded-lg text-xs text-red-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{manualError}</span>
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Camera Name / Location
                  </label>
                  <input
                    type="text"
                    required
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="e.g. Gate 1 Dispatch Bay"
                    className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-slate-100 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Main Stream RTSP URL (High Resolution 1080p/4K)
                  </label>
                  <input
                    type="text"
                    required
                    value={manualRtspUrl}
                    onChange={(e) => setManualRtspUrl(e.target.value)}
                    placeholder="rtsp://admin:password@192.168.1.100:554/live/ch0"
                    className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-slate-100 outline-none font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Sub-Stream RTSP URL (Optional Low-Bitrate Grid Stream)
                  </label>
                  <input
                    type="text"
                    value={manualSubStreamUrl}
                    onChange={(e) => setManualSubStreamUrl(e.target.value)}
                    placeholder="rtsp://admin:password@192.168.1.100:554/live/ch1"
                    className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-slate-100 outline-none font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Zone Assignment
                  </label>
                  <select
                    value={manualZone}
                    onChange={(e) => setManualZone(e.target.value)}
                    className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-slate-100 outline-none text-xs"
                  >
                    <option value="General">General / Site-Wide</option>
                    <option value="Gates">Zone 1: Gates & Entry</option>
                    <option value="Production">Zone 2: Production Floor</option>
                    <option value="Warehouse">Zone 3: Warehouse & Dispatch</option>
                    <option value="Perimeter">Zone 4: Perimeter & Fences</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingManual}
                className="px-5 py-2.5 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-lg shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>{isSubmittingManual ? 'Registering Stream...' : 'Register Camera Stream'}</span>
              </button>
            </form>
          )}

          {/* TAB 3: ACTIVE CAMERA INVENTORY */}
          {activeTab === 'inventory' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#1f2937]">
                <span className="text-xs font-mono font-bold text-slate-300">
                  SYSTEM REGISTERED CAMERAS ({registeredCameras.length})
                </span>
                <button
                  type="button"
                  onClick={fetchCameras}
                  className="flex items-center gap-1 text-[11px] text-[#4fc3f7] hover:underline"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingInventory ? 'animate-spin' : ''}`} />
                  <span>Refresh Inventory</span>
                </button>
              </div>

              {registeredCameras.length === 0 ? (
                <div className="p-8 text-center bg-[#090d16] border border-[#1f2937] rounded-lg">
                  <p className="text-xs text-slate-400">No cameras configured yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {registeredCameras.map((cam) => (
                    <div
                      key={cam.id}
                      className="p-3 rounded-lg bg-[#090d16] border border-[#1f2937] flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded bg-[#111827] border border-[#1f2937] text-[#4fc3f7]">
                          <Camera className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-bold text-slate-100">{cam.name}</span>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-mono">
                            <span>ID: {cam.id}</span>
                            <span>•</span>
                            <span>Path: {cam.mediaMtxPath || cam.id}</span>
                            {cam.subStreamPath && (
                              <>
                                <span>•</span>
                                <span className="text-[#4fc3f7]">Dual-Stream Ready</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteCamera(cam.id, cam.name)}
                        title="Delete camera configuration"
                        className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
