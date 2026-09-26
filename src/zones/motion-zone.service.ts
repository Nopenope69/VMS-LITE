/**
 * Motion Zone Service (EXT-02)
 *
 * Manages CRUD operations for spatial motion zones, validates coordinate boundaries
 * strictly without silent clamping, and maintains cache synchronization with SpatialMotionFilter.
 */

import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { spatialMotionFilter as defaultFilter, SpatialMotionFilter } from './spatial-motion-filter.js';
import {
  Point,
  MotionZoneDto,
  CreateMotionZoneRequest,
  UpdateMotionZoneRequest,
  ZoneType,
} from './zone.types.js';

export interface MotionZoneServiceOptions {
  prisma?: any;
  filter?: SpatialMotionFilter;
}

export class MotionZoneService {
  private readonly prisma: any;
  private readonly filter: SpatialMotionFilter;
  private readonly memoryZones = new Map<string, MotionZoneDto>();

  constructor(opts: MotionZoneServiceOptions = {}) {
    this.prisma = opts.prisma || defaultPrisma;
    this.filter = opts.filter || defaultFilter;
  }

  /**
   * Validates polygon vertices strictly.
   * - Must contain between 3 and 32 vertices (T-11-01).
   * - Each coordinate must be normalized: 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0.
   * - Throws descriptive error on violation; NEVER silently clamps coordinates.
   */
  validateCoordinates(coordinates: Point[]): void {
    if (!coordinates || !Array.isArray(coordinates)) {
      throw new Error('Polygon coordinates must be provided as an array of points');
    }

    if (coordinates.length < 3) {
      throw new Error(`Polygon must have at least 3 vertices (received ${coordinates.length})`);
    }

    if (coordinates.length > 32) {
      throw new Error(`Polygon cannot exceed 32 vertices (received ${coordinates.length})`);
    }

    for (let i = 0; i < coordinates.length; i++) {
      const pt = coordinates[i];
      if (
        pt === null ||
        typeof pt !== 'object' ||
        typeof pt.x !== 'number' ||
        isNaN(pt.x) ||
        typeof pt.y !== 'number' ||
        isNaN(pt.y)
      ) {
        throw new Error(`Vertex at index ${i} is not a valid coordinate object: { x: number, y: number }`);
      }

      if (pt.x < 0.0 || pt.x > 1.0 || pt.y < 0.0 || pt.y > 1.0) {
        throw new Error(
          `Vertex at index ${i} has coordinates outside normalized bounds [0.0, 1.0] (received x: ${pt.x}, y: ${pt.y})`
        );
      }
    }
  }

  /**
   * Lists all motion zones for a specific camera.
   */
  async listZones(cameraId: string): Promise<MotionZoneDto[]> {
    try {
      const results = await this.prisma.motionZone.findMany({
        where: { cameraId },
        orderBy: { createdAt: 'asc' },
      });

      const zones = results.map((z: any) => this.mapPrismaZone(z));
      this.filter.setCameraZones(cameraId, zones);
      return zones;
    } catch {
      // In-memory fallback
      const zones = Array.from(this.memoryZones.values())
        .filter((z) => z.cameraId === cameraId)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

      this.filter.setCameraZones(cameraId, zones);
      return zones;
    }
  }

  /**
   * Retrieves a single motion zone by ID.
   */
  async getZone(id: string): Promise<MotionZoneDto | null> {
    try {
      const result = await this.prisma.motionZone.findUnique({
        where: { id },
      });
      return result ? this.mapPrismaZone(result) : null;
    } catch {
      return this.memoryZones.get(id) || null;
    }
  }

  /**
   * Creates a new motion zone for a camera.
   * Updates SpatialMotionFilter cache immediately.
   */
  async createZone(
    cameraId: string,
    req: CreateMotionZoneRequest
  ): Promise<MotionZoneDto> {
    if (!req.name || !req.name.trim()) {
      throw new Error('Zone name is required');
    }

    const zoneType = (req.zoneType || 'INCLUSION').toUpperCase() as ZoneType;
    if (zoneType !== 'INCLUSION' && zoneType !== 'EXCLUSION') {
      throw new Error(`Invalid zone type '${req.zoneType}'. Must be 'INCLUSION' or 'EXCLUSION'`);
    }

    this.validateCoordinates(req.coordinates);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const enabled = req.enabled !== false;
    const color = req.color || (zoneType === 'INCLUSION' ? '#10b981' : '#f43f5e');

    const zoneDto: MotionZoneDto = {
      id,
      cameraId,
      name: req.name.trim(),
      zoneType,
      enabled,
      coordinates: req.coordinates,
      color,
      createdAt: now,
      updatedAt: now,
    };

    this.memoryZones.set(id, zoneDto);

    try {
      const created = await this.prisma.motionZone.create({
        data: {
          id,
          cameraId,
          name: zoneDto.name,
          zoneType,
          enabled,
          coordinates: zoneDto.coordinates as any,
          color,
        },
      });

      const mapped = this.mapPrismaZone(created);
      await this.refreshCameraCache(cameraId);
      return mapped;
    } catch {
      // In-memory fallback
      await this.refreshCameraCache(cameraId);
      return zoneDto;
    }
  }

  /**
   * Updates an existing motion zone.
   * Updates SpatialMotionFilter cache immediately.
   */
  async updateZone(
    id: string,
    req: UpdateMotionZoneRequest
  ): Promise<MotionZoneDto> {
    const existing = await this.getZone(id);
    if (!existing) {
      throw new Error(`Motion zone '${id}' not found`);
    }

    if (req.coordinates) {
      this.validateCoordinates(req.coordinates);
    }

    let zoneType = existing.zoneType;
    if (req.zoneType) {
      const upper = req.zoneType.toUpperCase() as ZoneType;
      if (upper !== 'INCLUSION' && upper !== 'EXCLUSION') {
        throw new Error(`Invalid zone type '${req.zoneType}'. Must be 'INCLUSION' or 'EXCLUSION'`);
      }
      zoneType = upper;
    }

    const updatedDto: MotionZoneDto = {
      ...existing,
      name: req.name !== undefined ? req.name.trim() : existing.name,
      zoneType,
      enabled: req.enabled !== undefined ? req.enabled : existing.enabled,
      coordinates: req.coordinates || existing.coordinates,
      color: req.color !== undefined ? req.color : existing.color,
      updatedAt: new Date().toISOString(),
    };

    this.memoryZones.set(id, updatedDto);

    try {
      const updated = await this.prisma.motionZone.update({
        where: { id },
        data: {
          name: updatedDto.name,
          zoneType: updatedDto.zoneType,
          enabled: updatedDto.enabled,
          coordinates: updatedDto.coordinates as any,
          color: updatedDto.color,
        },
      });

      const mapped = this.mapPrismaZone(updated);
      await this.refreshCameraCache(existing.cameraId);
      return mapped;
    } catch {
      await this.refreshCameraCache(existing.cameraId);
      return updatedDto;
    }
  }

  /**
   * Deletes a motion zone.
   * Updates SpatialMotionFilter cache immediately.
   */
  async deleteZone(id: string): Promise<void> {
    const existing = await this.getZone(id);
    if (!existing) {
      throw new Error(`Motion zone '${id}' not found`);
    }

    this.memoryZones.delete(id);

    try {
      await this.prisma.motionZone.delete({
        where: { id },
      });
    } catch {
      // In-memory fallback
    }

    await this.refreshCameraCache(existing.cameraId);
  }

  /**
   * Refreshes the in-memory cache on the spatial filter for a camera.
   */
  private async refreshCameraCache(cameraId: string): Promise<void> {
    const zones = await this.listZones(cameraId);
    this.filter.setCameraZones(cameraId, zones);
  }

  /**
   * Converts a Prisma MotionZone record into a MotionZoneDto.
   */
  private mapPrismaZone(record: any): MotionZoneDto {
    let coordinates: Point[] = [];
    if (typeof record.coordinates === 'string') {
      try {
        coordinates = JSON.parse(record.coordinates);
      } catch {
        coordinates = [];
      }
    } else if (Array.isArray(record.coordinates)) {
      coordinates = record.coordinates;
    }

    return {
      id: record.id,
      cameraId: record.cameraId,
      name: record.name,
      zoneType: record.zoneType as ZoneType,
      enabled: record.enabled,
      coordinates,
      color: record.color ?? null,
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
      updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
    };
  }
}

export const motionZoneService = new MotionZoneService();
export default motionZoneService;
