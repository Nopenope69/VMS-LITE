import crypto from 'node:crypto';
import { CameraZoneDto, GuardTourDto, CreateTourDto, TourLayoutMode } from './tour.types.js';

export class TourService {
  private zones: Map<string, CameraZoneDto> = new Map();
  private tours: Map<string, GuardTourDto> = new Map();

  constructor() {
    this.seedDefaultData();
  }

  private seedDefaultData() {
    // Seed default sample zones
    const zonePerimeter: CameraZoneDto = {
      id: 'zone-perimeter',
      name: 'Zone 1 - Main Perimeter & Gates',
      description: 'Outer boundary, visitor ingress, and main security barrier',
      cameraIds: ['cam-1', 'cam-3'],
      createdAt: new Date().toISOString(),
    };
    const zoneProduction: CameraZoneDto = {
      id: 'zone-production',
      name: 'Zone 2 - Production & Basement',
      description: 'Internal parking, manufacturing floor, and lobby reception',
      cameraIds: ['cam-2', 'cam-4'],
      createdAt: new Date().toISOString(),
    };
    this.zones.set(zonePerimeter.id, zonePerimeter);
    this.zones.set(zoneProduction.id, zoneProduction);

    // Seed default sample guard tours
    const defaultTour: GuardTourDto = {
      id: 'tour-gate-focus',
      name: 'Gate 1 - Focus & Perimeter Carousel',
      layoutMode: '1+4',
      dwellSeconds: 10,
      heroCameraIds: ['cam-1'],
      carouselPoolIds: ['cam-2', 'cam-3', 'cam-4'],
      alarmOverride: true,
      zoneId: 'zone-perimeter',
      assignedScreen: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const dualHeroTour: GuardTourDto = {
      id: 'tour-dual-hero',
      name: 'Dual Ingress / Egress Command Matrix',
      layoutMode: '2+6',
      dwellSeconds: 15,
      heroCameraIds: ['cam-1', 'cam-2'],
      carouselPoolIds: ['cam-3', 'cam-4'],
      alarmOverride: true,
      zoneId: 'zone-production',
      assignedScreen: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.tours.set(defaultTour.id, defaultTour);
    this.tours.set(dualHeroTour.id, dualHeroTour);
  }

  // ================= CAMERA ZONES =================

  async listZones(): Promise<CameraZoneDto[]> {
    return Array.from(this.zones.values());
  }

  async getZone(id: string): Promise<CameraZoneDto | null> {
    return this.zones.get(id) || null;
  }

  async createZone(data: { name: string; description?: string; cameraIds?: string[] }): Promise<CameraZoneDto> {
    const id = `zone-${crypto.randomUUID().slice(0, 8)}`;
    const zone: CameraZoneDto = {
      id,
      name: data.name,
      description: data.description,
      cameraIds: data.cameraIds || [],
      createdAt: new Date().toISOString(),
    };
    this.zones.set(id, zone);
    return zone;
  }

  async updateZone(id: string, data: Partial<{ name: string; description?: string; cameraIds?: string[] }>): Promise<CameraZoneDto | null> {
    const zone = this.zones.get(id);
    if (!zone) return null;

    if (data.name !== undefined) zone.name = data.name;
    if (data.description !== undefined) zone.description = data.description;
    if (data.cameraIds !== undefined) zone.cameraIds = data.cameraIds;

    this.zones.set(id, zone);
    return zone;
  }

  async deleteZone(id: string): Promise<boolean> {
    return this.zones.delete(id);
  }

  // ================= GUARD TOURS =================

  async listTours(): Promise<GuardTourDto[]> {
    return Array.from(this.tours.values());
  }

  async getTour(id: string): Promise<GuardTourDto | null> {
    return this.tours.get(id) || null;
  }

  async createTour(dto: CreateTourDto): Promise<GuardTourDto> {
    const id = `tour-${crypto.randomUUID().slice(0, 8)}`;
    const tour: GuardTourDto = {
      id,
      name: dto.name,
      layoutMode: dto.layoutMode || '1+4',
      dwellSeconds: dto.dwellSeconds || 10,
      heroCameraIds: dto.heroCameraIds || [],
      carouselPoolIds: dto.carouselPoolIds || [],
      alarmOverride: dto.alarmOverride !== undefined ? dto.alarmOverride : true,
      zoneId: dto.zoneId,
      assignedScreen: dto.assignedScreen || 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tours.set(id, tour);
    return tour;
  }

  async updateTour(id: string, dto: Partial<CreateTourDto>): Promise<GuardTourDto | null> {
    const tour = this.tours.get(id);
    if (!tour) return null;

    if (dto.name !== undefined) tour.name = dto.name;
    if (dto.layoutMode !== undefined) tour.layoutMode = dto.layoutMode;
    if (dto.dwellSeconds !== undefined) tour.dwellSeconds = dto.dwellSeconds;
    if (dto.heroCameraIds !== undefined) tour.heroCameraIds = dto.heroCameraIds;
    if (dto.carouselPoolIds !== undefined) tour.carouselPoolIds = dto.carouselPoolIds;
    if (dto.alarmOverride !== undefined) tour.alarmOverride = dto.alarmOverride;
    if (dto.zoneId !== undefined) tour.zoneId = dto.zoneId;
    if (dto.assignedScreen !== undefined) tour.assignedScreen = dto.assignedScreen;
    tour.updatedAt = new Date().toISOString();

    this.tours.set(id, tour);
    return tour;
  }

  async deleteTour(id: string): Promise<boolean> {
    return this.tours.delete(id);
  }
}

export const tourService = new TourService();
