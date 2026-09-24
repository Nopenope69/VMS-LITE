import React, { useState } from 'react';
import { CameraStreamInfo, LiveCameraTile } from './LiveCameraTile.js';

export type GridLayoutMode = '1x1' | '2x2' | '3x3';

export interface LiveGridProps {
  layout: GridLayoutMode;
  cameras: CameraStreamInfo[];
  assignedSlots: (CameraStreamInfo | null)[];
  onAssignSlot: (slotIndex: number, camera: CameraStreamInfo) => void;
  onClearSlot: (slotIndex: number) => void;
  activeMotionCameraIds?: Set<string>;
  iceServers?: RTCIceServer[];
}

export const LiveGrid: React.FC<LiveGridProps> = ({
  layout,
  cameras,
  assignedSlots,
  onAssignSlot,
  onClearSlot,
  activeMotionCameraIds,
  iceServers,
}) => {
  const [maximizedSlotIndex, setMaximizedSlotIndex] = useState<number | null>(null);

  // Keyboard accessibility: ESC key exits maximized single-camera view
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && maximizedSlotIndex !== null) {
        setMaximizedSlotIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [maximizedSlotIndex]);

  const getSlotCount = (mode: GridLayoutMode): number => {
    switch (mode) {
      case '1x1':
        return 1;
      case '2x2':
        return 4;
      case '3x3':
        return 9;
      default:
        return 4;
    }
  };

  const getGridClasses = (mode: GridLayoutMode): string => {
    switch (mode) {
      case '1x1':
        return 'grid-cols-1 grid-rows-1';
      case '2x2':
        return 'grid-cols-1 md:grid-cols-2 auto-rows-fr';
      case '3x3':
        return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr';
      default:
        return 'grid-cols-2';
    }
  };

  // If a slot is maximized, display only that slot in 1x1 mode
  if (maximizedSlotIndex !== null) {
    const camera = assignedSlots[maximizedSlotIndex] || null;
    return (
      <div className="w-full h-full p-2.5 bg-[#090d16] flex items-center justify-center">
        <LiveCameraTile
          slotIndex={maximizedSlotIndex}
          camera={camera}
          availableCameras={cameras}
          onAssignCamera={onAssignSlot}
          onClearSlot={onClearSlot}
          onMaximizeSlot={() => setMaximizedSlotIndex(null)}
          isMaximized={true}
          forceSubStream={false} // Fullscreen solo uses high-res main stream
          hasMotionAlert={Boolean(camera && activeMotionCameraIds?.has(camera.cameraId))}
          iceServers={iceServers}
        />
      </div>
    );
  }

  const slotCount = getSlotCount(layout);
  const slotsToRender = Array.from({ length: slotCount }, (_, i) => assignedSlots[i] || null);
  const forceSubStream = layout === '2x2' || layout === '3x3';

  return (
    <div
      className={`grid w-full h-full gap-2.5 p-2.5 bg-[#090d16] overflow-auto ${getGridClasses(layout)}`}
      style={{ minHeight: '400px' }}
    >
      {slotsToRender.map((cam, idx) => (
        <div key={`grid-slot-${idx}`} className="w-full h-full min-h-[220px]">
          <LiveCameraTile
            slotIndex={idx}
            camera={cam}
            availableCameras={cameras}
            onAssignCamera={onAssignSlot}
            onClearSlot={onClearSlot}
            onMaximizeSlot={(slot) => setMaximizedSlotIndex(slot)}
            isMaximized={false}
            forceSubStream={forceSubStream}
            hasMotionAlert={Boolean(cam && activeMotionCameraIds?.has(cam.cameraId))}
            iceServers={iceServers}
          />
        </div>
      ))}
    </div>
  );
};

export default LiveGrid;
