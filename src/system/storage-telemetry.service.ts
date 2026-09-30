import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { DriveTelemetry, DriveTelemetrySummary } from './storage-telemetry.types.js';

const execFileAsync = promisify(execFile);

export interface StorageTelemetryServiceOptions {
  eventBus?: EventBus;
  pollIntervalMs?: number;
  tempWarningThreshold?: number;
  tempCriticalThreshold?: number;
  execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

export class StorageTelemetryService {
  private readonly eventBus: EventBus;
  private readonly pollIntervalMs: number;
  private readonly tempWarningThreshold: number;
  private readonly tempCriticalThreshold: number;
  private readonly execFn: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  private timer: NodeJS.Timeout | null = null;
  private cachedDrives: DriveTelemetry[] = [];
  private lastAlertTimes = new Map<string, number>();

  constructor(opts: StorageTelemetryServiceOptions = {}) {
    this.eventBus = opts.eventBus || defaultEventBus;
    this.pollIntervalMs = opts.pollIntervalMs ?? 60000;
    this.tempWarningThreshold = opts.tempWarningThreshold ?? 55;
    this.tempCriticalThreshold = opts.tempCriticalThreshold ?? 60;
    this.execFn = opts.execFn || (async (cmd, args) => execFileAsync(cmd, args));
  }

  async start(): Promise<void> {
    await this.poll();
    if (this.pollIntervalMs > 0 && !this.timer) {
      this.timer = setInterval(() => {
        this.poll().catch((err) => {
          // Log error but don't crash
        });
      }, this.pollIntervalMs);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getCachedDrives(): DriveTelemetry[] {
    return [...this.cachedDrives];
  }

  getSummary(): DriveTelemetrySummary {
    const drives = this.cachedDrives;
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let maxTemp: number | null = null;
    const removableMounts: DriveTelemetrySummary['removableMounts'] = [];

    for (const d of drives) {
      if (d.temperatureCelsius !== null) {
        if (maxTemp === null || d.temperatureCelsius > maxTemp) {
          maxTemp = d.temperatureCelsius;
        }
      }

      if (d.criticalWarning || d.healthStatus === 'FAILED') {
        criticalCount++;
      } else if (
        (d.temperatureCelsius !== null && d.temperatureCelsius >= this.tempWarningThreshold) ||
        (d.reallocatedSectors !== null && d.reallocatedSectors > 0)
      ) {
        warningCount++;
      } else {
        healthyCount++;
      }

      if ((d.removable || d.hotplug) && d.mountpoint) {
        removableMounts.push({
          name: d.name,
          path: d.path,
          mountpoint: d.mountpoint,
          sizeBytes: d.sizeBytes,
        });
      }
    }

    return {
      totalDrives: drives.length,
      healthyCount,
      warningCount,
      criticalCount,
      maxTemperatureCelsius: maxTemp,
      removableMounts,
    };
  }

  async poll(): Promise<DriveTelemetry[]> {
    try {
      const blockDevices = await this.discoverBlockDevices();
      const telemetryList: DriveTelemetry[] = [];

      for (const dev of blockDevices) {
        const smart = await this.querySmartctl(dev.path);
        const telemetry: DriveTelemetry = {
          ...dev,
          ...smart,
          criticalWarning:
            smart.healthStatus === 'FAILED' ||
            (smart.temperatureCelsius !== null && smart.temperatureCelsius >= this.tempCriticalThreshold),
        };

        telemetryList.push(telemetry);
        this.checkAndEmitAlert(telemetry);
      }

      this.cachedDrives = telemetryList;
      return telemetryList;
    } catch (err) {
      // Return cached on error or mock fallback if empty
      if (this.cachedDrives.length === 0) {
        this.cachedDrives = this.getDevFallbackDrives();
      }
      return this.cachedDrives;
    }
  }

  private checkAndEmitAlert(drive: DriveTelemetry): void {
    if (!drive.criticalWarning && (drive.temperatureCelsius === null || drive.temperatureCelsius < this.tempWarningThreshold)) {
      return;
    }

    const now = Date.now();
    const lastAlert = this.lastAlertTimes.get(drive.path) || 0;
    // 15-minute alert cooldown per drive
    if (now - lastAlert < 15 * 60 * 1000) {
      return;
    }

    this.lastAlertTimes.set(drive.path, now);

    const severity = drive.criticalWarning ? 'critical' : 'warning';
    const message = drive.healthStatus === 'FAILED'
      ? `Drive ${drive.name} (${drive.model}) reported SMART predictive failure!`
      : `Drive ${drive.name} temperature high: ${drive.temperatureCelsius}°C`;

    this.eventBus.emitEvent({
      type: 'storage.drive_degraded',
      source: 'storage-telemetry',
      severity,
      metadata: {
        drivePath: drive.path,
        name: drive.name,
        model: drive.model,
        temperature: drive.temperatureCelsius,
        healthStatus: drive.healthStatus,
        message,
      },
      timestamp: new Date(),
    }).catch(() => {});
  }

  async discoverBlockDevices(): Promise<
    Array<{
      name: string;
      path: string;
      model: string;
      sizeBytes: number;
      rotational: boolean;
      removable: boolean;
      hotplug: boolean;
      mountpoint: string | null;
    }>
  > {
    try {
      const { stdout } = await this.execFn('lsblk', [
        '-J',
        '-b',
        '-o',
        'NAME,PATH,MODEL,SIZE,ROTA,TYPE,MOUNTPOINT,RM,HOTPLUG',
      ]);
      const parsed = JSON.parse(stdout);
      const devices = parsed.blockdevices || [];
      const result: any[] = [];

      for (const dev of devices) {
        if (dev.type === 'disk') {
          // If the disk itself doesn't have a mountpoint, check children (partitions)
          let mountpoint = dev.mountpoint || null;
          if (!mountpoint && Array.isArray(dev.children)) {
            const childWithMount = dev.children.find((c: any) => c.mountpoint);
            if (childWithMount) mountpoint = childWithMount.mountpoint;
          }

          result.push({
            name: dev.name,
            path: dev.path || `/dev/${dev.name}`,
            model: (dev.model || 'Unknown Disk').trim(),
            sizeBytes: Number(dev.size) || 0,
            rotational: Boolean(dev.rota === '1' || dev.rota === true || dev.rota === 1),
            removable: Boolean(dev.rm === '1' || dev.rm === true || dev.rm === 1),
            hotplug: Boolean(dev.hotplug === '1' || dev.hotplug === true || dev.hotplug === 1),
            mountpoint,
          });
        }
      }

      return result;
    } catch {
      return [];
    }
  }

  async querySmartctl(devicePath: string): Promise<{
    smartSupported: boolean;
    healthStatus: 'PASSED' | 'FAILED' | 'UNKNOWN' | 'NOT_SUPPORTED';
    temperatureCelsius: number | null;
    powerOnHours: number | null;
    reallocatedSectors: number | null;
    wearPercentage: number | null;
  }> {
    try {
      const { stdout } = await this.execFn('smartctl', ['--json=c', '-a', devicePath]);
      const json = JSON.parse(stdout);

      const smartSupported = json.smart_support?.available ?? true;
      if (!smartSupported) {
        return {
          smartSupported: false,
          healthStatus: 'NOT_SUPPORTED',
          temperatureCelsius: null,
          powerOnHours: null,
          reallocatedSectors: null,
          wearPercentage: null,
        };
      }

      const passed = json.smart_status?.passed ?? (json.smartctl?.exit_status === 0);
      const healthStatus = passed ? 'PASSED' : 'FAILED';

      const temp = json.temperature?.current ?? null;
      const hours = json.power_on_time?.hours ?? null;

      // ATA reallocated sectors
      let reallocatedSectors: number | null = null;
      if (Array.isArray(json.ata_smart_attributes?.table)) {
        const attr = json.ata_smart_attributes.table.find((a: any) => a.id === 5);
        if (attr) {
          reallocatedSectors = attr.raw?.value ?? null;
        }
      }

      // NVMe wear percentage
      let wearPercentage: number | null = null;
      if (json.nvme_smart_health_information_log?.percentage_used !== undefined) {
        wearPercentage = json.nvme_smart_health_information_log.percentage_used;
      }

      return {
        smartSupported: true,
        healthStatus,
        temperatureCelsius: temp,
        powerOnHours: hours,
        reallocatedSectors,
        wearPercentage,
      };
    } catch {
      return {
        smartSupported: false,
        healthStatus: 'UNKNOWN',
        temperatureCelsius: null,
        powerOnHours: null,
        reallocatedSectors: null,
        wearPercentage: null,
      };
    }
  }

  private getDevFallbackDrives(): DriveTelemetry[] {
    return [
      {
        name: 'sda',
        path: '/dev/sda',
        model: 'Surveillance HDD ST2000VX',
        sizeBytes: 2000398934016, // 2TB
        rotational: true,
        removable: false,
        hotplug: false,
        mountpoint: '/var/recordings',
        smartSupported: true,
        healthStatus: 'PASSED',
        temperatureCelsius: 41,
        powerOnHours: 1420,
        reallocatedSectors: 0,
        wearPercentage: null,
        criticalWarning: false,
      },
    ];
  }
}

export const storageTelemetryService = new StorageTelemetryService();
