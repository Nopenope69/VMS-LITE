import crypto from 'node:crypto';
import {
  CameraMapMarker,
  CreateFloorPlanInput,
  FloorPlanDto,
  UpdateFloorPlanInput,
} from './emap.types.js';

export class EMapService {
  private readonly plans = new Map<string, FloorPlanDto>();

  constructor() {
    this.seedDefaultPlans();
  }

  private seedDefaultPlans(): void {
    const defaultPlan: FloorPlanDto = {
      id: 'default-facility-map',
      name: 'Main Facility & Perimeter Layout',
      description: 'Factory floor, warehouse bays, dispatch gate, and perimeter security',
      imageUrl: '/assets/floorplan-default.svg',
      widthMeters: 120,
      heightMeters: 80,
      markers: [
        {
          cameraId: 'default-cam-1',
          cameraName: 'Main Entrance & Boom Barrier',
          x: 18.5,
          y: 78.2,
          angle: 45,
          fovDegrees: 85,
        },
        {
          cameraId: 'default-cam-2',
          cameraName: 'Dispatch Bay & Loading Dock',
          x: 42.0,
          y: 50.0,
          angle: 180,
          fovDegrees: 90,
        },
        {
          cameraId: 'default-cam-3',
          cameraName: 'Finished Goods Warehouse',
          x: 75.5,
          y: 35.0,
          angle: 270,
          fovDegrees: 80,
        },
        {
          cameraId: 'default-cam-4',
          cameraName: 'Rear Perimeter Fence North',
          x: 88.0,
          y: 12.0,
          angle: 215,
          fovDegrees: 95,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.plans.set(defaultPlan.id, defaultPlan);
  }

  listFloorPlans(): FloorPlanDto[] {
    return Array.from(this.plans.values());
  }

  getFloorPlan(id: string): FloorPlanDto | null {
    return this.plans.get(id) || null;
  }

  createFloorPlan(input: CreateFloorPlanInput): FloorPlanDto {
    const id = `plan-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();

    const plan: FloorPlanDto = {
      id,
      name: input.name,
      description: input.description,
      imageUrl: input.imageUrl || '/assets/floorplan-default.svg',
      widthMeters: input.widthMeters || 100,
      heightMeters: input.heightMeters || 60,
      markers: input.markers || [],
      createdAt: now,
      updatedAt: now,
    };

    this.plans.set(id, plan);
    return plan;
  }

  updateFloorPlan(id: string, input: UpdateFloorPlanInput): FloorPlanDto | null {
    const existing = this.plans.get(id);
    if (!existing) return null;

    const updated: FloorPlanDto = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      imageUrl: input.imageUrl ?? existing.imageUrl,
      widthMeters: input.widthMeters ?? existing.widthMeters,
      heightMeters: input.heightMeters ?? existing.heightMeters,
      markers: input.markers ?? existing.markers,
      updatedAt: new Date().toISOString(),
    };

    this.plans.set(id, updated);
    return updated;
  }

  updateMarkers(id: string, markers: CameraMapMarker[]): FloorPlanDto | null {
    const existing = this.plans.get(id);
    if (!existing) return null;

    existing.markers = markers;
    existing.updatedAt = new Date().toISOString();
    this.plans.set(id, existing);
    return existing;
  }

  deleteFloorPlan(id: string): boolean {
    return this.plans.delete(id);
  }
}

export const emapService = new EMapService();
export default emapService;
