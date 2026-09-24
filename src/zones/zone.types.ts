/**
 * Motion Zones & Spatial Exclusion Masking Types (EXT-02)
 * Pure computational geometry types and DTOs.
 */

export interface Point {
  x: number;
  y: number;
}

export type Polygon = Point[];

export type ZoneType = 'INCLUSION' | 'EXCLUSION';

export interface MotionZoneDto {
  id: string;
  cameraId: string;
  name: string;
  zoneType: ZoneType;
  enabled: boolean;
  coordinates: Point[];
  color?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateMotionZoneRequest {
  name: string;
  zoneType: ZoneType;
  coordinates: Point[];
  enabled?: boolean;
  color?: string;
}

export interface UpdateMotionZoneRequest {
  name?: string;
  zoneType?: ZoneType;
  coordinates?: Point[];
  enabled?: boolean;
  color?: string;
}

export interface SpatialEvaluationResult {
  allowed: boolean;
  matchedInclusion?: string[];
  matchedExclusion?: string[];
  reason?: string;
}

export interface TestPointRequest {
  x: number;
  y: number;
}
