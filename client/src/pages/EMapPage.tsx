import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Map,
  Shield,
  Radio,
  Film,
  Plus,
  Compass,
  Move,
  RotateCw,
  Video,
  X,
  Save,
  Check,
  AlertCircle,
  Eye,
  Activity,
  Layers,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { OperatorBanner } from '../components/OperatorBanner.js';

export interface CameraMarker {
  cameraId: string;
  cameraName?: string;
  x: number; // 0 to 100
  y: number; // 0 to 100
  angle: number; // 0 to 360
  fovDegrees?: number;
}

export interface FloorPlan {
  id: string;
  name: string;
  description?: string;
  imageUrl: string;
  widthMeters?: number;
  heightMeters?: number;
  markers: CameraMarker[];
}

export interface EMapPageProps {
  apiBaseUrl?: string;
  authToken?: string;
  onNavigateLive?: () => void;
  onNavigatePlayback?: () => void;
}

export const EMapPage: React.FC<EMapPageProps> = ({
  apiBaseUrl = '',
  authToken = '',
  onNavigateLive,
  onNavigatePlayback,
}) => {
  const { token: authContextToken, user } = useAuth();
  const effectiveToken = authToken || authContextToken || '';

  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [selectedCameraForPip, setSelectedCameraForPip] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [markers, setMarkers] = useState<CameraMarker[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [draggingMarkerIndex, setDraggingMarkerIndex] = useState<number | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);

  const authHeaders = {
    Authorization: effectiveToken ? `Bearer ${effectiveToken}` : '',
  };

  // Fetch all floor plans
  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/emap/plans`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans || []);
        if (data.plans?.length > 0 && !selectedPlanId) {
          setSelectedPlanId(data.plans[0].id);
          setMarkers(data.plans[0].markers || []);
        }
      }
    } catch (err) {
      console.error('Failed to load floor plans:', err);
    }
  }, [apiBaseUrl, effectiveToken, selectedPlanId]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // Update active markers when selected plan changes
  useEffect(() => {
    const current = plans.find((p) => p.id === selectedPlanId);
    if (current) {
      setMarkers(current.markers || []);
    }
  }, [selectedPlanId, plans]);

  // Handle marker drag
  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    if (!isEditMode) return;
    e.stopPropagation();
    setDraggingMarkerIndex(index);
  };

  const handleContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isEditMode || draggingMarkerIndex === null || !mapContainerRef.current) return;
    const rect = mapContainerRef.current.getBoundingClientRect();
    const x = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100));

    setMarkers((prev) => {
      const copy = [...prev];
      copy[draggingMarkerIndex] = {
        ...copy[draggingMarkerIndex],
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
      };
      return copy;
    });
  };

  const handlePointerUp = () => {
    setDraggingMarkerIndex(null);
  };

  // Rotate camera FOV by 45 degrees
  const handleRotate = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setMarkers((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        angle: (copy[index].angle + 45) % 360,
      };
      return copy;
    });
  };

  // Save updated marker positions
  const handleSaveMarkers = async () => {
    if (!selectedPlanId) return;
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const res = await fetch(`${apiBaseUrl}/api/emap/plans/${selectedPlanId}/markers`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ markers }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error('Failed to save markers:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const activePlan = plans.find((p) => p.id === selectedPlanId);

  return (
    <div
      className="flex flex-col w-screen h-screen bg-[#090d16] text-slate-100 overflow-hidden font-sans select-none"
      onPointerUp={handlePointerUp}
    >
      <OperatorBanner />

      {/* Top Application Header */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-[#111827] border-b border-[#1f2937] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-bold tracking-tight text-sm text-slate-100">
            <div className="w-8 h-8 rounded-lg bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#4fc3f7]" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs tracking-wider text-[#4fc3f7] font-mono">BASIC VMS</span>
              <span className="text-[10px] text-slate-400 font-normal">Interactive Site E-Map</span>
            </div>
          </div>
          <span className="text-[#1f2937]">|</span>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-300 font-medium">
            <Compass className="w-4 h-4 text-[#4fc3f7]" />
            <span>Floorplan & Perimeter Radar</span>
          </div>
        </div>

        {/* Center: Floorplan Selector & Controls */}
        <div className="flex items-center gap-3">
          {/* Plan Dropdown */}
          <div className="flex items-center gap-2 bg-[#090d16] px-3 py-1.5 rounded-md border border-[#1f2937] text-xs">
            <Layers className="w-4 h-4 text-[#4fc3f7]" />
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="bg-transparent text-slate-100 font-semibold focus:outline-none cursor-pointer text-xs"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#111827] text-slate-100">
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Edit / Monitor Mode Toggle */}
          <div className="flex items-center p-0.5 bg-[#090d16] rounded-lg border border-[#1f2937] text-xs">
            <button
              type="button"
              onClick={() => setIsEditMode(false)}
              className={`flex items-center gap-1 px-3 py-1 rounded-md font-semibold transition-colors ${
                !isEditMode
                  ? 'bg-[#4fc3f7] text-[#090d16] font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Monitor</span>
            </button>
            <button
              type="button"
              onClick={() => setIsEditMode(true)}
              className={`flex items-center gap-1 px-3 py-1 rounded-md font-semibold transition-colors ${
                isEditMode
                  ? 'bg-[#fb923c] text-[#090d16] font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span>Layout Editor</span>
            </button>
          </div>

          {/* Save Layout Button (when in edit mode) */}
          {isEditMode && (
            <button
              type="button"
              onClick={handleSaveMarkers}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#34d399] hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-md transition-colors"
            >
              {saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Saved!
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" /> Save Positions
                </>
              )}
            </button>
          )}
        </div>

        {/* Right Navigation */}
        <div className="flex items-center gap-2">
          {onNavigatePlayback && (
            <button
              type="button"
              onClick={onNavigatePlayback}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111827] hover:bg-[#1f2937] text-slate-200 border border-[#1f2937] font-semibold text-xs rounded-md transition-colors"
            >
              <Film className="w-3.5 h-3.5 text-[#4fc3f7]" />
              <span>Playback</span>
            </button>
          )}

          {onNavigateLive && (
            <button
              type="button"
              onClick={onNavigateLive}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] font-bold text-xs rounded-md transition-all shadow-md active:scale-95"
            >
              <Radio className="w-4 h-4" />
              <span>Live Grid</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Floorplan Canvas Area */}
      <main className="flex-1 w-full relative flex items-center justify-center bg-[#060910] p-4 overflow-hidden">
        {/* Floorplan Blueprint Container */}
        <div
          ref={mapContainerRef}
          onPointerMove={handleContainerPointerMove}
          className="relative w-full max-w-5xl h-full max-h-[82vh] bg-[#0c1322] border-2 border-[#1f2937] rounded-xl overflow-hidden shadow-2xl flex items-center justify-center"
          style={{
            backgroundImage: `
              radial-gradient(circle at 50% 50%, rgba(79, 195, 247, 0.05) 0%, transparent 80%),
              linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
            `,
            backgroundSize: '100% 100%, 40px 40px, 40px 40px',
          }}
        >
          {/* Architectural Blueprint Vector Outline */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
            {/* Outer boundary */}
            <rect x="5%" y="5%" width="90%" height="90%" fill="none" stroke="#4fc3f7" strokeWidth="2" strokeDasharray="6 4" />
            {/* Gate entrance */}
            <rect x="10%" y="70%" width="20%" height="20%" fill="rgba(79, 195, 247, 0.05)" stroke="#4fc3f7" strokeWidth="1.5" />
            <text x="12%" y="82%" fill="#4fc3f7" fontSize="12" fontFamily="monospace">GATE & BARRIER</text>
            {/* Warehouse Bay */}
            <rect x="35%" y="30%" width="30%" height="60%" fill="rgba(52, 211, 153, 0.05)" stroke="#34d399" strokeWidth="1.5" />
            <text x="37%" y="60%" fill="#34d399" fontSize="12" fontFamily="monospace">DISPATCH / LOADING DOCKS</text>
            {/* Production / Vault Area */}
            <rect x="70%" y="20%" width="22%" height="50%" fill="rgba(251, 146, 60, 0.05)" stroke="#fb923c" strokeWidth="1.5" />
            <text x="72%" y="45%" fill="#fb923c" fontSize="12" fontFamily="monospace">HIGH-SECURITY VAULT</text>
          </svg>

          {/* Camera Map Markers */}
          {markers.map((marker, index) => {
            const fov = marker.fovDegrees || 85;
            const halfFov = fov / 2;

            return (
              <div
                key={marker.cameraId || index}
                onPointerDown={(e) => handlePointerDown(index, e)}
                onClick={() => {
                  if (!isEditMode) {
                    setSelectedCameraForPip({
                      id: marker.cameraId,
                      name: marker.cameraName || 'CCTV Camera',
                    });
                  }
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 z-30 transition-transform ${
                  isEditMode ? 'cursor-grab active:cursor-grabbing hover:scale-110' : 'cursor-pointer hover:scale-125'
                }`}
                style={{
                  left: `${marker.x}%`,
                  top: `${marker.y}%`,
                }}
              >
                {/* Visual Field of View (FOV) Radar Cone */}
                <svg
                  className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2 overflow-visible"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${marker.angle}deg)`,
                  }}
                  width="180"
                  height="180"
                >
                  <defs>
                    <radialGradient id={`fov-grad-${index}`} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#4fc3f7" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#4fc3f7" stopOpacity="0.0" />
                    </radialGradient>
                  </defs>
                  {/* FOV wedge cone */}
                  <path
                    d={`M 90 90 L ${90 + 75 * Math.sin((-(halfFov) * Math.PI) / 180)} ${
                      90 - 75 * Math.cos((-(halfFov) * Math.PI) / 180)
                    } A 75 75 0 0 1 ${90 + 75 * Math.sin(((halfFov) * Math.PI) / 180)} ${
                      90 - 75 * Math.cos(((halfFov) * Math.PI) / 180)
                    } Z`}
                    fill={`url(#fov-grad-${index})`}
                    stroke="#4fc3f7"
                    strokeWidth="1"
                    strokeOpacity="0.6"
                  />
                </svg>

                {/* Camera Pin Body */}
                <div className="relative flex flex-col items-center group">
                  <div className="w-8 h-8 rounded-full bg-[#111827] border-2 border-[#4fc3f7] flex items-center justify-center shadow-[0_0_12px_rgba(79,195,247,0.5)]">
                    <Video className="w-4 h-4 text-[#4fc3f7]" />
                    {/* Live Online Pulse Dot */}
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-black animate-pulse" />
                  </div>

                  {/* Camera Name Tag */}
                  <div className="mt-1 px-2 py-0.5 rounded bg-[#090d16]/90 border border-[#1f2937] text-[10px] font-semibold text-slate-200 whitespace-nowrap shadow">
                    {marker.cameraName || `Camera ${index + 1}`}
                  </div>

                  {/* Edit Mode Rotation Trigger */}
                  {isEditMode && (
                    <button
                      type="button"
                      onClick={(e) => handleRotate(index, e)}
                      title="Rotate Field of View Angle (+45°)"
                      className="absolute -bottom-6 p-1 rounded-full bg-[#fb923c] text-slate-950 hover:scale-110 transition-transform shadow"
                    >
                      <RotateCw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Picture-in-Picture (PIP) Live Feed Modal Popover */}
        {selectedCameraForPip && (
          <div className="fixed bottom-6 right-6 z-50 w-96 bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between px-3.5 py-2 bg-[#090d16] border-b border-[#1f2937]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-slate-100 truncate">
                  {selectedCameraForPip.name}
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-1 rounded">
                  LIVE
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCameraForPip(null)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1f2937]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live Video Feeder Mock/Embed */}
            <div className="w-full aspect-video bg-black flex items-center justify-center relative">
              <div className="flex flex-col items-center justify-center text-center p-4">
                <Video className="w-8 h-8 text-[#4fc3f7] animate-pulse mb-2" />
                <span className="text-xs font-semibold text-slate-200">
                  {selectedCameraForPip.name}
                </span>
                <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                  WebRTC / RTSP Ingest Active (1080p @ 25fps)
                </span>
              </div>
            </div>

            <div className="p-2 bg-[#090d16] flex items-center justify-between text-[11px] text-slate-400">
              <span>Status: <strong className="text-emerald-400">Normal / Online</strong></span>
              <button
                type="button"
                onClick={() => {
                  setSelectedCameraForPip(null);
                  if (onNavigateLive) onNavigateLive();
                }}
                className="text-[#4fc3f7] hover:underline font-semibold"
              >
                Open in Full Live Grid →
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default EMapPage;
