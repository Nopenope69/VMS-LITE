import React, { useState, useEffect, useRef } from 'react';
import { CameraStreamInfo, LiveCameraTile } from './LiveCameraTile.js';
import {
  Play,
  Pause,
  RotateCw,
  AlertTriangle,
  Shield,
  Maximize2,
  SlidersHorizontal,
  ChevronDown,
  GripVertical,
  ArrowUpRight,
  Search,
  ChevronLeft,
  ChevronRight,
  Video,
} from 'lucide-react';

export interface GuardTourConfig {
  id: string;
  name: string;
  layoutMode: '1+4' | '2+6' | '4+8' | 'quad-zone' | 'matrix';
  dwellSeconds: number;
  heroCameraIds: string[];
  carouselPoolIds: string[];
  alarmOverride: boolean;
  zoneId?: string;
}

export interface VmsZoneSummary {
  id: string;
  name: string;
  color: string;
  icon?: string;
  cameraIds: string[];
}

export interface FocusTourLayoutProps {
  cameras: CameraStreamInfo[];
  tour: GuardTourConfig;
  availableTours?: GuardTourConfig[];
  onSelectTour?: (tour: GuardTourConfig) => void;
  onOpenTourStudio?: () => void;
  iceServers?: RTCIceServer[];
  apiBaseUrl?: string;
  authToken?: string;
  alarmCameraId?: string | null;
  onTileDoubleClick?: (cameraId: string) => void;
  onInstantPlayback?: (cameraId: string) => void;
  onToggleEmergencyRecord?: (cameraId: string) => void;
  activeEmergencyRecordings?: Set<string>;
  activeMotionCameraIds?: Set<string>;
  canControlPtz?: (cameraId: string) => boolean;
  targetFps?: number;
  isThrottled?: boolean;
}

export const getCamId = (c: any): string => (c?.cameraId || c?.id || '') as string;

export const FocusTourLayout: React.FC<FocusTourLayoutProps> = ({
  cameras,
  tour,
  availableTours = [],
  onSelectTour,
  onOpenTourStudio,
  iceServers = [],
  apiBaseUrl = '',
  authToken = '',
  alarmCameraId,
  onTileDoubleClick,
  onInstantPlayback,
  onToggleEmergencyRecord,
  activeEmergencyRecordings,
  activeMotionCameraIds,
  canControlPtz,
  targetFps,
  isThrottled,
}) => {
  const [carouselOffset, setCarouselOffset] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [activeAlarmHero, setActiveAlarmHero] = useState<string | null>(null);

  // Dynamic Zones from backend
  const [customZones, setCustomZones] = useState<VmsZoneSummary[]>([]);

  useEffect(() => {
    fetch('/api/v1/locations')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.zones && Array.isArray(data.zones)) {
          setCustomZones(data.zones);
        }
      })
      .catch(() => {});
  }, []);

  // Live Drag-and-Drop and On-the-fly Customization State
  const [liveHeroOverrides, setLiveHeroOverrides] = useState<Map<number, string>>(new Map());
  const [hoverHeroIdx, setHoverHeroIdx] = useState<number | null>(null);
  const [isDockOpen, setIsDockOpen] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [carouselSourceFilter, setCarouselSourceFilter] = useState<string>('tour_pool');

  // Map camera ID to CameraStreamInfo
  const cameraMap = new Map<string, CameraStreamInfo>();
  for (const c of cameras) {
    const id = getCamId(c);
    if (id) cameraMap.set(id, c);
  }

  // Handle Alarm Priority Override
  useEffect(() => {
    if (tour.alarmOverride && alarmCameraId) {
      setActiveAlarmHero(alarmCameraId);
      const timer = setTimeout(() => {
        setActiveAlarmHero(null);
      }, 15000); // 15 seconds priority view
      return () => clearTimeout(timer);
    }
  }, [alarmCameraId, tour.alarmOverride]);

  // Determine carousel slots count based on layout
  const carouselSlotCount = tour.layoutMode === '1+4' ? 4 : tour.layoutMode === '2+6' ? 6 : 8;
  const heroSlotsCount = tour.layoutMode === '1+4' ? 1 : tour.layoutMode === '2+6' ? 2 : 4;

  // Smart Resolution: Resolve Hero Cameras with robust fallback to available cameras
  const matchingHeroCameras = tour.heroCameraIds
    .map((id) => cameraMap.get(id))
    .filter(Boolean) as CameraStreamInfo[];

  const effectiveHeroCameras: CameraStreamInfo[] =
    matchingHeroCameras.length > 0
      ? matchingHeroCameras
      : cameras.slice(0, heroSlotsCount);

  const resolvedHeroCameras: (CameraStreamInfo | null)[] = [];
  for (let i = 0; i < heroSlotsCount; i++) {
    const liveOverrideId = liveHeroOverrides.get(i);
    if (i === 0 && activeAlarmHero && cameraMap.has(activeAlarmHero)) {
      resolvedHeroCameras.push(cameraMap.get(activeAlarmHero)!);
    } else if (liveOverrideId && cameraMap.has(liveOverrideId)) {
      resolvedHeroCameras.push(cameraMap.get(liveOverrideId)!);
    } else if (i < effectiveHeroCameras.length) {
      resolvedHeroCameras.push(effectiveHeroCameras[i]);
    } else {
      resolvedHeroCameras.push(null);
    }
  }

  // Filter cameras dynamically based on carouselSourceFilter
  const getFilteredPoolCameraIds = (): string[] => {
    if (carouselSourceFilter === 'all') {
      return cameras.map((c) => getCamId(c));
    }
    if (carouselSourceFilter.startsWith('zone_')) {
      const zoneId = carouselSourceFilter.replace('zone_', '');
      const matchedZone = customZones.find((z) => z.id === zoneId);
      if (matchedZone) {
        if (matchedZone.cameraIds && matchedZone.cameraIds.length > 0) {
          const zoneCams = cameras.filter((c) => matchedZone.cameraIds.includes(getCamId(c)));
          if (zoneCams.length > 0) return zoneCams.map((c) => getCamId(c));
        }
        const kw = matchedZone.name.toLowerCase();
        const filtered = cameras.filter((c) => {
          const name = (c.name || '').toLowerCase();
          return kw.split(/\s+/).some((w) => w.length > 3 && name.includes(w));
        });
        if (filtered.length > 0) return filtered.map((c) => getCamId(c));
      }
      return cameras.map((c) => getCamId(c));
    }
    if (carouselSourceFilter === 'dispatch') {
      const filtered = cameras.filter((c) =>
        /gate|entry|dispatch|bay|truck|exit/i.test(c.name)
      );
      return filtered.length > 0 ? filtered.map((c) => getCamId(c)) : cameras.map((c) => getCamId(c));
    }
    if (carouselSourceFilter === 'production') {
      const filtered = cameras.filter((c) =>
        /prod|ware|bay|line|machine|plant|floor/i.test(c.name)
      );
      return filtered.length > 0 ? filtered.map((c) => getCamId(c)) : cameras.map((c) => getCamId(c));
    }
    if (carouselSourceFilter === 'perimeter') {
      const filtered = cameras.filter((c) =>
        /perim|north|south|east|west|fence|wall|boundary/i.test(c.name)
      );
      return filtered.length > 0 ? filtered.map((c) => getCamId(c)) : cameras.map((c) => getCamId(c));
    }
    if (carouselSourceFilter === 'admin') {
      const filtered = cameras.filter((c) =>
        /admin|reception|lobby|office|desk/i.test(c.name)
      );
      return filtered.length > 0 ? filtered.map((c) => getCamId(c)) : cameras.map((c) => getCamId(c));
    }

    // Default: 'tour_pool'
    const matchingPool = tour.carouselPoolIds.filter((id) => cameraMap.has(id));
    return matchingPool.length > 0
      ? matchingPool
      : cameras
          .filter((c) => !effectiveHeroCameras.some((h) => getCamId(h) === getCamId(c)))
          .map((c) => getCamId(c));
  };

  const finalPool = getFilteredPoolCameraIds();

  // Auto-cycling timer
  useEffect(() => {
    if (isPaused || activeAlarmHero || finalPool.length <= carouselSlotCount) {
      return;
    }

    const intervalMs = Math.max(3000, tour.dwellSeconds * 1000);
    const timer = setInterval(() => {
      setCarouselOffset((prev) => (prev + 1) % finalPool.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPaused, activeAlarmHero, tour.dwellSeconds, finalPool.length, carouselSlotCount]);

  // Resolve Carousel Rotating Cameras
  const resolvedCarouselCameras: (CameraStreamInfo | null)[] = [];
  if (finalPool.length > 0) {
    for (let i = 0; i < carouselSlotCount; i++) {
      const poolIndex = (carouselOffset + i) % finalPool.length;
      const camId = finalPool[poolIndex];
      resolvedCarouselCameras.push(cameraMap.get(camId) || null);
    }
  }

  const handlePromoteToHero = (camId: string, heroSlotIdx: number = 0) => {
    setLiveHeroOverrides((prev) => {
      const next = new Map(prev);
      next.set(heroSlotIdx, camId);
      return next;
    });
  };

  // Pre-built Shift Activators
  const activateShiftPreset = (presetOrZoneId: string) => {
    const dynamicZone = customZones.find((z) => z.id === presetOrZoneId);
    if (dynamicZone) {
      setCarouselSourceFilter(`zone_${dynamicZone.id}`);
      let match = cameras.find((c) => dynamicZone.cameraIds.includes(getCamId(c)));
      if (!match) {
        const kw = dynamicZone.name.toLowerCase();
        match = cameras.find((c) => {
          const name = (c.name || '').toLowerCase();
          return kw.split(/\s+/).some((w) => w.length > 3 && name.includes(w));
        });
      }
      if (match) {
        handlePromoteToHero(getCamId(match), 0);
      }
      return;
    }

    setCarouselSourceFilter(presetOrZoneId);
    const match = cameras.find((c) => {
      if (presetOrZoneId === 'dispatch') return /gate|entry|dispatch|bay/i.test(c.name);
      if (presetOrZoneId === 'production') return /prod|ware|bay|line/i.test(c.name);
      return /perim|north|fence/i.test(c.name);
    });
    if (match) {
      handlePromoteToHero(getCamId(match), 0);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#090d16] select-none overflow-hidden">
      {/* Tour Status Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#111827] border-b border-[#1f2937] text-xs shrink-0">
        <div className="flex items-center gap-2">
          {/* Quick Camera Dock Toggle */}
          <button
            onClick={() => setIsDockOpen(!isDockOpen)}
            title="Toggle Drag & Drop Camera Dock"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
              isDockOpen
                ? 'bg-[#4fc3f7] text-[#090d16] font-bold border-[#4fc3f7]'
                : 'bg-[#090d16] text-slate-300 hover:text-white border-[#1f2937] hover:border-[#4fc3f7]/50'
            }`}
          >
            <GripVertical className="w-3.5 h-3.5" />
            <span>Camera Dock ({cameras.length})</span>
          </button>

          {availableTours.length > 1 ? (
            <div className="flex items-center gap-1.5 bg-[#090d16] border border-[#4fc3f7]/50 rounded px-2 py-0.5">
              <RotateCw className={`w-3.5 h-3.5 text-[#4fc3f7] ${!isPaused ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
              <select
                value={tour.id}
                onChange={(e) => {
                  const selected = availableTours.find((t) => t.id === e.target.value);
                  if (selected && onSelectTour) {
                    setLiveHeroOverrides(new Map()); // Reset overrides on tour switch
                    onSelectTour(selected);
                  }
                }}
                className="bg-transparent text-[#4fc3f7] font-bold font-mono text-xs outline-none cursor-pointer"
              >
                {availableTours.map((t) => (
                  <option key={t.id} value={t.id} className="bg-[#111827] text-slate-100">
                    TOUR: {t.name.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#4fc3f7]/15 border border-[#4fc3f7]/30 text-[#4fc3f7] font-bold font-mono">
              <RotateCw className={`w-3.5 h-3.5 ${!isPaused ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
              <span>TOUR: {tour.name.toUpperCase()}</span>
            </div>
          )}

          <div className="flex items-center gap-1 bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/50 rounded px-2 py-0.5 text-slate-300">
            <span className="text-[10px] text-slate-400 font-mono">POOL:</span>
            <select
              value={carouselSourceFilter}
              onChange={(e) => setCarouselSourceFilter(e.target.value)}
              className="bg-transparent text-[#4fc3f7] font-semibold text-xs outline-none cursor-pointer"
            >
              <option value="tour_pool" className="bg-[#111827] text-slate-200">Tour Pool ({tour.carouselPoolIds.length})</option>
              <option value="all" className="bg-[#111827] text-slate-200">All Cameras ({cameras.length})</option>
              {customZones.map((z) => (
                <option key={`opt-zone-${z.id}`} value={`zone_${z.id}`} className="bg-[#111827] text-slate-200">
                  {z.icon || '📍'} Zone: {z.name} ({z.cameraIds?.length || 0})
                </option>
              ))}
              {customZones.length === 0 && (
                <>
                  <option value="dispatch" className="bg-[#111827] text-slate-200">Zone: Dispatch & Gates</option>
                  <option value="production" className="bg-[#111827] text-slate-200">Zone: Production Floor</option>
                  <option value="perimeter" className="bg-[#111827] text-slate-200">Zone: Perimeter & Fences</option>
                  <option value="admin" className="bg-[#111827] text-slate-200">Zone: Admin & Reception</option>
                </>
              )}
            </select>
          </div>

          {/* Quick Shift Presets */}
          <div className="hidden lg:flex items-center gap-1.5 pl-1 border-l border-[#1f2937]">
            {(customZones.length > 0
              ? customZones.slice(0, 3)
              : [
                  { id: 'dispatch', name: 'Dispatch', icon: '🏭', color: '#fb923c', cameraIds: [] },
                  { id: 'production', name: 'Production', icon: '⚙️', color: '#4fc3f7', cameraIds: [] },
                  { id: 'perimeter', name: 'Perimeter', icon: '🛡️', color: '#10b981', cameraIds: [] },
                ]
            ).map((z) => {
              const isSelected =
                carouselSourceFilter === `zone_${z.id}` || carouselSourceFilter === z.id;
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => activateShiftPreset(z.id)}
                  title={`Promote ${z.name} to Hero`}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                    isSelected
                      ? 'bg-[#4fc3f7]/20 text-[#4fc3f7] border-[#4fc3f7]/50'
                      : 'bg-[#090d16] text-slate-400 border-[#1f2937] hover:text-slate-200'
                  }`}
                  style={isSelected && z.color ? { color: z.color, borderColor: `${z.color}80` } : {}}
                >
                  {z.icon || '📍'} {z.name}
                </button>
              );
            })}
          </div>

          <span className="text-slate-400 font-mono text-[11px] hidden xl:inline">
            Dwell: {tour.dwellSeconds}s | Pool: {finalPool.length} cams
          </span>

          {activeAlarmHero && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#fb923c] text-gray-950 font-bold text-[11px] animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>ALARM PRIORITY ACTIVE</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {liveHeroOverrides.size > 0 && (
            <button
              onClick={() => setLiveHeroOverrides(new Map())}
              className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-[#090d16] border border-[#1f2937]"
              title="Reset manual camera drag overrides"
            >
              Reset Overrides
            </button>
          )}

          {onOpenTourStudio && (
            <button
              onClick={onOpenTourStudio}
              title="Edit cameras and dwell time in Tour Studio"
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7]/60 text-slate-300 hover:text-white transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#4fc3f7]" />
              <span className="hidden sm:inline">Tour Studio</span>
            </button>
          )}

          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
              isPaused
                ? 'bg-[#fb923c]/20 border-[#fb923c]/50 text-[#fb923c]'
                : 'bg-[#090d16] border-[#1f2937] text-slate-300 hover:text-white'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{isPaused ? 'RESUME' : 'PAUSE'}</span>
          </button>
        </div>
      </div>

      {/* Main Focus Layout Display Grid */}
      <div className="flex-1 w-full h-full p-2 overflow-hidden flex gap-2 relative">
        {/* Quick Camera Dock (Left Collapsible Drawer for Drag & Drop) */}
        {isDockOpen && (
          <div className="w-64 h-full bg-[#111827] border border-[#1f2937] rounded-lg flex flex-col shrink-0 p-3 shadow-2xl z-20 animate-in slide-in-from-left duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-[#1f2937] mb-2.5">
              <span className="text-xs font-bold text-slate-100 font-mono flex items-center gap-1.5">
                <GripVertical className="w-3.5 h-3.5 text-[#4fc3f7]" />
                <span>DRAG & DROP CAMERAS</span>
              </span>
              <button
                onClick={() => setIsDockOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-[#1f2937]"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            <div className="relative mb-2.5">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter cameras..."
                className="w-full bg-[#090d16] border border-[#1f2937] rounded px-2.5 py-1.5 pl-8 text-xs text-slate-100 outline-none font-mono focus:border-[#4fc3f7]"
              />
            </div>

            <p className="text-[10px] text-slate-400 mb-2 leading-tight">
              ✋ Drag any camera below directly onto a <span className="text-[#4fc3f7] font-semibold">Hero</span> or <span className="text-[#fb923c] font-semibold">Carousel</span> tile.
            </p>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {cameras
                .filter((c) => c.name.toLowerCase().includes(searchFilter.toLowerCase()))
                .map((c) => {
                  const camId = getCamId(c);
                  return (
                    <div
                      key={`dock-${camId}`}
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', camId);
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      className="p-2 rounded bg-[#090d16] border border-[#1f2937] hover:border-[#4fc3f7] text-xs text-slate-200 flex items-center justify-between cursor-grab active:cursor-grabbing hover:bg-[#1a2333] transition-all group"
                    >
                      <div className="truncate font-semibold flex items-center gap-1.5">
                        <Video className="w-3 h-3 text-[#4fc3f7] shrink-0" />
                        <span className="truncate">{c.name}</span>
                      </div>
                      <GripVertical className="w-3.5 h-3.5 text-slate-500 group-hover:text-[#4fc3f7] shrink-0" />
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* HERO SECTION (Enlarged Feeds with Interactive Dropzones) */}
        {tour.layoutMode === 'quad-zone' ? (
          /* 4-IN-1 TV QUAD-ZONE MATRIX VIEW */
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 grid-rows-2 gap-2.5 h-full">
            {(customZones.length >= 4
              ? customZones.slice(0, 4)
              : [
                  ...customZones,
                  { id: 'z1', name: 'Gates & Entrance', color: '#4fc3f7', icon: '🚪', cameraIds: [] },
                  { id: 'z2', name: 'Production Floor', color: '#10b981', icon: '⚙️', cameraIds: [] },
                  { id: 'z3', name: 'Warehouse & Dispatch', color: '#fb923c', icon: '🏭', cameraIds: [] },
                  { id: 'z4', name: 'Perimeter & Admin', color: '#a78bfa', icon: '🛡️', cameraIds: [] },
                ].slice(0, 4)
            ).map((zone, zIdx) => {
              let cams = cameras.filter((c) => zone.cameraIds?.includes(getCamId(c)));
              if (cams.length === 0) {
                const regexes = [
                  /gate|entry|outside|main/i,
                  /prod|mach|line|plant|floor/i,
                  /ware|bay|dispatch|truck/i,
                  /perim|north|south|admin|reception/i,
                ];
                cams = cameras.filter((c) => regexes[zIdx % regexes.length].test(c.name));
              }

              const available =
                cams.length > 0 ? cams : [cameras[zIdx % cameras.length]].filter(Boolean);
              const activeCam =
                available.length > 0 ? available[carouselOffset % available.length] : null;
              const activeCamId = activeCam ? getCamId(activeCam) : '';

              return (
                <div
                  key={`zone-quad-${zone.id}`}
                  className="relative h-full w-full bg-[#111827] rounded-lg border border-[#1f2937] hover:border-[#4fc3f7]/50 flex flex-col overflow-hidden shadow-lg"
                >
                  <div className="flex items-center justify-between px-3 py-1.5 bg-[#090d16] border-b border-[#1f2937] text-[11px] font-mono shrink-0">
                    <span className="font-bold tracking-wide flex items-center gap-1.5" style={{ color: zone.color || '#4fc3f7' }}>
                      <span>{zone.icon || '●'}</span>
                      <span>ZONE {zIdx + 1}: {zone.name.toUpperCase()}</span>
                    </span>
                    <span className="text-slate-400 text-[10px]">
                      CYCLE ({((carouselOffset % (available.length || 1)) + 1)}/{available.length || 1})
                    </span>
                  </div>
                  <div className="flex-1 w-full h-full relative">
                    {activeCam ? (
                      <LiveCameraTile
                        camera={activeCam}
                        slotIndex={zIdx}
                        iceServers={iceServers}
                        isMaximized={false}
                        onInstantPlayback={onInstantPlayback}
                        onToggleEmergencyRecord={onToggleEmergencyRecord}
                        isEmergencyRecording={activeEmergencyRecordings?.has(activeCamId)}
                        hasMotionAlert={activeMotionCameraIds?.has(activeCamId)}
                        canControlPtz={canControlPtz ? canControlPtz(activeCamId) : false}
                        targetFps={targetFps}
                        isThrottled={isThrottled}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-500 font-mono text-xs">
                        NO CAMERAS ASSIGNED TO {zone.name.toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {/* HERO SECTION (Enlarged Feeds with Interactive Dropzones) */}
            <div
              className={`h-full ${
                tour.layoutMode === '1+4'
                  ? 'flex-1 grid grid-cols-1'
                  : tour.layoutMode === '2+6'
                  ? 'flex-[2] grid grid-cols-1 md:grid-cols-2 gap-2'
                  : 'flex-[2] grid grid-cols-2 grid-rows-2 gap-2'
              }`}
            >
              {resolvedHeroCameras.map((cam, idx) => {
                const camId = cam ? getCamId(cam) : '';
                return (
                  <div
                    key={`hero-${idx}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      setHoverHeroIdx(idx);
                    }}
                    onDragLeave={() => setHoverHeroIdx(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setHoverHeroIdx(null);
                      const droppedCamId = e.dataTransfer.getData('text/plain');
                      if (droppedCamId) {
                        handlePromoteToHero(droppedCamId, idx);
                      }
                    }}
                    onDoubleClick={() => camId && onTileDoubleClick?.(camId)}
                    className={`relative h-full w-full bg-[#111827] rounded-lg transition-all border-2 overflow-hidden group shadow-xl ${
                      hoverHeroIdx === idx
                        ? 'border-[#4fc3f7] ring-4 ring-[#4fc3f7]/50 bg-[#4fc3f7]/20 scale-[1.005]'
                        : 'border-[#4fc3f7]/40'
                    }`}
                  >
                    {hoverHeroIdx === idx && (
                      <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#090d16]/80 backdrop-blur-xs text-[#4fc3f7] font-mono font-bold animate-pulse">
                        <ArrowUpRight className="w-10 h-10 mb-2" />
                        <span className="text-sm">DROP TO PROMOTE TO HERO {idx + 1}</span>
                      </div>
                    )}

                    {cam ? (
                      <>
                        <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-[#090d16]/90 text-[#4fc3f7] border border-[#4fc3f7]/50 font-mono">
                          <Shield className="w-3 h-3 text-[#4fc3f7]" />
                          <span>HERO {idx + 1} (MAIN HD)</span>
                        </div>
                        <LiveCameraTile
                          camera={cam}
                          slotIndex={idx}
                          iceServers={iceServers}
                          isMaximized={false}
                          onInstantPlayback={onInstantPlayback}
                          onToggleEmergencyRecord={onToggleEmergencyRecord}
                          isEmergencyRecording={activeEmergencyRecordings?.has(camId)}
                          hasMotionAlert={activeMotionCameraIds?.has(camId)}
                          canControlPtz={canControlPtz ? canControlPtz(camId) : false}
                          targetFps={targetFps}
                          isThrottled={isThrottled}
                        />
                      </>
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-slate-500 font-mono text-xs">
                        <span>NO CAMERA ASSIGNED TO HERO {idx + 1}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* CAROUSEL SIDEBAR (Draggable Rotating Thumbnails) */}
            <div
              className={`h-full flex-1 max-w-sm grid ${
                carouselSlotCount <= 4 ? 'grid-cols-1 grid-rows-4' : 'grid-cols-2 grid-rows-3'
              } gap-2`}
            >
              {resolvedCarouselCameras.map((cam, idx) => {
                const camId = cam ? getCamId(cam) : '';
                return (
                  <div
                    key={`carousel-${idx}-${camId || 'empty'}`}
                    draggable={Boolean(cam)}
                    onDragStart={(e) => {
                      if (camId) {
                        e.dataTransfer.setData('text/plain', camId);
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }
                    }}
                    onDoubleClick={() => camId && onTileDoubleClick?.(camId)}
                    className="relative h-full w-full bg-[#111827] rounded-lg border border-[#1f2937] hover:border-[#4fc3f7]/60 transition-all overflow-hidden cursor-grab active:cursor-grabbing group shadow"
                  >
                    {cam ? (
                      <>
                        <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#090d16]/80 text-slate-300 border border-[#1f2937] font-mono">
                          <GripVertical className="w-3 h-3 text-slate-500" />
                          <span>{cam.name}</span>
                        </div>

                        {/* 1-Click Promote Button on Hover */}
                        <button
                          onClick={() => handlePromoteToHero(camId, 0)}
                          title="Promote directly to Hero 1"
                          className="absolute top-1.5 right-1.5 z-20 hidden group-hover:flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#4fc3f7] text-[#090d16] font-mono shadow transition-all active:scale-95"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                          <span>HERO</span>
                        </button>

                        <LiveCameraTile
                          camera={cam}
                          slotIndex={idx + 10}
                          iceServers={iceServers}
                          isMaximized={false}
                          onInstantPlayback={onInstantPlayback}
                          onToggleEmergencyRecord={onToggleEmergencyRecord}
                          isEmergencyRecording={activeEmergencyRecordings?.has(camId)}
                          hasMotionAlert={activeMotionCameraIds?.has(camId)}
                          canControlPtz={canControlPtz ? canControlPtz(camId) : false}
                          targetFps={targetFps}
                          isThrottled={isThrottled}
                        />
                      </>
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-slate-600 font-mono text-[10px]">
                        <span>ROTATING SLOT {idx + 1}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FocusTourLayout;

