import React from 'react';
import { HardDrive, AlertTriangle, CheckCircle2, Thermometer, Usb, Zap } from 'lucide-react';

export interface DriveItem {
  name: string;
  path: string;
  model: string;
  sizeBytes: number;
  rotational: boolean;
  removable: boolean;
  hotplug: boolean;
  mountpoint: string | null;
  smartSupported: boolean;
  healthStatus: 'PASSED' | 'FAILED' | 'UNKNOWN' | 'NOT_SUPPORTED';
  temperatureCelsius: number | null;
  powerOnHours: number | null;
  reallocatedSectors: number | null;
  wearPercentage: number | null;
  criticalWarning: boolean;
}

export interface DriveTelemetryCardProps {
  drives: DriveItem[];
  onRefresh?: () => void;
}

export const DriveTelemetryCard: React.FC<DriveTelemetryCardProps> = ({ drives }) => {
  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <div className="alert-glass border border-white/10 rounded-xl p-5 mb-6 shadow-xl">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <HardDrive size={18} className="text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">
            Storage Hardware & S.M.A.R.T. Telemetry
          </h3>
        </div>
        <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
          {drives.length} Detected Block {drives.length === 1 ? 'Device' : 'Devices'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {drives.map((drive) => {
          const isFailed = drive.healthStatus === 'FAILED' || drive.criticalWarning;
          const isHot = (drive.temperatureCelsius ?? 0) >= 55;

          return (
            <div
              key={drive.path}
              className={`bg-zinc-950/70 border rounded-xl p-3.5 flex flex-col gap-2.5 transition-all shadow-md ${
                isFailed
                  ? 'border-rose-500/60 shadow-[0_0_16px_rgba(239,68,68,0.1)]'
                  : isHot
                  ? 'border-amber-500/50'
                  : 'border-white/10 hover:border-white/20'
              }`}
            >
              {/* Header */}
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs text-zinc-100 font-mono">
                      {drive.name}
                    </span>
                    {(drive.removable || drive.hotplug) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 px-1.5 py-0.2 rounded">
                        <Usb size={10} /> USB/EXT
                      </span>
                    )}
                    <span className="text-[10px] font-mono font-semibold bg-white/5 border border-white/5 text-zinc-400 px-1.5 py-0.2 rounded">
                      {drive.rotational ? 'HDD' : 'NVMe/SSD'}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5 truncate max-w-[180px]">
                    {drive.model}
                  </div>
                </div>

                {/* Health Badge */}
                <div
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    isFailed
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  {isFailed ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                  <span>{drive.healthStatus}</span>
                </div>
              </div>

              {/* Specs & Metrics */}
              <div className="grid grid-cols-2 gap-2 bg-zinc-900/60 border border-white/5 p-2 rounded-lg text-xs font-mono text-[11px]">
                <div>
                  <span className="text-zinc-500">Capacity: </span>
                  <span className="text-zinc-200 font-semibold">
                    {formatBytes(drive.sizeBytes)}
                  </span>
                </div>

                <div>
                  <span className="text-zinc-500">Temp: </span>
                  <span
                    className={`font-semibold inline-flex items-center gap-1 ${
                      isHot ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    <Thermometer size={11} />
                    {drive.temperatureCelsius !== null ? `${drive.temperatureCelsius}°C` : 'N/A'}
                  </span>
                </div>

                <div>
                  <span className="text-zinc-500">Power-On: </span>
                  <span className="text-zinc-200 font-semibold">
                    {drive.powerOnHours !== null ? `${drive.powerOnHours}h` : 'N/A'}
                  </span>
                </div>

                <div>
                  <span className="text-zinc-500">Bad Sectors: </span>
                  <span
                    className={`font-semibold ${
                      (drive.reallocatedSectors ?? 0) > 0 ? 'text-rose-400' : 'text-zinc-200'
                    }`}
                  >
                    {drive.reallocatedSectors ?? 0}
                  </span>
                </div>
              </div>

              {/* Mountpoint indicator */}
              <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 font-mono">
                <span>Mount:</span>
                <span className="text-zinc-300 truncate">
                  {drive.mountpoint || 'Unmounted Pool'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DriveTelemetryCard;
