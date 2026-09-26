import React, { useState, useEffect } from 'react';
import { CameraStreamInfo } from './LiveCameraTile.js';
import { GuardTourConfig } from './FocusTourLayout.js';
import {
  X,
  Play,
  Plus,
  Trash2,
  Move,
  Layers,
  Clock,
  Shield,
  CheckCircle,
  AlertTriangle,
  GripVertical,
  ArrowDownUp,
} from 'lucide-react';

export interface TourStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: CameraStreamInfo[];
  activeTour: GuardTourConfig | null;
  onSaveTour: (tour: GuardTourConfig) => Promise<void>;
  onApplyTour: (tour: GuardTourConfig) => void;
  authToken?: string;
}

export interface CameraZone {
  id: string;
  name: string;
  cameraIds: string[];
}

export const TourStudioModal: React.FC<TourStudioModalProps> = ({
  isOpen,
  onClose,
  cameras,
  activeTour,
  onSaveTour,
  onApplyTour,
  authToken,
}) => {
  const [tourName, setTourName] = useState('Gate 1 Perimeter Tour');
  const [layoutMode, setLayoutMode] = useState<'1+4' | '2+6' | '4+8' | 'quad-zone'>('1+4');
  const [dwellSeconds, setDwellSeconds] = useState<number>(10);
  const [heroCameraIds, setHeroCameraIds] = useState<string[]>([]);
  const [carouselPoolIds, setCarouselPoolIds] = useState<string[]>([]);
  const [alarmOverride, setAlarmOverride] = useState<boolean>(true);
  const [zones, setZones] = useState<CameraZone[]>([]);
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('ALL');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Initialize with activeTour or defaults
  useEffect(() => {
    if (activeTour) {
      setTourName(activeTour.name);
      setLayoutMode(activeTour.layoutMode as any);
      setDwellSeconds(activeTour.dwellSeconds);
      setAlarmOverride(activeTour.alarmOverride);

      const validHero = activeTour.heroCameraIds.filter((id) => cameras.some((c) => c.id === id));
      const validPool = activeTour.carouselPoolIds.filter((id) => cameras.some((c) => c.id === id));

      if (validHero.length === 0 && cameras.length > 0) {
        const heroCount = activeTour.layoutMode === '1+4' ? 1 : activeTour.layoutMode === '2+6' ? 2 : 4;
        setHeroCameraIds(cameras.slice(0, heroCount).map((c) => c.id));
        setCarouselPoolIds(cameras.slice(heroCount).map((c) => c.id));
      } else {
        setHeroCameraIds(validHero);
        setCarouselPoolIds(validPool.length > 0 ? validPool : cameras.filter((c) => !validHero.includes(c.id)).map((c) => c.id));
      }
    } else if (cameras.length > 0) {
      setHeroCameraIds([cameras[0].id]);
      setCarouselPoolIds(cameras.slice(1).map((c) => c.id));
    }
  }, [activeTour, cameras]);

  const handleAutoAssign = () => {
    if (cameras.length === 0) return;
    const heroCount = layoutMode === '1+4' ? 1 : layoutMode === '2+6' ? 2 : 4;
    setHeroCameraIds(cameras.slice(0, heroCount).map((c) => c.id));
    setCarouselPoolIds(cameras.slice(heroCount).map((c) => c.id));
  };

  // HTML5 Drag & Drop states and handlers
  const [draggedCamId, setDraggedCamId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<'catalog' | 'hero' | 'pool' | null>(null);
  const [isHeroDropOver, setIsHeroDropOver] = useState<boolean>(false);
  const [isPoolDropOver, setIsPoolDropOver] = useState<boolean>(false);

  const handleDragStart = (e: React.DragEvent, camId: string, source: 'catalog' | 'hero' | 'pool') => {
    e.dataTransfer.setData('text/plain', camId);
    e.dataTransfer.effectAllowed = 'copyMove';
    setDraggedCamId(camId);
    setDragSource(source);
  };

  const handleDragEnd = () => {
    setDraggedCamId(null);
    setDragSource(null);
    setIsHeroDropOver(false);
    setIsPoolDropOver(false);
  };

  const handleDragOverHero = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isHeroDropOver) setIsHeroDropOver(true);
  };

  const handleDragOverPool = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isPoolDropOver) setIsPoolDropOver(true);
  };

  const handleDropOnHero = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHeroDropOver(false);
    const camId = e.dataTransfer.getData('text/plain') || draggedCamId;
    if (!camId) return;

    if (!heroCameraIds.includes(camId)) {
      if (heroCameraIds.length >= heroMaxCount) {
        setHeroCameraIds([...heroCameraIds.slice(1), camId]);
      } else {
        setHeroCameraIds([...heroCameraIds, camId]);
      }
      setCarouselPoolIds((prev) => prev.filter((id) => id !== camId));
    }
    setDraggedCamId(null);
    setDragSource(null);
  };

  const handleDropOnPool = (e: React.DragEvent) => {
    e.preventDefault();
    setIsPoolDropOver(false);
    const camId = e.dataTransfer.getData('text/plain') || draggedCamId;
    if (!camId) return;

    if (!carouselPoolIds.includes(camId)) {
      setCarouselPoolIds([...carouselPoolIds, camId]);
      setHeroCameraIds((prev) => prev.filter((id) => id !== camId));
    }
    setDraggedCamId(null);
    setDragSource(null);
  };

  // Fetch Camera Zones
  useEffect(() => {
    fetch('/api/camera-zones')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.zones) {
          setZones(data.zones);
        }
      })
      .catch(() => {});
  }, []);

  if (!isOpen) return null;

  // Filter available cameras
  const filteredCameras = cameras.filter((cam) => {
    if (selectedZoneFilter === 'ALL') return true;
    const zone = zones.find((z) => z.id === selectedZoneFilter);
    return zone ? zone.cameraIds.includes(cam.id) : true;
  });

  const heroMaxCount = layoutMode === '1+4' ? 1 : layoutMode === '2+6' ? 2 : 4;

  const handleAddHero = (camId: string) => {
    if (heroCameraIds.includes(camId)) return;
    if (heroCameraIds.length >= heroMaxCount) {
      setHeroCameraIds([...heroCameraIds.slice(1), camId]);
    } else {
      setHeroCameraIds([...heroCameraIds, camId]);
    }
  };

  const handleRemoveHero = (camId: string) => {
    setHeroCameraIds(heroCameraIds.filter((id) => id !== camId));
  };

  const handleToggleCarousel = (camId: string) => {
    if (carouselPoolIds.includes(camId)) {
      setCarouselPoolIds(carouselPoolIds.filter((id) => id !== camId));
    } else {
      setCarouselPoolIds([...carouselPoolIds, camId]);
    }
  };

  const handleSave = async (applyNow: boolean = false) => {
    setIsSaving(true);
    setSavedSuccess(false);

    const tourPayload: GuardTourConfig = {
      id: activeTour?.id || `tour-${Date.now()}`,
      name: tourName,
      layoutMode,
      dwellSeconds,
      heroCameraIds,
      carouselPoolIds,
      alarmOverride,
      zoneId: selectedZoneFilter !== 'ALL' ? selectedZoneFilter : undefined,
    };

    try {
      await onSaveTour(tourPayload);
      setSavedSuccess(true);
      if (applyNow) {
        onApplyTour(tourPayload);
        onClose();
      } else {
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2937] bg-[#090d16]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#4fc3f7]/20 border border-[#4fc3f7]/50 flex items-center justify-center text-[#4fc3f7]">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 font-mono">TOUR & LAYOUT STUDIO</h2>
              <p className="text-xs text-slate-400">Configure Multi-Hero focus layouts and auto-cycling guard carousels</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Controls Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Tour Name</label>
              <input
                type="text"
                value={tourName}
                onChange={(e) => setTourName(e.target.value)}
                placeholder="Gate 1 Perimeter Tour"
                className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-xs text-slate-100 outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Layout Mode</label>
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value as any)}
                className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-xs text-slate-100 outline-none font-mono"
              >
                <option value="1+4">1 Large Hero + 4 Side Carousels</option>
                <option value="2+6">2 Large Heroes + 6 Side Carousels</option>
                <option value="4+8">4 Large Heroes + 8 Side Carousels</option>
                <option value="quad-zone">Quad-Zone Multi-Carousel (1 TV)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Dwell Time (Rotation Speed)</label>
              <select
                value={dwellSeconds}
                onChange={(e) => setDwellSeconds(Number(e.target.value))}
                className="w-full bg-[#090d16] border border-[#1f2937] focus:border-[#4fc3f7] rounded-lg px-3 py-2 text-xs text-slate-100 outline-none font-mono"
              >
                <option value={5}>5 Seconds (Fast Scan)</option>
                <option value={10}>10 Seconds (Recommended)</option>
                <option value={15}>15 Seconds</option>
                <option value={30}>30 Seconds</option>
                <option value={60}>60 Seconds</option>
              </select>
            </div>
          </div>

          {/* Alarm Override Option */}
          <div className="flex items-center gap-3 p-3 bg-[#090d16] border border-[#1f2937] rounded-lg">
            <input
              type="checkbox"
              id="alarmOverrideCheck"
              checked={alarmOverride}
              onChange={(e) => setAlarmOverride(e.target.checked)}
              className="w-4 h-4 accent-[#4fc3f7] rounded cursor-pointer"
            />
            <label htmlFor="alarmOverrideCheck" className="text-xs text-slate-200 cursor-pointer flex items-center gap-2">
              <span className="font-semibold text-slate-100">Alarm Priority Pop-Up:</span>
              <span className="text-slate-400">
                Automatically swap Hero 1 to any camera detecting motion/tripwire alerts for 15 seconds.
              </span>
            </label>
          </div>

          {/* Zone Filter */}
          <div className="flex items-center gap-2 border-b border-[#1f2937] pb-3">
            <span className="text-xs font-semibold text-slate-400">Camera Zone Filter:</span>
            <button
              onClick={() => setSelectedZoneFilter('ALL')}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                selectedZoneFilter === 'ALL'
                  ? 'bg-[#4fc3f7] text-[#090d16] font-bold'
                  : 'bg-[#090d16] text-slate-400 hover:text-white border border-[#1f2937]'
              }`}
            >
              All Cameras ({cameras.length})
            </button>
            {zones.map((zone) => (
              <button
                key={zone.id}
                onClick={() => setSelectedZoneFilter(zone.id)}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                  selectedZoneFilter === zone.id
                    ? 'bg-[#4fc3f7] text-[#090d16] font-bold'
                    : 'bg-[#090d16] text-slate-400 hover:text-white border border-[#1f2937]'
                }`}
              >
                {zone.name} ({zone.cameraIds.length})
              </button>
            ))}
          </div>

          {/* Quick Auto-Assign Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#090d16] border border-[#1f2937] p-2.5 rounded-lg">
            <span className="text-xs text-slate-300">
              💡 <span className="font-semibold text-slate-100">Hero cameras</span> stay enlarged. <span className="font-semibold text-[#fb923c]">Carousel pool</span> rotates every {dwellSeconds}s.
            </span>
            <button
              type="button"
              onClick={handleAutoAssign}
              className="flex items-center gap-1.5 px-3 py-1 bg-[#4fc3f7]/15 hover:bg-[#4fc3f7]/25 text-[#4fc3f7] border border-[#4fc3f7]/40 rounded text-xs font-semibold transition-colors"
            >
              <span>⚡ Auto-Assign All {cameras.length} Cameras</span>
            </button>
          </div>

          {/* Dual Selection Area: Hero Slots vs Carousel Pool (Interactive Drag-and-Drop Dropzones) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* HERO SLOTS DROPZONE */}
            <div
              onDragOver={handleDragOverHero}
              onDragLeave={() => setIsHeroDropOver(false)}
              onDrop={handleDropOnHero}
              className={`transition-all rounded-xl p-4 border-2 ${
                isHeroDropOver
                  ? 'border-[#4fc3f7] bg-[#4fc3f7]/15 ring-2 ring-[#4fc3f7]/50 scale-[1.01]'
                  : 'border-[#4fc3f7]/40 bg-[#090d16]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#4fc3f7]" />
                  <span className="text-xs font-bold text-slate-100 font-mono">
                    HERO SLOTS (MAX {heroMaxCount})
                  </span>
                </div>
                <span className="text-[10px] text-[#4fc3f7] font-mono">
                  {heroCameraIds.length} / {heroMaxCount} Pinned
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                Drag cameras here to pin as primary 1080p Main Stream feeds.
              </p>

              {isHeroDropOver && (
                <div className="mb-2 p-2.5 border-2 border-dashed border-[#4fc3f7] bg-[#4fc3f7]/20 rounded-lg text-center text-xs font-mono font-bold text-[#4fc3f7] animate-pulse">
                  📥 RELEASE TO PIN AS HERO CAMERA
                </div>
              )}

              <div className="space-y-2 min-h-[140px]">
                {heroCameraIds.map((camId, index) => {
                  const cam = cameras.find((c) => c.id === camId);
                  return (
                    <div
                      key={`hero-slot-${camId}`}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, camId, 'hero')}
                      onDragEnd={handleDragEnd}
                      className="flex items-center justify-between p-2.5 bg-[#111827] border border-[#4fc3f7]/50 rounded-lg text-xs cursor-grab active:cursor-grabbing hover:border-[#4fc3f7] transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="w-3.5 h-3.5 text-slate-500" />
                        <span className="w-5 h-5 rounded bg-[#4fc3f7]/20 text-[#4fc3f7] font-mono font-bold flex items-center justify-center text-[10px]">
                          {index + 1}
                        </span>
                        <span className="font-bold text-slate-100">{cam?.name || camId}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveHero(camId)}
                        className="text-slate-400 hover:text-red-400 p-1"
                        title="Remove from Hero"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {heroCameraIds.length === 0 && !isHeroDropOver && (
                  <div className="h-28 flex flex-col items-center justify-center border-2 border-dashed border-[#1f2937] rounded-lg text-xs text-slate-400 font-mono gap-1.5 p-4 text-center">
                    <Move className="w-5 h-5 text-[#4fc3f7]" />
                    <span>DRAG & DROP CAMERAS HERE</span>
                    <span className="text-[10px] text-slate-500">or click "+ Hero" below</span>
                  </div>
                )}
              </div>
            </div>

            {/* ROTATING CAROUSEL POOL DROPZONE */}
            <div
              onDragOver={handleDragOverPool}
              onDragLeave={() => setIsPoolDropOver(false)}
              onDrop={handleDropOnPool}
              className={`transition-all rounded-xl p-4 border-2 ${
                isPoolDropOver
                  ? 'border-[#fb923c] bg-[#fb923c]/15 ring-2 ring-[#fb923c]/50 scale-[1.01]'
                  : 'border-[#1f2937] bg-[#090d16]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#fb923c]" />
                  <span className="text-xs font-bold text-slate-100 font-mono">ROTATING CAROUSEL POOL</span>
                </div>
                <span className="text-[10px] text-[#fb923c] font-mono">
                  {carouselPoolIds.length} Cameras Cycling
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                Drag cameras here to cycle through sidecar slots every {dwellSeconds}s.
              </p>

              {isPoolDropOver && (
                <div className="mb-2 p-2.5 border-2 border-dashed border-[#fb923c] bg-[#fb923c]/20 rounded-lg text-center text-xs font-mono font-bold text-[#fb923c] animate-pulse">
                  📥 RELEASE TO ADD TO CAROUSEL POOL
                </div>
              )}

              <div className="space-y-1.5 max-h-[160px] overflow-y-auto min-h-[140px]">
                {carouselPoolIds.map((camId) => {
                  const cam = cameras.find((c) => c.id === camId);
                  return (
                    <div
                      key={`pool-${camId}`}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, camId, 'pool')}
                      onDragEnd={handleDragEnd}
                      className="flex items-center justify-between px-2.5 py-1.5 bg-[#111827] border border-[#1f2937] rounded text-xs cursor-grab active:cursor-grabbing hover:border-[#fb923c] transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-slate-200">{cam?.name || camId}</span>
                      </div>
                      <button
                        onClick={() => handleToggleCarousel(camId)}
                        className="text-slate-500 hover:text-red-400 p-0.5"
                        title="Remove from Carousel"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
                {carouselPoolIds.length === 0 && !isPoolDropOver && (
                  <div className="h-28 flex flex-col items-center justify-center border-2 border-dashed border-[#1f2937] rounded-lg text-xs text-slate-400 font-mono gap-1.5 p-4 text-center">
                    <Move className="w-5 h-5 text-[#fb923c]" />
                    <span>DRAG & DROP CAMERAS HERE</span>
                    <span className="text-[10px] text-slate-500">or click "+ Pool" below</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Camera Selection Catalog */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-200 font-mono flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-[#4fc3f7]" />
                <span>AVAILABLE CAMERAS (DRAG CARDS DIRECTLY INTO HERO OR POOL ABOVE)</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">
                Click or drag cards
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[180px] overflow-y-auto">
              {filteredCameras.map((cam) => {
                const isHero = heroCameraIds.includes(cam.id);
                const isCarousel = carouselPoolIds.includes(cam.id);

                return (
                  <div
                    key={cam.id}
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, cam.id, 'catalog')}
                    onDragEnd={handleDragEnd}
                    className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between transition-all cursor-grab active:cursor-grabbing hover:scale-[1.02] shadow-sm select-none ${
                      isHero
                        ? 'bg-[#4fc3f7]/15 border-[#4fc3f7]/70 shadow-[#4fc3f7]/10'
                        : isCarousel
                        ? 'bg-[#fb923c]/15 border-[#fb923c]/70 shadow-[#fb923c]/10'
                        : 'bg-[#090d16] border-[#1f2937] hover:border-slate-500 hover:bg-[#111827]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <div className="font-bold text-slate-200 truncate flex-1">{cam.name}</div>
                      <GripVertical className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleAddHero(cam.id)}
                        className={`flex-1 py-1 rounded text-[10px] font-bold ${
                          isHero
                            ? 'bg-[#4fc3f7] text-[#090d16]'
                            : 'bg-[#111827] text-slate-300 hover:text-white border border-[#1f2937]'
                        }`}
                      >
                        {isHero ? 'Hero ✓' : '+ Hero'}
                      </button>
                      <button
                        onClick={() => handleToggleCarousel(cam.id)}
                        className={`flex-1 py-1 rounded text-[10px] font-bold ${
                          isCarousel
                            ? 'bg-[#fb923c] text-[#090d16]'
                            : 'bg-[#111827] text-slate-300 hover:text-white border border-[#1f2937]'
                        }`}
                      >
                        {isCarousel ? 'Pool ✓' : '+ Pool'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#1f2937] bg-[#090d16]">
          <div className="text-xs text-slate-400 font-mono">
            {savedSuccess && (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                Tour saved successfully!
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSave(false)}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-[#111827] hover:bg-[#1f2937] border border-[#1f2937] text-xs font-semibold text-slate-200 transition-colors"
            >
              Save Preset
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#4fc3f7] hover:bg-[#38bdf8] text-[#090d16] text-xs font-bold shadow transition-all active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Apply & Launch Tour</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TourStudioModal;
