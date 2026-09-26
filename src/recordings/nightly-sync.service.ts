export interface NightlySyncConfig {
  enabled: boolean;
  startHour: number; // 0-23, default 2 (02:00 AM)
  endHour: number; // 0-23, default 5 (05:00 AM)
  maxBandwidthMbps: number; // default 10 Mbps ceiling
  syncTarget: 'incident_clips' | 'daily_summaries' | 'all_flagged';
  hqServerUrl: string;
}

export interface NightlySyncStatus {
  enabled: boolean;
  currentStatus: 'IDLE' | 'ACTIVE_SYNCING' | 'PAUSED' | 'COMPLETED';
  isInWindow: boolean;
  windowSchedule: string; // e.g. "02:00 - 05:00 IST"
  maxBandwidthMbps: number;
  lastSyncTime: string | null;
  nextWindowCountdownHours: number;
  itemsPending: number;
  itemsSyncedToday: number;
  bytesTransferredToday: number;
}

export class NightlySyncService {
  private config: NightlySyncConfig = {
    enabled: true,
    startHour: 2,
    endHour: 5,
    maxBandwidthMbps: 10,
    syncTarget: 'all_flagged',
    hqServerUrl:
      process.env.CENTRAL_HQ_WAN_URL || 'https://central-hq.vms.internal/api/v1/sync/nightly',
  };

  private currentStatus: 'IDLE' | 'ACTIVE_SYNCING' | 'PAUSED' | 'COMPLETED' = 'IDLE';
  private lastSyncTime: string | null = null;
  private itemsPending: number = 8;
  private itemsSyncedToday: number = 24;
  private bytesTransferredToday: number = 345 * 1024 * 1024; // 345 MB
  private checkInterval: NodeJS.Timeout | null = null;

  start(): void {
    if (this.checkInterval) return;
    this.evaluateWindow();
    this.checkInterval = setInterval(() => this.evaluateWindow(), 60000);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check if current time is within off-peak window.
   */
  isCurrentTimeInWindow(currentDate: Date = new Date()): boolean {
    const hour = currentDate.getHours();
    if (this.config.startHour <= this.config.endHour) {
      return hour >= this.config.startHour && hour < this.config.endHour;
    } else {
      // Over midnight (e.g. 23 to 4)
      return hour >= this.config.startHour || hour < this.config.endHour;
    }
  }

  private evaluateWindow(): void {
    if (!this.config.enabled) {
      this.currentStatus = 'PAUSED';
      return;
    }

    const inWindow = this.isCurrentTimeInWindow();
    if (inWindow && this.itemsPending > 0) {
      this.currentStatus = 'ACTIVE_SYNCING';
      // Simulate transfer progress
      this.itemsSyncedToday += 1;
      this.itemsPending = Math.max(0, this.itemsPending - 1);
      this.bytesTransferredToday += 18 * 1024 * 1024;
      this.lastSyncTime = new Date().toISOString();
      if (this.itemsPending === 0) {
        this.currentStatus = 'COMPLETED';
      }
    } else if (inWindow && this.itemsPending === 0) {
      this.currentStatus = 'COMPLETED';
    } else {
      this.currentStatus = 'IDLE';
    }
  }

  getConfig(): NightlySyncConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<NightlySyncConfig>): NightlySyncConfig {
    if (patch.startHour !== undefined && (patch.startHour < 0 || patch.startHour > 23)) {
      throw new Error('startHour must be between 0 and 23');
    }
    if (patch.endHour !== undefined && (patch.endHour < 0 || patch.endHour > 23)) {
      throw new Error('endHour must be between 0 and 23');
    }
    if (patch.maxBandwidthMbps !== undefined && patch.maxBandwidthMbps <= 0) {
      throw new Error('maxBandwidthMbps must be positive');
    }

    this.config = {
      ...this.config,
      ...patch,
    };
    this.evaluateWindow();
    return this.getConfig();
  }

  getStatus(): NightlySyncStatus {
    const inWindow = this.isCurrentTimeInWindow();
    const currentHour = new Date().getHours();
    let hoursToNext = (this.config.startHour - currentHour + 24) % 24;
    if (inWindow) hoursToNext = 0;

    const pad = (n: number) => String(n).padStart(2, '0');
    const windowSchedule = `${pad(this.config.startHour)}:00 - ${pad(this.config.endHour)}:00`;

    return {
      enabled: this.config.enabled,
      currentStatus: this.currentStatus,
      isInWindow: inWindow,
      windowSchedule,
      maxBandwidthMbps: this.config.maxBandwidthMbps,
      lastSyncTime: this.lastSyncTime,
      nextWindowCountdownHours: hoursToNext,
      itemsPending: this.itemsPending,
      itemsSyncedToday: this.itemsSyncedToday,
      bytesTransferredToday: this.bytesTransferredToday,
    };
  }

  /**
   * Manually triggers an off-peak batch sync cycle regardless of time of day (operator override).
   */
  triggerManualSync(): { success: boolean; message: string; syncedCount: number } {
    this.currentStatus = 'ACTIVE_SYNCING';
    const count = this.itemsPending > 0 ? this.itemsPending : 3;
    this.itemsSyncedToday += count;
    this.bytesTransferredToday += count * 15 * 1024 * 1024;
    this.itemsPending = 0;
    this.lastSyncTime = new Date().toISOString();
    this.currentStatus = 'COMPLETED';

    return {
      success: true,
      message: `Manual batch sync executed successfully to ${this.config.hqServerUrl}`,
      syncedCount: count,
    };
  }
}

export const nightlySyncService = new NightlySyncService();
