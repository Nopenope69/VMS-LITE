import React, { useState } from 'react';
import { Maximize2, Minimize2, Volume2, VolumeX, AlertCircle, Video } from 'lucide-react';
import { PlaybackPlayer } from './PlaybackPlayer.js';

export interface SyncCameraSlot {
  cameraId: string;
  cameraName: string;
  streamUrl: string | null;
  available: boolean;
  hasSegmentsOnDate: boolean;
}

export interface SyncPlaybackGridProps {
  slots: SyncCameraSlot[];
  isPlaying: boolean;
  playbackRate: number;
  onMasterTimeUpdate?: (seconds: number) => void;
  onSelectCameraToScrub?: (cameraId: string) => void;
}

export const SyncPlaybackGrid: React.FC<SyncPlaybackGridProps> = ({
  slots,
  isPlaying,
  playbackRate,
  onMasterTimeUpdate,
}) => {
  const [maximizedSlotId, setMaximizedSlotId] = useState<string | null>(null);
  const [mutedSlots, setMutedSlots] = useState<Record<string, boolean>>({});

  const toggleMute = (camId: string) => {
    setMutedSlots((prev) => ({
      ...prev,
      [camId]: prev[camId] === undefined ? false : !prev[camId], // default is muted
    }));
  };

  const toggleMaximize = (camId: string) => {
    setMaximizedSlotId((prev) => (prev === camId ? null : camId));
  };

  if (slots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-[#090d16] text-slate-400 p-8 text-center">
        <Video className="w-12 h-12 text-[#4fc3f7] mb-3 opacity-60" />
        <h3 className="text-sm font-bold text-slate-200">No Cameras Selected for Sync Playback</h3>
        <p className="text-xs text-slate-500 max-w-sm mt-1">
          Select up to 4 cameras from the camera selection drawer to play back all feeds locked in time synchronization.
        </p>
      </div>
    );
  }

  const displayedSlots = maximizedSlotId
    ? slots.filter((s) => s.cameraId === maximizedSlotId)
    : slots;

  const gridClass =
    displayedSlots.length === 1
      ? 'grid-cols-1 grid-rows-1'
      : displayedSlots.length === 2
      ? 'grid-cols-2 grid-rows-1'
      : 'grid-cols-2 grid-rows-2';

  return (
    <div className={`w-full h-full grid ${gridClass} gap-1.5 p-1.5 bg-[#090d16] overflow-hidden`}>
      {displayedSlots.map((slot, index) => {
        const isMaster = index === 0;
        const isMuted = mutedSlots[slot.cameraId] ?? !isMaster; // Master slot unmuted by default, others muted

        return (
          <div
            key={slot.cameraId}
            className="relative w-full h-full bg-black rounded border border-[#1f2937] overflow-hidden flex flex-col group"
          >
            {/* Camera Header Overlay */}
            <div className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-1.5 bg-[#090d16]/85 backdrop-blur-sm px-2.5 py-1 rounded text-xs font-semibold text-slate-200 border border-[#1f2937]">
                <div className="w-2 h-2 rounded-full bg-[#4fc3f7] animate-pulse" />
                <span>{slot.cameraName}</span>
                {isMaster && (
                  <span className="text-[10px] text-[#4fc3f7] font-mono px-1 rounded bg-[#4fc3f7]/15">
                    MASTER
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => toggleMute(slot.cameraId)}
                  title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                  className="p-1 rounded bg-[#090d16]/85 text-slate-300 hover:text-white border border-[#1f2937]"
                >
                  {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-[#4fc3f7]" />}
                </button>
                <button
                  type="button"
                  onClick={() => toggleMaximize(slot.cameraId)}
                  title={maximizedSlotId === slot.cameraId ? 'Restore Quad View' : 'Maximize Tile'}
                  className="p-1 rounded bg-[#090d16]/85 text-slate-300 hover:text-white border border-[#1f2937]"
                >
                  {maximizedSlotId === slot.cameraId ? (
                    <Minimize2 className="w-3.5 h-3.5" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Video Player or No-Recording Overlay */}
            <div className="flex-1 w-full h-full relative">
              {slot.available && slot.streamUrl ? (
                <PlaybackPlayer
                  streamUrl={slot.streamUrl}
                  isPlaying={isPlaying}
                  playbackRate={playbackRate}
                  cameraName={slot.cameraName}
                  onTimeUpdate={isMaster ? onMasterTimeUpdate : undefined}
                />
              ) : (
                <div className="flex flex-col items-center justify-center w-full h-full bg-[#0d131f] text-slate-500 p-4 text-center select-none">
                  <AlertCircle className="w-8 h-8 text-amber-500/70 mb-2" />
                  <span className="text-xs font-semibold text-slate-300">No Recording Segment</span>
                  <span className="text-[11px] text-slate-500 mt-0.5">
                    {slot.hasSegmentsOnDate
                      ? 'No recorded footage at this timestamp.'
                      : 'No recordings on this date.'}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
