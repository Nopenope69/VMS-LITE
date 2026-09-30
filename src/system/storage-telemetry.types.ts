export interface DriveTelemetry {
  name: string;
  path: string;
  model: string;
  sizeBytes: number;
  rotational: boolean; // true = HDD, false = SSD/NVMe
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
  rawSmartData?: any;
}

export interface DriveTelemetrySummary {
  totalDrives: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  maxTemperatureCelsius: number | null;
  removableMounts: Array<{
    name: string;
    path: string;
    mountpoint: string;
    sizeBytes: number;
  }>;
}
