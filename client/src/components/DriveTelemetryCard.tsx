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
    <div
      style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HardDrive size={18} style={{ color: '#38bdf8' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f8fafc' }}>
            Storage Hardware & S.M.A.R.T. Telemetry
          </h3>
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#94a3b8',
          }}
        >
          {drives.length} Detected Block {drives.length === 1 ? 'Device' : 'Devices'}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '14px',
        }}
      >
        {drives.map((drive) => {
          const isFailed = drive.healthStatus === 'FAILED' || drive.criticalWarning;
          const isHot = (drive.temperatureCelsius ?? 0) >= 55;

          return (
            <div
              key={drive.path}
              style={{
                backgroundColor: '#0f172a',
                border: `1px solid ${isFailed ? '#ef4444' : isHot ? '#f59e0b' : '#334155'}`,
                borderRadius: '6px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: '#f8fafc' }}>
                      {drive.name}
                    </span>
                    {(drive.removable || drive.hotplug) && (
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px',
                          fontSize: '10px',
                          fontWeight: 700,
                          backgroundColor: '#0284c7',
                          color: '#ffffff',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        <Usb size={10} /> USB/EXT
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        backgroundColor: '#1e293b',
                        color: '#94a3b8',
                        padding: '1px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      {drive.rotational ? 'HDD' : 'SSD'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                    {drive.model}
                  </div>
                </div>

                {/* Health Badge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: isFailed ? '#7f1d1d' : '#064e3b',
                    color: isFailed ? '#fca5a5' : '#6ee7b7',
                  }}
                >
                  {isFailed ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                  <span>{drive.healthStatus}</span>
                </div>
              </div>

              {/* Specs & Metrics */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  marginTop: '4px',
                }}
              >
                <div>
                  <span style={{ color: '#64748b' }}>Capacity: </span>
                  <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                    {formatBytes(drive.sizeBytes)}
                  </span>
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Temp: </span>
                  <span
                    style={{
                      color: isHot ? '#f87171' : '#38bdf8',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                  >
                    <Thermometer size={12} />
                    {drive.temperatureCelsius !== null ? `${drive.temperatureCelsius}°C` : 'N/A'}
                  </span>
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Power-On: </span>
                  <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                    {drive.powerOnHours !== null ? `${drive.powerOnHours}h` : 'N/A'}
                  </span>
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Bad Sectors: </span>
                  <span
                    style={{
                      color: (drive.reallocatedSectors ?? 0) > 0 ? '#f87171' : '#cbd5e1',
                      fontWeight: 600,
                    }}
                  >
                    {drive.reallocatedSectors ?? 0}
                  </span>
                </div>
              </div>

              {/* Mountpoint indicator */}
              <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', gap: '4px' }}>
                <span>Mount:</span>
                <span style={{ color: drive.mountpoint ? '#38bdf8' : '#64748b', fontFamily: 'monospace' }}>
                  {drive.mountpoint || 'Unmounted'}
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
