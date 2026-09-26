import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { VmsLocation, VmsZone, LocationConfigData } from './location.types.js';

const DEFAULT_CONFIG: LocationConfigData = {
  locations: [
    {
      id: 'delhi',
      name: 'Delhi Logistics Hub',
      code: 'DEL-01',
      icon: '🏢',
      cameraIds: [],
      isDefault: true,
    },
    {
      id: 'mumbai',
      name: 'Mumbai Corporate HQ',
      code: 'MUM-01',
      icon: '🏙️',
      cameraIds: [],
      isDefault: true,
    },
    {
      id: 'pune',
      name: 'Pune Manufacturing Plant',
      code: 'PUN-01',
      icon: '🏭',
      cameraIds: [],
      isDefault: true,
    },
    {
      id: 'bengaluru',
      name: 'Bengaluru Tech Center',
      code: 'BLR-01',
      icon: '💻',
      cameraIds: [],
      isDefault: true,
    },
  ],
  zones: [
    {
      id: 'entrance',
      name: 'Gates & Main Entrance',
      color: '#4fc3f7',
      icon: '🚪',
      cameraIds: [],
    },
    {
      id: 'production',
      name: 'Production Floor',
      color: '#10b981',
      icon: '⚙️',
      cameraIds: [],
    },
    {
      id: 'dispatch',
      name: 'Warehouse & Dispatch',
      color: '#fb923c',
      icon: '🏭',
      cameraIds: [],
    },
    {
      id: 'perimeter',
      name: 'Perimeter & Fences',
      color: '#a78bfa',
      icon: '🛡️',
      cameraIds: [],
    },
  ],
};

export class LocationService {
  private filePath: string;
  private data: LocationConfigData;

  constructor(customPath?: string) {
    this.filePath = customPath || path.resolve(process.cwd(), 'data', 'locations-config.json');
    this.data = this.load();
  }

  private load(): LocationConfigData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.locations) && Array.isArray(parsed.zones)) {
          return parsed;
        }
      }
    } catch {}
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {}
  }

  // Locations CRUD
  getLocations(): VmsLocation[] {
    return [...this.data.locations];
  }

  getLocationById(id: string): VmsLocation | undefined {
    return this.data.locations.find((l) => l.id === id);
  }

  createLocation(input: Omit<VmsLocation, 'id'>): VmsLocation {
    const id = `loc-${crypto.randomUUID().slice(0, 8)}`;
    const newLoc: VmsLocation = {
      id,
      name: input.name.trim(),
      code: (input.code || id).trim().toUpperCase(),
      icon: input.icon || '🏢',
      cameraIds: input.cameraIds || [],
      isDefault: false,
    };
    this.data.locations.push(newLoc);
    this.save();
    return newLoc;
  }

  updateLocation(id: string, patch: Partial<VmsLocation>): VmsLocation {
    const idx = this.data.locations.findIndex((l) => l.id === id);
    if (idx === -1) {
      throw new Error(`Location with ID '${id}' not found`);
    }
    const current = this.data.locations[idx];
    const updated: VmsLocation = {
      ...current,
      ...patch,
      id: current.id, // Immutable ID
    };
    this.data.locations[idx] = updated;
    this.save();
    return updated;
  }

  deleteLocation(id: string): boolean {
    const initLen = this.data.locations.length;
    this.data.locations = this.data.locations.filter((l) => l.id !== id);
    if (this.data.locations.length !== initLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Zones CRUD
  getZones(): VmsZone[] {
    return [...this.data.zones];
  }

  getZoneById(id: string): VmsZone | undefined {
    return this.data.zones.find((z) => z.id === id);
  }

  createZone(input: Omit<VmsZone, 'id'>): VmsZone {
    const id = `zone-${crypto.randomUUID().slice(0, 8)}`;
    const newZone: VmsZone = {
      id,
      name: input.name.trim(),
      color: input.color || '#4fc3f7',
      icon: input.icon || '🛡️',
      cameraIds: input.cameraIds || [],
    };
    this.data.zones.push(newZone);
    this.save();
    return newZone;
  }

  updateZone(id: string, patch: Partial<VmsZone>): VmsZone {
    const idx = this.data.zones.findIndex((z) => z.id === id);
    if (idx === -1) {
      throw new Error(`Zone with ID '${id}' not found`);
    }
    const current = this.data.zones[idx];
    const updated: VmsZone = {
      ...current,
      ...patch,
      id: current.id,
    };
    this.data.zones[idx] = updated;
    this.save();
    return updated;
  }

  deleteZone(id: string): boolean {
    const initLen = this.data.zones.length;
    this.data.zones = this.data.zones.filter((z) => z.id !== id);
    if (this.data.zones.length !== initLen) {
      this.save();
      return true;
    }
    return false;
  }

  resetToDefaults(): LocationConfigData {
    this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.save();
    return this.data;
  }
}

export const locationService = new LocationService();
