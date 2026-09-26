import crypto from 'node:crypto';
import { DisplayStationDto, PairStationDto, KioskDisplayMode } from './kiosk.types.js';

interface PendingPairing {
  code: string;
  stationKey: string;
  createdAt: number;
}

export class KioskService {
  private stations: Map<string, DisplayStationDto> = new Map();
  private stationsByKey: Map<string, DisplayStationDto> = new Map();
  private pendingPairings: Map<string, PendingPairing> = new Map();

  constructor() {
    this.seedDefaultStation();
  }

  private seedDefaultStation() {
    const defaultStation: DisplayStationDto = {
      id: 'station-guard-tv1',
      stationKey: 'kiosk-sec-token-guard-tv1-auto',
      name: 'Guard Cabin - Main Wall TV 1',
      pairingCode: null,
      assignedTourId: 'tour-gate-focus',
      mode: 'DEDICATED',
      isOnline: true,
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.stations.set(defaultStation.id, defaultStation);
    this.stationsByKey.set(defaultStation.stationKey, defaultStation);
  }

  /**
   * Generates a temporary 4-digit numeric pairing code for an unpaired TV screen.
   */
  generatePairingCode(): { code: string; stationKey: string; expiresInSeconds: number } {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const stationKey = `kiosk-${crypto.randomBytes(16).toString('hex')}`;

    this.pendingPairings.set(code, {
      code,
      stationKey,
      createdAt: Date.now(),
    });

    return {
      code,
      stationKey,
      expiresInSeconds: 600, // 10 minutes
    };
  }

  /**
   * Pairs a display station using the 4-digit code displayed on the TV.
   */
  pairStation(dto: PairStationDto): DisplayStationDto | null {
    const pending = this.pendingPairings.get(dto.pairingCode);
    if (!pending) return null;

    // Check expiration (10 min)
    if (Date.now() - pending.createdAt > 600000) {
      this.pendingPairings.delete(dto.pairingCode);
      return null;
    }

    const id = `station-${crypto.randomUUID().slice(0, 8)}`;
    const station: DisplayStationDto = {
      id,
      stationKey: pending.stationKey,
      name: dto.name || `Wall Display ${this.stations.size + 1}`,
      pairingCode: null,
      assignedTourId: dto.assignedTourId || 'tour-gate-focus',
      mode: dto.mode || 'DEDICATED',
      isOnline: true,
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    this.stations.set(id, station);
    this.stationsByKey.set(station.stationKey, station);
    this.pendingPairings.delete(dto.pairingCode);

    return station;
  }

  /**
   * Authenticates a TV kiosk via its permanent station token.
   */
  getStationByKey(stationKey: string): DisplayStationDto | null {
    const station = this.stationsByKey.get(stationKey);
    if (station) {
      station.isOnline = true;
      station.lastHeartbeat = new Date().toISOString();
      return station;
    }
    return null;
  }

  /**
   * Updates last heartbeat from active TV kiosk.
   */
  heartbeat(stationKey: string): boolean {
    const station = this.stationsByKey.get(stationKey);
    if (station) {
      station.isOnline = true;
      station.lastHeartbeat = new Date().toISOString();
      return true;
    }
    return false;
  }

  listStations(): DisplayStationDto[] {
    const now = Date.now();
    // Auto-mark offline if no heartbeat within 45s
    for (const station of this.stations.values()) {
      const last = new Date(station.lastHeartbeat).getTime();
      station.isOnline = now - last < 45000;
    }
    return Array.from(this.stations.values());
  }

  updateStation(
    id: string,
    data: Partial<{ name: string; assignedTourId: string; mode: KioskDisplayMode }>
  ): DisplayStationDto | null {
    const station = this.stations.get(id);
    if (!station) return null;

    if (data.name !== undefined) station.name = data.name;
    if (data.assignedTourId !== undefined) station.assignedTourId = data.assignedTourId;
    if (data.mode !== undefined) station.mode = data.mode;

    return station;
  }

  deleteStation(id: string): boolean {
    const station = this.stations.get(id);
    if (!station) return false;

    this.stationsByKey.delete(station.stationKey);
    return this.stations.delete(id);
  }
}

export const kioskService = new KioskService();
