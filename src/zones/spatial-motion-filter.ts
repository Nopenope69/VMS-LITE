/**
 * Spatial Motion Filter (EXT-02)
 *
 * Implements Ray-Casting Point-in-Polygon geometric algorithm,
 * formalized multi-zone truth table, ONVIF cell centroid approximation,
 * and dynamic per-camera in-memory zone caching (zero listener restarts).
 */

import { Point, MotionZoneDto, SpatialEvaluationResult } from './zone.types.js';

/**
 * Evaluates whether a 2D point (x, y) lies inside a polygon using the
 * Jordan Curve theorem Ray-Casting algorithm.
 *
 * All coordinates must be normalized floats in [0.0, 1.0].
 * Sub-millisecond computational complexity: O(N) where N = number of vertices.
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  if (!polygon || polygon.length < 3) {
    return false;
  }

  let inside = false;
  const { x, y } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

export class SpatialMotionFilter {
  // In-memory per-camera zone cache to evaluate incoming ONVIF events with zero DB overhead
  private cameraZonesCache = new Map<string, MotionZoneDto[]>();

  /**
   * Updates or invalidates the cached zones for a camera.
   * Changes take effect immediately on subsequent ONVIF events without restarting the listener.
   */
  setCameraZones(cameraId: string, zones: MotionZoneDto[]): void {
    this.cameraZonesCache.set(cameraId, zones);
  }

  /**
   * Retrieves cached zones for a camera, or empty array if none cached.
   */
  getCameraZones(cameraId: string): MotionZoneDto[] {
    return this.cameraZonesCache.get(cameraId) || [];
  }

  /**
   * Clears the cache for a specific camera or all cameras.
   */
  clearCache(cameraId?: string): void {
    if (cameraId) {
      this.cameraZonesCache.delete(cameraId);
    } else {
      this.cameraZonesCache.clear();
    }
  }

  /**
   * Evaluates a single normalized coordinate point against a list of zones.
   *
   * Formalized Multi-Zone Truth Table:
   * 1. Exclusion Hit -> DROP (Exclusion always takes strict precedence)
   * 2. No Exclusion Hit + No Inclusions Configured -> PASS (Full frame active)
   * 3. No Exclusion Hit + Inclusions Configured:
   *    - Hits at least one Inclusion -> PASS
   *    - Hits zero Inclusions -> DROP
   */
  evaluateMotionPoint(point: Point, zones: MotionZoneDto[]): SpatialEvaluationResult {
    const activeZones = zones.filter((z) => z.enabled);
    if (activeZones.length === 0) {
      return {
        allowed: true,
        reason: 'No enabled zones configured; full frame active',
      };
    }

    const exclusionZones = activeZones.filter((z) => z.zoneType === 'EXCLUSION');
    const inclusionZones = activeZones.filter((z) => z.zoneType === 'INCLUSION');

    // 1. Exclusion check (wins immediately)
    const matchedExclusions: string[] = [];
    for (const zone of exclusionZones) {
      if (isPointInPolygon(point, zone.coordinates)) {
        matchedExclusions.push(zone.name);
      }
    }

    if (matchedExclusions.length > 0) {
      return {
        allowed: false,
        matchedExclusion: matchedExclusions,
        reason: `Matched exclusion zone(s): ${matchedExclusions.join(', ')}`,
      };
    }

    // 2. Inclusion check (if no inclusions configured, full frame is active)
    if (inclusionZones.length === 0) {
      return {
        allowed: true,
        reason: 'No inclusion zones configured; full frame active',
      };
    }

    const matchedInclusions: string[] = [];
    for (const zone of inclusionZones) {
      if (isPointInPolygon(point, zone.coordinates)) {
        matchedInclusions.push(zone.name);
      }
    }

    if (matchedInclusions.length > 0) {
      return {
        allowed: true,
        matchedInclusion: matchedInclusions,
        reason: `Matched inclusion zone(s): ${matchedInclusions.join(', ')}`,
      };
    }

    return {
      allowed: false,
      reason: 'Outside all configured inclusion zones',
    };
  }

  /**
   * Evaluates ONVIF CellMotionDetector active cells.
   *
   * Architectural Contract:
   * "Grid-based ONVIF motion is evaluated using the normalized centroid of each active cell.
   * Zone filtering therefore operates at ONVIF event-grid resolution, not pixel/object resolution."
   */
  evaluateCellGrid(
    activeCells: Array<{ col: number; row: number }>,
    totalCols: number,
    totalRows: number,
    zones: MotionZoneDto[]
  ): SpatialEvaluationResult {
    if (!activeCells || activeCells.length === 0) {
      return {
        allowed: false,
        reason: 'No active cells in event grid',
      };
    }

    if (totalCols <= 0 || totalRows <= 0) {
      return {
        allowed: true,
        reason: 'Invalid grid dimensions; defaulting to pass',
      };
    }

    const passedInclusions = new Set<string>();
    const blockedExclusions = new Set<string>();
    let anyCellAllowed = false;

    for (const cell of activeCells) {
      const centroid: Point = {
        x: (cell.col + 0.5) / totalCols,
        y: (cell.row + 0.5) / totalRows,
      };

      const result = this.evaluateMotionPoint(centroid, zones);
      if (result.allowed) {
        anyCellAllowed = true;
        if (result.matchedInclusion) {
          result.matchedInclusion.forEach((name) => passedInclusions.add(name));
        }
      } else {
        if (result.matchedExclusion) {
          result.matchedExclusion.forEach((name) => blockedExclusions.add(name));
        }
      }
    }

    if (anyCellAllowed) {
      return {
        allowed: true,
        matchedInclusion: Array.from(passedInclusions),
        reason: 'At least one active cell centroid passed spatial filtering',
      };
    }

    return {
      allowed: false,
      matchedExclusion: Array.from(blockedExclusions),
      reason: blockedExclusions.size > 0
        ? `All active cell centroids fell within exclusion zone(s): ${Array.from(blockedExclusions).join(', ')}`
        : 'All active cell centroids fell outside configured inclusion zones',
    };
  }
}

export const spatialMotionFilter = new SpatialMotionFilter();
export default spatialMotionFilter;
