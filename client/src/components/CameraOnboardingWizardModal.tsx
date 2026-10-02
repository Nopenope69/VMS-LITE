import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Search,
  Key,
  Wifi,
  Video,
  Eye,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Radio,
  Server,
  Film,
  Camera,
} from 'lucide-react';
import { WhepHlsPlayer } from './WhepHlsPlayer.js';

export interface CameraOnboardingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Sites the camera can be placed in (multi-site installs) */
  sites?: Array<{ id: string | null; name: string }>;
  defaultSiteId?: string | null;
}

export interface DiscoveredDevice {
  ip: string;
  port: number;
  xaddr: string;
  manufacturer?: string;
  model?: string;
  name?: string;
}

export interface StreamProfile {
  token: string;
  name: string;
  rtspUri: string;
  width?: number;
  height?: number;
  fps?: number;
  isMainStream?: boolean;
}

export const CameraOnboardingWizardModal: React.FC<CameraOnboardingWizardModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  sites = [],
  defaultSiteId = null,
}) => {
  const [siteId, setSiteId] = useState<string>('');
  // Stepper state (1 to 6)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Auth token from localStorage
  const getAuthToken = () =>
    localStorage.getItem('vms_token') || localStorage.getItem('token') || '';

  // Step 1: Discovery / Manual state
  const [isManualEntry, setIsManualEntry] = useState<boolean>(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Camera connection inputs
  const [cameraIp, setCameraIp] = useState<string>('');
  const [cameraPort, setCameraPort] = useState<number>(80);
  const [cameraXaddr, setCameraXaddr] = useState<string>('');
  const [username, setUsername] = useState<string>('admin');
  const [password, setPassword] = useState<string>('admin123');

  // Step 2: Auth probe & profiles state
  const [isProbingAuth, setIsProbingAuth] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<{
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
    serialNumber?: string;
  } | null>(null);
  const [profiles, setProfiles] = useState<StreamProfile[]>([]);
  const [selectedMainRtsp, setSelectedMainRtsp] = useState<string>('');
  const [selectedSubRtsp, setSelectedSubRtsp] = useState<string>('');

  // Step 3: Network latency probe state
  const [isProbingNetwork, setIsProbingNetwork] = useState<boolean>(false);
  const [networkLatencyMs, setNetworkLatencyMs] = useState<number | null>(null);
  const [isNetworkReachable, setIsNetworkReachable] = useState<boolean | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  // Step 4 & 5: Stream provisioning & preview state
  const [isProvisioningPreview, setIsProvisioningPreview] = useState<boolean>(false);
  const [previewPathName, setPreviewPathName] = useState<string | null>(null);
  const [previewWhepUrl, setPreviewWhepUrl] = useState<string | null>(null);
  const [previewHlsUrl, setPreviewHlsUrl] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Step 6: Commit state
  const [cameraName, setCameraName] = useState<string>('');
  const [recordingPolicy, setRecordingPolicy] = useState<string>('continuous_247');
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Clean up preview path if modal is closed or cancelled
  const teardownPreview = useCallback(async (pathName: string | null) => {
    if (!pathName) return;
    try {
      const token = getAuthToken();
      await fetch('/api/cameras/teardown-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pathName }),
      });
    } catch (err) {
      console.warn('[Wizard] Failed to clean up preview path:', err);
    }
  }, []);

  const handleClose = useCallback(async () => {
    if (previewPathName) {
      await teardownPreview(previewPathName);
    }
    onClose();
  }, [previewPathName, teardownPreview, onClose]);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      setIsManualEntry(false);
      setDiscoveredDevices([]);
      setScanError(null);
      setCameraIp('');
      setCameraPort(80);
      setCameraXaddr('');
      setUsername('admin');
      setPassword('admin123');
      setDeviceInfo(null);
      setProfiles([]);
      setSelectedMainRtsp('');
      setSelectedSubRtsp('');
      setNetworkLatencyMs(null);
      setIsNetworkReachable(null);
      setNetworkError(null);
      setPreviewPathName(null);
      setPreviewWhepUrl(null);
      setPreviewHlsUrl(null);
      setPreviewWarning(null);
      setPreviewError(null);
      setCameraName('');
      setCommitError(null);
      // Default to the site being viewed, or the only site there is
      setSiteId(defaultSiteId ?? (sites.length === 1 ? sites[0].id ?? '' : ''));
    }
  }, [isOpen]);

  // Scan subnet
  const runSubnetScan = async () => {
    setIsScanning(true);
    setScanError(null);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/cameras/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ timeoutMs: 3000 }),
      });

      if (!res.ok) {
        throw new Error('Discovery scan failed. Please check network interface.');
      }

      const data = await res.json();
      setDiscoveredDevices(data.devices || []);
      if (data.devices?.length === 0) {
        setScanError('No ONVIF cameras responded to multicast probe on local subnet.');
      }
    } catch (err: any) {
      setScanError(err.message || 'Discovery scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  // Select discovered camera
  const handleSelectDiscovered = (device: DiscoveredDevice) => {
    setCameraIp(device.ip);
    setCameraPort(device.port || 80);
    setCameraXaddr(device.xaddr || '');
    if (device.name) {
      setCameraName(device.name);
    }
    setCurrentStep(2);
  };

  // Step 2: Probe credentials & profiles
  const handleProbeAuth = async () => {
    if (!cameraIp) return;
    setIsProbingAuth(true);
    setAuthError(null);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/cameras/probe-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ip: cameraIp,
          port: Number(cameraPort) || 80,
          username,
          password,
          xaddr: cameraXaddr || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.message || 'Authentication failed. Please verify username and password.');
      }

      const data = await res.json();
      setDeviceInfo(data.device || {});
      setProfiles(data.profiles || []);

      // Auto-select main & sub profiles
      const main = data.profiles?.find((p: StreamProfile) => p.isMainStream) || data.profiles?.[0];
      const sub = data.profiles?.find((p: StreamProfile) => !p.isMainStream && p !== main);

      if (main) setSelectedMainRtsp(main.rtspUri);
      if (sub) setSelectedSubRtsp(sub.rtspUri);

      if (!cameraName && data.device?.model) {
        setCameraName(`${data.device.manufacturer || 'Camera'} ${data.device.model}`);
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsProbingAuth(false);
    }
  };

  // Step 3: Probe network latency
  const handleProbeNetwork = async () => {
    setIsProbingNetwork(true);
    setNetworkError(null);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/cameras/probe-network', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ip: cameraIp,
          port: 554, // RTSP standard port
          timeoutMs: 2500,
        }),
      });

      const data = await res.json();
      setIsNetworkReachable(data.reachable);
      setNetworkLatencyMs(data.latencyMs);
      if (!data.reachable) {
        setNetworkError(data.error || 'Port 554 closed or unreachable. Verify camera RTSP service.');
      }
    } catch (err: any) {
      setIsNetworkReachable(false);
      setNetworkError(err.message || 'TCP handshake failed');
    } finally {
      setIsProbingNetwork(false);
    }
  };

  // Step 4: Provision preview path
  const handleProvisionPreview = async () => {
    const streamToTest = selectedMainRtsp;
    if (!streamToTest) return;

    setIsProvisioningPreview(true);
    setPreviewError(null);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/cameras/provision-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rtspUrl: streamToTest }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.message || 'Failed to provision preview stream in MediaMTX');
      }

      const data = await res.json();
      setPreviewPathName(data.pathName);
      setPreviewWhepUrl(data.whepUrl);
      setPreviewHlsUrl(`/hls/${data.pathName}/index.m3u8`);
      setPreviewWarning(data.warning || null);
      setCurrentStep(5);
    } catch (err: any) {
      setPreviewError(err.message);
    } finally {
      setIsProvisioningPreview(false);
    }
  };

  // Step 6: Atomic Commit
  const handleCommitCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cameraName.trim() || !selectedMainRtsp) return;

    setIsCommitting(true);
    setCommitError(null);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/cameras/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: cameraName.trim(),
          siteId: siteId || null,
          ip: cameraIp || undefined,
          port: Number(cameraPort) || 554,
          username,
          password,
          rtspUrl: selectedMainRtsp,
          subStreamUrl: selectedSubRtsp || null,
          onvifUrl: cameraXaddr || null,
          manufacturer: deviceInfo?.manufacturer || null,
          model: deviceInfo?.model || null,
          serialNumber: deviceInfo?.serialNumber || null,
          previewPath: previewPathName || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.message || 'Database commit failed');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setCommitError(err.message || 'Failed to finalize camera onboarding');
    } finally {
      setIsCommitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '12px',
          maxWidth: '720px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#0f172a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ padding: '6px', backgroundColor: '#0284c7', borderRadius: '6px', color: '#fff' }}>
              <Camera size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>
                Camera Onboarding Wizard
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>
                6-Step Transactional Onboarding & Stream Verification
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* 6-Step Stepper Progress Bar */}
        <div
          style={{
            display: 'flex',
            backgroundColor: '#1e293b',
            borderBottom: '1px solid #334155',
            padding: '12px 16px',
            gap: '8px',
            overflowX: 'auto',
          }}
        >
          {[
            { step: 1, label: '1. Discovery' },
            { step: 2, label: '2. Auth & Profiles' },
            { step: 3, label: '3. Network Check' },
            { step: 4, label: '4. Provisioning' },
            { step: 5, label: '5. Visual Preview' },
            { step: 6, label: '6. Commit' },
          ].map((item) => {
            const isCompleted = currentStep > item.step;
            const isCurrent = currentStep === item.step;
            return (
              <div
                key={item.step}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: isCurrent ? 700 : 500,
                  color: isCompleted ? '#4ade80' : isCurrent ? '#38bdf8' : '#64748b',
                  whiteSpace: 'nowrap',
                }}
              >
                {isCompleted ? (
                  <CheckCircle2 size={13} style={{ color: '#4ade80' }} />
                ) : (
                  <span
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: isCurrent ? '#0284c7' : '#334155',
                      color: isCurrent ? '#fff' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '9px',
                    }}
                  >
                    {item.step}
                  </span>
                )}
                <span>{item.label}</span>
                {item.step < 6 && <span style={{ color: '#334155', margin: '0 4px' }}>›</span>}
              </div>
            );
          })}
        </div>

        {/* Step Workspace */}
        <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
          {/* ================= STEP 1: DISCOVERY ================= */}
          {currentStep === 1 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#cbd5e1' }}>
                  Locate ONVIF Profile T/S IP cameras across the local subnet or enter RTSP manually.
                </p>
                <button
                  type="button"
                  onClick={() => setIsManualEntry(!isManualEntry)}
                  style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: '12px', cursor: 'pointer' }}
                >
                  {isManualEntry ? '← Switch to Auto-Discovery' : '+ Manual IP / RTSP Entry'}
                </button>
              </div>

              {!isManualEntry ? (
                <div>
                  <button
                    type="button"
                    onClick={runSubnetScan}
                    disabled={isScanning}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: isScanning ? '#0369a1' : '#0284c7',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      cursor: isScanning ? 'not-allowed' : 'pointer',
                      marginBottom: '16px',
                    }}
                  >
                    {isScanning ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                    {isScanning ? 'Probing Subnet (WS-Discovery)...' : 'Scan Subnet for ONVIF Cameras'}
                  </button>

                  {scanError && (
                    <div style={{ padding: '10px 12px', backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '12px', marginBottom: '16px' }}>
                      {scanError}
                    </div>
                  )}

                  {discoveredDevices.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {discoveredDevices.map((dev, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSelectDiscovered(dev)}
                          style={{
                            padding: '12px',
                            backgroundColor: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer',
                            transition: 'border-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0284c7')}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#334155')}
                        >
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                              {dev.manufacturer || 'Generic ONVIF'} {dev.model ? `- ${dev.model}` : ''}
                            </div>
                            <div style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace', marginTop: '2px' }}>
                              {dev.ip}:{dev.port || 80}
                            </div>
                          </div>
                          <button
                            type="button"
                            style={{ padding: '6px 12px', backgroundColor: '#0284c7', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '12px', fontWeight: 600 }}
                          >
                            Select →
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>Camera IP Address</label>
                    <input
                      type="text"
                      placeholder="192.168.1.100"
                      value={cameraIp}
                      onChange={(e) => setCameraIp(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '13px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>ONVIF Port</label>
                      <input
                        type="number"
                        value={cameraPort}
                        onChange={(e) => setCameraPort(parseInt(e.target.value, 10) || 80)}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '13px' }}
                      />
                    </div>
                    <div style={{ flex: 2 }}>
                      <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>ONVIF Service URL (optional)</label>
                      <input
                        type="text"
                        placeholder="http://192.168.1.100/onvif/device_service"
                        value={cameraXaddr}
                        onChange={(e) => setCameraXaddr(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '13px' }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                    <button
                      type="button"
                      disabled={!cameraIp}
                      onClick={() => setCurrentStep(2)}
                      style={{
                        padding: '10px 18px',
                        backgroundColor: cameraIp ? '#0284c7' : '#334155',
                        border: 'none',
                        borderRadius: '6px',
                        color: cameraIp ? '#fff' : '#64748b',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: cameraIp ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Next: Credentials →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= STEP 2: AUTH & PROFILES ================= */}
          {currentStep === 2 && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#cbd5e1' }}>
                  Target IP: <code style={{ color: '#38bdf8' }}>{cameraIp}:{cameraPort}</code>
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  Provide device credentials to probe stream profiles and hardware specifications.
                </p>
              </div>

              {authError && (
                <div style={{ padding: '10px 12px', backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '12px', marginBottom: '16px' }}>
                  {authError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '13px' }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleProbeAuth}
                disabled={isProbingAuth}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: isProbingAuth ? '#0369a1' : '#0284c7',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: isProbingAuth ? 'not-allowed' : 'pointer',
                  marginBottom: '16px',
                }}
              >
                {isProbingAuth ? <RefreshCw size={15} className="animate-spin" /> : <Key size={15} />}
                {isProbingAuth ? 'Probing Credentials & ONVIF Profiles...' : 'Verify Credentials & Probe Profiles'}
              </button>

              {deviceInfo && (
                <div style={{ backgroundColor: '#0f172a', borderRadius: '8px', padding: '14px', border: '1px solid #334155', marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#4ade80', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle2 size={15} /> Authenticated Successfully
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>Manufacturer: <strong style={{ color: '#f8fafc' }}>{deviceInfo.manufacturer || 'Unknown'}</strong></div>
                    <div>Model: <strong style={{ color: '#f8fafc' }}>{deviceInfo.model || 'Unknown'}</strong></div>
                    <div>Firmware: <strong style={{ color: '#f8fafc' }}>{deviceInfo.firmwareVersion || 'Unknown'}</strong></div>
                    <div>Profiles Found: <strong style={{ color: '#f8fafc' }}>{profiles.length}</strong></div>
                  </div>
                </div>
              )}

              {profiles.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '8px' }}>
                    Detected Stream Profiles
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {profiles.map((p, idx) => {
                      const isMain = p.rtspUri === selectedMainRtsp;
                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedMainRtsp(p.rtspUri)}
                          style={{
                            padding: '10px 12px',
                            backgroundColor: isMain ? 'rgba(2, 132, 199, 0.15)' : '#0f172a',
                            border: `1px solid ${isMain ? '#0284c7' : '#334155'}`,
                            borderRadius: '6px',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                              {p.name || `Profile ${idx + 1}`}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: p.isMainStream ? '#0284c7' : '#334155',
                                color: '#fff',
                              }}
                            >
                              {p.isMainStream ? 'MAIN STREAM (HD)' : 'SUB STREAM'}
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace', marginTop: '4px', wordBreak: 'break-all' }}>
                            {p.rtspUri}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  style={{ padding: '8px 14px', backgroundColor: '#334155', border: 'none', borderRadius: '4px', color: '#cbd5e1', fontSize: '12px', cursor: 'pointer' }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  disabled={!selectedMainRtsp}
                  onClick={() => {
                    setCurrentStep(3);
                    handleProbeNetwork();
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: selectedMainRtsp ? '#0284c7' : '#334155',
                    border: 'none',
                    borderRadius: '4px',
                    color: selectedMainRtsp ? '#fff' : '#64748b',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: selectedMainRtsp ? 'pointer' : 'not-allowed',
                  }}
                >
                  Next: Network Check →
                </button>
              </div>
            </div>
          )}

          {/* ================= STEP 3: NETWORK CHECK ================= */}
          {currentStep === 3 && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                  Network Latency & RTSP Port Verification
                </h4>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  Performing round-trip TCP handshake to verify connection stability and bandwidth.
                </p>
              </div>

              {isProbingNetwork ? (
                <div style={{ padding: '36px', textAlign: 'center', backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155' }}>
                  <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px auto', color: '#38bdf8' }} />
                  <p style={{ margin: 0, fontSize: '13px', color: '#cbd5e1' }}>Testing TCP Handshake to port 554...</p>
                </div>
              ) : isNetworkReachable ? (
                <div style={{ backgroundColor: '#0f172a', borderRadius: '8px', padding: '20px', border: '1px solid #22c55e', textAlign: 'center' }}>
                  <div style={{ display: 'inline-flex', padding: '10px', backgroundColor: 'rgba(34,197,94,0.2)', borderRadius: '50%', color: '#4ade80', marginBottom: '10px' }}>
                    <Wifi size={24} />
                  </div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600, color: '#4ade80' }}>
                    Camera Reachable & Responsive
                  </h4>
                  <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#cbd5e1' }}>
                    Round-trip Handshake RTT:{' '}
                    <strong style={{ color: '#f8fafc' }}>{networkLatencyMs !== null ? `${networkLatencyMs} ms` : 'Nominal'}</strong>
                  </p>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    RTSP port 554 is open. Ready for MediaMTX ingestion.
                  </div>
                </div>
              ) : (
                <div style={{ backgroundColor: '#0f172a', borderRadius: '8px', padding: '20px', border: '1px solid #ef4444' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#f87171', marginBottom: '8px' }}>
                    <AlertTriangle size={20} />
                    <strong style={{ fontSize: '14px' }}>Port Check Notice</strong>
                  </div>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#fca5a5' }}>
                    {networkError || 'Port 554 could not be reached via standard TCP handshake.'}
                  </p>
                  <button
                    type="button"
                    onClick={handleProbeNetwork}
                    style={{ padding: '6px 12px', backgroundColor: '#334155', border: 'none', borderRadius: '4px', color: '#cbd5e1', fontSize: '12px', cursor: 'pointer' }}
                  >
                    Retry Handshake
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  style={{ padding: '8px 14px', backgroundColor: '#334155', border: 'none', borderRadius: '4px', color: '#cbd5e1', fontSize: '12px', cursor: 'pointer' }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep(4);
                    handleProvisionPreview();
                  }}
                  style={{
                    padding: '8px 18px',
                    backgroundColor: '#0284c7',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Next: Provision Stream →
                </button>
              </div>
            </div>
          )}

          {/* ================= STEP 4 & 5: PROVISIONING & VISUAL PREVIEW ================= */}
          {(currentStep === 4 || currentStep === 5) && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                  Visual Stream Validation (WebRTC WHEP)
                </h4>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  Confirm camera alignment, focus, and stream smoothness before committing to system.
                </p>
              </div>

              {isProvisioningPreview ? (
                <div style={{ padding: '48px', textAlign: 'center', backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155' }}>
                  <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 12px auto', color: '#38bdf8' }} />
                  <p style={{ margin: 0, fontSize: '14px', color: '#f8fafc', fontWeight: 600 }}>
                    Provisioning Temporary MediaMTX Pull Source...
                  </p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                    Awaiting first RTSP keyframe from camera
                  </p>
                </div>
              ) : previewError ? (
                <div style={{ padding: '16px', backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', marginBottom: '8px' }}>
                    <AlertTriangle size={18} />
                    <strong style={{ fontSize: '13px' }}>Preview Ingestion Failed</strong>
                  </div>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#fca5a5' }}>{previewError}</p>
                  <button
                    type="button"
                    onClick={handleProvisionPreview}
                    style={{ padding: '6px 12px', backgroundColor: '#0284c7', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '12px', cursor: 'pointer' }}
                  >
                    Retry Ingestion
                  </button>
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      height: '280px',
                      backgroundColor: '#000',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      position: 'relative',
                      border: '1px solid #334155',
                      marginBottom: '12px',
                    }}
                  >
                    {previewWhepUrl && (
                      <WhepHlsPlayer
                        whepUrl={previewWhepUrl}
                        hlsUrl={previewHlsUrl || ''}
                        cameraName={cameraName || 'Preview Stream'}
                      />
                    )}
                  </div>

                  {previewWarning && (
                    <div style={{ padding: '8px 12px', backgroundColor: 'rgba(250,204,21,0.15)', border: '1px solid #facc15', borderRadius: '6px', color: '#fde047', fontSize: '11px', marginBottom: '12px' }}>
                      {previewWarning}
                    </div>
                  )}

                  <div style={{ padding: '10px 14px', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #334155', fontSize: '12px', color: '#94a3b8' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#4ade80', fontWeight: 600, marginBottom: '2px' }}>
                      <CheckCircle2 size={14} /> WebRTC Media Ingress Verified
                    </div>
                    <div>Source: <code style={{ color: '#38bdf8' }}>{selectedMainRtsp}</code></div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  style={{ padding: '8px 14px', backgroundColor: '#334155', border: 'none', borderRadius: '4px', color: '#cbd5e1', fontSize: '12px', cursor: 'pointer' }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(6)}
                  style={{
                    padding: '8px 18px',
                    backgroundColor: '#22c55e',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Confirm Video Stream & Proceed →
                </button>
              </div>
            </div>
          )}

          {/* ================= STEP 6: COMMIT ================= */}
          {currentStep === 6 && (
            <form onSubmit={handleCommitCamera}>
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                  Finalize Camera Configuration
                </h4>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  Assign an identifier and attach default continuous recording schedule.
                </p>
              </div>

              {commitError && (
                <div style={{ padding: '10px 12px', backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '12px', marginBottom: '16px' }}>
                  {commitError}
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
                  Camera Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Front Gate North"
                  value={cameraName}
                  onChange={(e) => setCameraName(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '13px' }}
                />
              </div>

              {sites.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
                    Site
                  </label>
                  <select
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '13px' }}
                  >
                    <option value="">No site</option>
                    {sites.map((site) => (
                      <option key={site.id ?? ''} value={site.id ?? ''}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
                  Recording Policy
                </label>
                <select
                  value={recordingPolicy}
                  onChange={(e) => setRecordingPolicy(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc', fontSize: '13px' }}
                >
                  <option value="continuous_247">24/7 Continuous Recording (Packet-Preserving fMP4)</option>
                  <option value="motion_buffer">Motion Ring Buffer (Pre/Post Event)</option>
                  <option value="scheduled">Weekly Schedule Window</option>
                </select>
              </div>

              <div style={{ backgroundColor: '#0f172a', borderRadius: '8px', padding: '14px', border: '1px solid #334155', marginBottom: '20px', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>Onboarding Summary</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', color: '#94a3b8' }}>
                  <div>IP Address: <span style={{ color: '#f8fafc' }}>{cameraIp}</span></div>
                  <div>RTSP Port: <span style={{ color: '#f8fafc' }}>554</span></div>
                  <div>Manufacturer: <span style={{ color: '#f8fafc' }}>{deviceInfo?.manufacturer || 'Generic ONVIF'}</span></div>
                  <div>Status: <span style={{ color: '#4ade80' }}>Streaming Verified</span></div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(5)}
                  style={{ padding: '8px 14px', backgroundColor: '#334155', border: 'none', borderRadius: '4px', color: '#cbd5e1', fontSize: '12px', cursor: 'pointer' }}
                >
                  ← Back to Preview
                </button>
                <button
                  type="submit"
                  disabled={isCommitting || !cameraName.trim()}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: isCommitting ? '#0369a1' : '#0284c7',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: isCommitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  {isCommitting && <RefreshCw size={15} className="animate-spin" />}
                  {isCommitting ? 'Committing Camera...' : 'Complete Onboarding & Attach to System'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default CameraOnboardingWizardModal;
