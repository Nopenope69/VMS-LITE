import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Plus,
  Trash2,
  Crosshair,
  MousePointer,
  Eye,
  EyeOff,
  ShieldAlert,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  Check,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export interface Point {
  x: number;
  y: number;
}

export type ZoneType = 'INCLUSION' | 'EXCLUSION';

export interface MotionZone {
  id: string;
  cameraId: string;
  name: string;
  zoneType: ZoneType;
  enabled: boolean;
  coordinates: Point[];
  color?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SpatialEvaluationResult {
  allowed: boolean;
  matchedInclusion?: string[];
  matchedExclusion?: string[];
  reason?: string;
}

export interface MotionZoneEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraId: string;
  cameraName: string;
  snapshotUrl?: string;
  apiBaseUrl?: string;
  authToken?: string;
}

type EditorMode = 'SELECT' | 'DRAW_INCLUSION' | 'DRAW_EXCLUSION' | 'TEST_POINT';

export const MotionZoneEditorModal: React.FC<MotionZoneEditorModalProps> = ({
  isOpen,
  onClose,
  cameraId,
  cameraName,
  snapshotUrl,
  apiBaseUrl = '',
  authToken,
}) => {
  const { token: contextToken } = useAuth();
  const effectiveToken = authToken || contextToken || '';

  const [zones, setZones] = useState<MotionZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('SELECT');
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [draggingVertexIndex, setDraggingVertexIndex] = useState<number | null>(null);

  // Test click mode state
  const [testPoint, setTestPoint] = useState<Point | null>(null);
  const [testResult, setTestResult] = useState<SpatialEvaluationResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Load existing zones for camera
  const fetchZones = useCallback(async () => {
    if (!cameraId || !isOpen) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/cameras/${cameraId}/zones`, {
        headers: {
          Authorization: `Bearer ${effectiveToken}`,
        },
      });
      if (!res.ok) {
        throw new Error(`Failed to load motion zones (HTTP ${res.status})`);
      }
      const data = await res.json();
      setZones(data.zones || []);
      if (data.zones && data.zones.length > 0 && !selectedZoneId) {
        setSelectedZoneId(data.zones[0].id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load zones');
    } finally {
      setIsLoading(false);
    }
  }, [cameraId, isOpen, apiBaseUrl, effectiveToken, selectedZoneId]);

  useEffect(() => {
    if (isOpen) {
      fetchZones();
      setDrawingPoints([]);
      setTestPoint(null);
      setTestResult(null);
      setEditorMode('SELECT');
    }
  }, [isOpen, fetchZones]);

  // Convert MouseEvent client coordinates to normalized [0.0, 1.0] point
  const getNormalizedPoint = useCallback((e: React.MouseEvent | MouseEvent): Point | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const rawX = (e.clientX - rect.left) / rect.width;
    const rawY = (e.clientY - rect.top) / rect.height;

    // Strict constraint to [0.0, 1.0]
    const clampedX = Math.max(0.0, Math.min(1.0, rawX));
    const clampedY = Math.max(0.0, Math.min(1.0, rawY));

    return {
      x: Number(clampedX.toFixed(4)),
      y: Number(clampedY.toFixed(4)),
    };
  }, []);

  // Handle SVG Canvas Click
  const handleCanvasClick = async (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getNormalizedPoint(e);
    if (!pt) return;

    if (editorMode === 'DRAW_INCLUSION' || editorMode === 'DRAW_EXCLUSION') {
      // Check if clicking near the first point to close polygon (minimum 3 points required)
      if (drawingPoints.length >= 3) {
        const firstPt = drawingPoints[0];
        const dist = Math.hypot(firstPt.x - pt.x, firstPt.y - pt.y);
        // Closing threshold: ~3% of canvas
        if (dist < 0.035) {
          await finalizeNewZone(drawingPoints);
          return;
        }
      }

      if (drawingPoints.length >= 32) {
        setErrorMessage('Polygon has reached the maximum of 32 vertices. Click the first vertex to close.');
        return;
      }

      setDrawingPoints((prev) => [...prev, pt]);
    } else if (editorMode === 'TEST_POINT') {
      // Test point evaluation
      setTestPoint(pt);
      setIsTesting(true);
      try {
        const res = await fetch(`${apiBaseUrl}/api/cameras/${cameraId}/zones/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${effectiveToken}`,
          },
          body: JSON.stringify(pt),
        });
        if (!res.ok) {
          throw new Error('Point test failed');
        }
        const data = await res.json();
        setTestResult(data.result);
      } catch (err: any) {
        setErrorMessage(err.message || 'Error testing coordinate');
      } finally {
        setIsTesting(false);
      }
    }
  };

  // Finalize newly drawn zone
  const finalizeNewZone = async (points: Point[]) => {
    if (points.length < 3) {
      setErrorMessage('A polygon zone requires at least 3 vertices.');
      return;
    }

    const isExclusion = editorMode === 'DRAW_EXCLUSION';
    const zoneType: ZoneType = isExclusion ? 'EXCLUSION' : 'INCLUSION';
    const defaultName = isExclusion
      ? `Exclusion Zone ${zones.filter((z) => z.zoneType === 'EXCLUSION').length + 1}`
      : `Inclusion Zone ${zones.filter((z) => z.zoneType === 'INCLUSION').length + 1}`;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${apiBaseUrl}/api/cameras/${cameraId}/zones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({
          name: defaultName,
          zoneType,
          coordinates: points,
          enabled: true,
          color: isExclusion ? '#f43f5e' : '#10b981',
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to create zone');
      }

      const data = await res.json();
      setZones((prev) => [...prev, data.zone]);
      setSelectedZoneId(data.zone.id);
      setDrawingPoints([]);
      setEditorMode('SELECT');
      setFeedbackMessage(`Created ${data.zone.name} successfully.`);
      setTimeout(() => setFeedbackMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle vertex drag for selected zone
  const handleVertexMouseDown = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editorMode !== 'SELECT') return;
    setDraggingVertexIndex(index);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getNormalizedPoint(e);
    setMousePos(pt);

    if (draggingVertexIndex !== null && selectedZoneId && pt) {
      setZones((prevZones) =>
        prevZones.map((z) => {
          if (z.id !== selectedZoneId) return z;
          const updatedCoords = [...z.coordinates];
          updatedCoords[draggingVertexIndex] = pt;
          return { ...z, coordinates: updatedCoords };
        })
      );
    }
  };

  const handleCanvasMouseUp = async () => {
    if (draggingVertexIndex !== null && selectedZoneId) {
      const currentZone = zones.find((z) => z.id === selectedZoneId);
      setDraggingVertexIndex(null);

      if (currentZone) {
        // Persist updated coordinates
        try {
          await fetch(`${apiBaseUrl}/api/cameras/${cameraId}/zones/${selectedZoneId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${effectiveToken}`,
            },
            body: JSON.stringify({
              coordinates: currentZone.coordinates,
            }),
          });
        } catch {
          // Non-blocking in UI
        }
      }
    }
  };

  // Toggle zone enable/disable
  const handleToggleZoneEnabled = async (zone: MotionZone) => {
    const updated = !zone.enabled;
    setZones((prev) =>
      prev.map((z) => (z.id === zone.id ? { ...z, enabled: updated } : z))
    );

    try {
      await fetch(`${apiBaseUrl}/api/cameras/${cameraId}/zones/${zone.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({ enabled: updated }),
      });
    } catch (err: any) {
      setErrorMessage('Failed to update zone status');
      fetchZones();
    }
  };

  // Delete a zone
  const handleDeleteZone = async (zoneId: string) => {
    if (!window.confirm('Are you sure you want to delete this motion zone?')) return;

    try {
      const res = await fetch(`${apiBaseUrl}/api/cameras/${cameraId}/zones/${zoneId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${effectiveToken}`,
        },
      });
      if (!res.ok) throw new Error('Failed to delete zone');

      setZones((prev) => prev.filter((z) => z.id !== zoneId));
      if (selectedZoneId === zoneId) {
        setSelectedZoneId(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to delete zone');
    }
  };

  if (!isOpen) return null;

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex flex-col w-full max-w-6xl h-[90vh] bg-[#090d16] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-between px-6 py-4 bg-[#111827] border-b border-[#1f2937]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#4fc3f7]/10 text-[#4fc3f7] border border-[#4fc3f7]/20">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Motion Zones & Spatial Filtering
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[#1f2937] text-slate-300">
                  {cameraName}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Delineate monitored areas and exclude environmental false alarms (swaying trees, roadways, shadows).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-[#1f2937] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Modal Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Main Interactive Canvas Area */}
          <div className="flex-1 relative flex flex-col bg-black overflow-hidden select-none">
            {/* Top Toolbar */}
            <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto bg-[#111827]/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-[#1f2937] shadow-lg text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setEditorMode('SELECT');
                    setDrawingPoints([]);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors ${
                    editorMode === 'SELECT'
                      ? 'bg-[#4fc3f7] text-[#090d16]'
                      : 'text-slate-300 hover:text-white hover:bg-[#1f2937]'
                  }`}
                >
                  <MousePointer className="w-3.5 h-3.5" />
                  <span>Select & Edit</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditorMode('DRAW_INCLUSION');
                    setDrawingPoints([]);
                    setSelectedZoneId(null);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors ${
                    editorMode === 'DRAW_INCLUSION'
                      ? 'bg-[#10b981] text-gray-950 font-bold'
                      : 'text-[#10b981] hover:bg-[#10b981]/20'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Draw Inclusion</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditorMode('DRAW_EXCLUSION');
                    setDrawingPoints([]);
                    setSelectedZoneId(null);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors ${
                    editorMode === 'DRAW_EXCLUSION'
                      ? 'bg-[#f43f5e] text-white font-bold'
                      : 'text-[#f43f5e] hover:bg-[#f43f5e]/20'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Draw Exclusion</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditorMode('TEST_POINT');
                    setDrawingPoints([]);
                    setTestPoint(null);
                    setTestResult(null);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors ${
                    editorMode === 'TEST_POINT'
                      ? 'bg-[#fb923c] text-gray-950 font-bold'
                      : 'text-[#fb923c] hover:bg-[#fb923c]/20'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>Test Click Mode</span>
                </button>
              </div>

              {/* Status / Instructions Badge */}
              <div className="pointer-events-auto bg-[#111827]/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-[#1f2937] text-xs font-mono text-slate-300">
                {editorMode === 'SELECT' && 'Click zone or drag handles to reshape'}
                {(editorMode === 'DRAW_INCLUSION' || editorMode === 'DRAW_EXCLUSION') && (
                  <span>
                    Click to add vertex ({drawingPoints.length}/32).{' '}
                    {drawingPoints.length >= 3 ? 'Click 1st point to close.' : 'Need ≥ 3 points.'}
                  </span>
                )}
                {editorMode === 'TEST_POINT' && 'Click anywhere on frame to test spatial filtering'}
              </div>
            </div>

            {/* Error or Feedback Alert Banner */}
            {errorMessage && (
              <div className="absolute top-16 left-6 right-6 z-30 flex items-center justify-between p-3 rounded-lg bg-red-950/90 border border-red-700 text-red-200 text-xs shadow-xl backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
                <button type="button" onClick={() => setErrorMessage(null)} className="p-1 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {feedbackMessage && (
              <div className="absolute top-16 left-6 right-6 z-30 flex items-center gap-2 p-3 rounded-lg bg-emerald-950/90 border border-emerald-700 text-emerald-200 text-xs shadow-xl backdrop-blur-sm">
                <Check className="w-4 h-4 shrink-0" />
                <span>{feedbackMessage}</span>
              </div>
            )}

            {/* Interactive SVG Canvas */}
            <div className="flex-1 w-full h-full relative flex items-center justify-center p-4">
              <svg
                ref={svgRef}
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                className={`w-full h-full max-h-full aspect-video border border-[#1f2937] rounded-lg shadow-inner bg-slate-950/80 ${
                  editorMode === 'TEST_POINT'
                    ? 'cursor-crosshair'
                    : editorMode.startsWith('DRAW')
                    ? 'cursor-crosshair'
                    : 'cursor-default'
                }`}
              >
                {/* Background Grid Pattern */}
                <defs>
                  <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
                    <path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="1000" height="1000" fill="url(#grid)" />

                {/* Render Existing Saved Zones */}
                {zones.map((zone) => {
                  if (!zone.coordinates || zone.coordinates.length < 3) return null;
                  const isSelected = zone.id === selectedZoneId;
                  const isExclusion = zone.zoneType === 'EXCLUSION';
                  const pointsStr = zone.coordinates.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ');

                  const fillColor = isExclusion
                    ? 'rgba(244, 63, 94, 0.25)'
                    : 'rgba(16, 185, 129, 0.20)';
                  const strokeColor = isExclusion ? '#f43f5e' : '#10b981';

                  return (
                    <g key={zone.id}>
                      <polygon
                        points={pointsStr}
                        fill={zone.enabled ? fillColor : 'rgba(100, 116, 139, 0.15)'}
                        stroke={zone.enabled ? strokeColor : '#64748b'}
                        strokeWidth={isSelected ? '4' : '2'}
                        strokeDasharray={zone.enabled ? undefined : '8,6'}
                        className="transition-all cursor-pointer hover:opacity-90"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedZoneId(zone.id);
                          setEditorMode('SELECT');
                        }}
                      />

                      {/* Zone Center Label */}
                      {zone.coordinates.length > 0 && (
                        <text
                          x={zone.coordinates[0].x * 1000 + 10}
                          y={zone.coordinates[0].y * 1000 + 20}
                          fill="#ffffff"
                          fontSize="20"
                          fontWeight="bold"
                          className="pointer-events-none drop-shadow-md select-none font-mono"
                        >
                          {zone.name} ({zone.zoneType})
                        </text>
                      )}

                      {/* Vertex Handles for Selected Zone */}
                      {isSelected &&
                        editorMode === 'SELECT' &&
                        zone.coordinates.map((pt, idx) => (
                          <circle
                            key={idx}
                            cx={pt.x * 1000}
                            cy={pt.y * 1000}
                            r={draggingVertexIndex === idx ? '14' : '10'}
                            fill="#ffffff"
                            stroke={strokeColor}
                            strokeWidth="4"
                            className="cursor-move hover:scale-125 transition-transform"
                            onMouseDown={(e) => handleVertexMouseDown(idx, e)}
                          />
                        ))}
                    </g>
                  );
                })}

                {/* Render In-Progress Drawing Points & Rubber-Band Line */}
                {drawingPoints.length > 0 && (
                  <g>
                    {/* Polyline connecting points */}
                    <polyline
                      points={drawingPoints.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                      fill="none"
                      stroke={editorMode === 'DRAW_EXCLUSION' ? '#f43f5e' : '#10b981'}
                      strokeWidth="3"
                      strokeDasharray="6,4"
                    />

                    {/* Rubber band line to mouse position */}
                    {mousePos && (
                      <line
                        x1={drawingPoints[drawingPoints.length - 1].x * 1000}
                        y1={drawingPoints[drawingPoints.length - 1].y * 1000}
                        x2={mousePos.x * 1000}
                        y2={mousePos.y * 1000}
                        stroke={editorMode === 'DRAW_EXCLUSION' ? '#f43f5e' : '#10b981'}
                        strokeWidth="2"
                        strokeDasharray="4,4"
                      />
                    )}

                    {/* Drawn vertex handles */}
                    {drawingPoints.map((pt, idx) => (
                      <circle
                        key={idx}
                        cx={pt.x * 1000}
                        cy={pt.y * 1000}
                        r={idx === 0 && drawingPoints.length >= 3 ? '14' : '8'}
                        fill={idx === 0 && drawingPoints.length >= 3 ? '#fb923c' : '#ffffff'}
                        stroke={editorMode === 'DRAW_EXCLUSION' ? '#f43f5e' : '#10b981'}
                        strokeWidth="3"
                        className={idx === 0 && drawingPoints.length >= 3 ? 'animate-pulse' : ''}
                      />
                    ))}
                  </g>
                )}

                {/* Render Test Point Target Marker */}
                {testPoint && (
                  <g className="animate-in zoom-in-50 duration-200">
                    <circle
                      cx={testPoint.x * 1000}
                      cy={testPoint.y * 1000}
                      r="22"
                      fill="none"
                      stroke={testResult?.allowed ? '#10b981' : '#f43f5e'}
                      strokeWidth="4"
                      className="animate-ping"
                    />
                    <circle
                      cx={testPoint.x * 1000}
                      cy={testPoint.y * 1000}
                      r="12"
                      fill={testResult?.allowed ? '#10b981' : '#f43f5e'}
                      stroke="#ffffff"
                      strokeWidth="3"
                    />
                    <line
                      x1={testPoint.x * 1000 - 24}
                      y1={testPoint.y * 1000}
                      x2={testPoint.x * 1000 + 24}
                      y2={testPoint.y * 1000}
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                    <line
                      x1={testPoint.x * 1000}
                      y1={testPoint.y * 1000 - 24}
                      x2={testPoint.x * 1000}
                      y2={testPoint.y * 1000 + 24}
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                  </g>
                )}
              </svg>
            </div>

            {/* Test Point Result Banner */}
            {testResult && testPoint && (
              <div
                className={`absolute bottom-4 left-6 right-6 z-30 flex items-center justify-between p-3 rounded-lg border shadow-xl backdrop-blur-md ${
                  testResult.allowed
                    ? 'bg-emerald-950/90 border-emerald-600 text-emerald-100'
                    : 'bg-rose-950/90 border-rose-600 text-rose-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  {testResult.allowed ? (
                    <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0" />
                  )}
                  <div>
                    <div className="font-bold text-xs uppercase tracking-wide">
                      {testResult.allowed ? '✓ MOTION ALLOWED (EVENT PASS)' : '✗ MOTION SUPPRESSED (EVENT DROP)'}
                    </div>
                    <div className="text-[11px] opacity-90 font-mono">
                      Coordinate: ({testPoint.x.toFixed(3)}, {testPoint.y.toFixed(3)}) — {testResult.reason}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTestPoint(null);
                    setTestResult(null);
                  }}
                  className="px-2.5 py-1 text-xs rounded bg-black/40 hover:bg-black/60 transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Right Sidebar: Zones Catalog & Settings */}
          <aside className="w-80 bg-[#111827] border-l border-[#1f2937] flex flex-col justify-between overflow-y-auto">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1f2937] pb-3">
                <span className="text-xs font-bold text-slate-200 tracking-wider uppercase">
                  Zones ({zones.length})
                </span>
                <button
                  type="button"
                  onClick={fetchZones}
                  title="Refresh zones"
                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#1f2937] transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Zone List */}
              <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
                {zones.length === 0 ? (
                  <div className="p-4 text-center border border-dashed border-[#1f2937] rounded-lg text-xs text-slate-400">
                    No zones configured. The full camera frame is currently active.
                  </div>
                ) : (
                  zones.map((zone) => {
                    const isSelected = zone.id === selectedZoneId;
                    const isExclusion = zone.zoneType === 'EXCLUSION';

                    return (
                      <div
                        key={zone.id}
                        onClick={() => setSelectedZoneId(zone.id)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#1f2937] border-[#4fc3f7] shadow-md ring-1 ring-[#4fc3f7]/30'
                            : 'bg-[#090d16] border-[#1f2937] hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-xs text-slate-100 truncate flex-1">
                            {zone.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              isExclusion
                                ? 'bg-[#f43f5e]/20 text-[#f43f5e] border border-[#f43f5e]/40'
                                : 'bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40'
                            }`}
                          >
                            {zone.zoneType}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span>{zone.coordinates.length} vertices</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleZoneEnabled(zone);
                              }}
                              title={zone.enabled ? 'Disable zone' : 'Enable zone'}
                              className={`p-1 rounded hover:bg-black/30 transition-colors ${
                                zone.enabled ? 'text-emerald-400' : 'text-slate-500'
                              }`}
                            >
                              {zone.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteZone(zone.id);
                              }}
                              title="Delete zone"
                              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-black/30 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Multi-Zone Precedence Truth Table Legend */}
              <div className="p-3 bg-[#090d16] rounded-lg border border-[#1f2937] text-[11px] space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-200">
                  <HelpCircle className="w-3.5 h-3.5 text-[#4fc3f7]" />
                  <span>Evaluation Rules</span>
                </div>
                <ul className="space-y-1 text-slate-400 list-disc list-inside text-[10px]">
                  <li>
                    <span className="text-[#f43f5e] font-semibold">Exclusion</span> wins immediately: motion in any red zone is suppressed.
                  </li>
                  <li>
                    <span className="text-[#10b981] font-semibold">Inclusion</span> zones require at least one match if configured.
                  </li>
                  <li>If no inclusion zones exist, the full frame outside exclusions is active.</li>
                </ul>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="p-4 border-t border-[#1f2937] bg-[#090d16]/50">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 bg-[#1f2937] hover:bg-[#374151] text-slate-200 font-semibold text-xs rounded-lg transition-colors"
              >
                Close Editor
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default MotionZoneEditorModal;
