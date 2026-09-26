import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { isPointInPolygon, spatialMotionFilter } from '../src/zones/spatial-motion-filter.js';
import { motionZoneService } from '../src/zones/motion-zone.service.js';
import { onvifEventListenerService } from '../src/events/onvif-events.service.js';
import { eventBus } from '../src/events/event-bus.js';
import { CoreEventType } from '../src/events/event.types.js';
import { Point, MotionZoneDto } from '../src/zones/zone.types.js';

describe('Motion Zones & Spatial Exclusion Masking (Phase 11 - EXT-02)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;

  const testCameraId = '00000000-0000-4000-8000-000000000101';

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-uuid',
      username: 'admin',
      role: Role.ADMIN,
    });

    operatorToken = app.jwt.sign({
      id: 'op-uuid',
      username: 'operator',
      role: Role.OPERATOR,
    });

    viewerToken = app.jwt.sign({
      id: 'viewer-uuid',
      username: 'viewer',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Ray-Casting Point-in-Polygon Algorithm', () => {
    it('accurately evaluates points inside and outside a convex square', () => {
      // 0.2 to 0.8 square
      const square: Point[] = [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 },
      ];

      // Interior center point
      expect(isPointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);

      // Exterior points
      expect(isPointInPolygon({ x: 0.1, y: 0.5 }, square)).toBe(false);
      expect(isPointInPolygon({ x: 0.9, y: 0.5 }, square)).toBe(false);
      expect(isPointInPolygon({ x: 0.5, y: 0.1 }, square)).toBe(false);
      expect(isPointInPolygon({ x: 0.5, y: 0.9 }, square)).toBe(false);
    });

    it('accurately evaluates points inside and outside a concave L-shape polygon', () => {
      // L-shape with an inner notch at (0.5, 0.5) to (1.0, 1.0)
      const lShape: Point[] = [
        { x: 0.0, y: 0.0 },
        { x: 1.0, y: 0.0 },
        { x: 1.0, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 1.0 },
        { x: 0.0, y: 1.0 },
      ];

      // Interior to bottom-horizontal arm
      expect(isPointInPolygon({ x: 0.75, y: 0.25 }, lShape)).toBe(true);

      // Interior to left-vertical arm
      expect(isPointInPolygon({ x: 0.25, y: 0.75 }, lShape)).toBe(true);

      // Exterior cut-out notch (which convex hull would falsely match)
      expect(isPointInPolygon({ x: 0.75, y: 0.75 }, lShape)).toBe(false);

      // Far outside
      expect(isPointInPolygon({ x: 1.2, y: 1.2 }, lShape)).toBe(false);
    });

    it('returns false for degenerate polygons with fewer than 3 vertices', () => {
      expect(isPointInPolygon({ x: 0.5, y: 0.5 }, [])).toBe(false);
      expect(isPointInPolygon({ x: 0.5, y: 0.5 }, [{ x: 0.1, y: 0.1 }])).toBe(false);
      expect(isPointInPolygon({ x: 0.5, y: 0.5 }, [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }])).toBe(false);
    });
  });

  describe('2. Capability Gating', () => {
    it('returns 403 Forbidden when extended.motion_zones capability is absent', async () => {
      vi.spyOn(app.capabilities, 'has').mockReturnValue(false);

      const res = await app.inject({
        method: 'GET',
        url: `/api/cameras/${testCameraId}/zones`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.capability).toBe('extended.motion_zones');
    });
  });

  describe('3. Single-Site RBAC Enforcements', () => {
    beforeEach(() => {
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => cap === 'extended.motion_zones');
    });

    it('allows Viewer and Operator to read zones and test points', async () => {
      const getViewer = await app.inject({
        method: 'GET',
        url: `/api/cameras/${testCameraId}/zones`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(getViewer.statusCode).toBe(200);

      const testOp = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/zones/test`,
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { x: 0.5, y: 0.5 },
      });
      expect(testOp.statusCode).toBe(200);
      expect(testOp.json().success).toBe(true);
    });

    it('rejects Operator and Viewer from mutating zones with 403', async () => {
      const validPayload = {
        name: 'Driveway',
        zoneType: 'INCLUSION',
        coordinates: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      };

      // Viewer cannot create
      const createViewer = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/zones`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: validPayload,
      });
      expect(createViewer.statusCode).toBe(403);

      // Operator cannot create
      const createOp = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/zones`,
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: validPayload,
      });
      expect(createOp.statusCode).toBe(403);

      // Operator cannot delete
      const delOp = await app.inject({
        method: 'DELETE',
        url: `/api/cameras/${testCameraId}/zones/any-id`,
        headers: { authorization: `Bearer ${operatorToken}` },
      });
      expect(delOp.statusCode).toBe(403);
    });
  });

  describe('4. Strict Vertex Bounds & Coordinate Rejection (No Silent Clamping)', () => {
    beforeEach(() => {
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => cap === 'extended.motion_zones');
    });

    it('rejects polygons with fewer than 3 vertices with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/zones`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Invalid Segment',
          zoneType: 'INCLUSION',
          coordinates: [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.9 },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Invalid motion zone parameters');
    });

    it('rejects polygons with more than 32 vertices with 400 Bad Request (T-11-01)', async () => {
      const excessiveVertices = Array.from({ length: 33 }, (_, i) => ({
        x: Number((i / 40).toFixed(4)),
        y: Number((i / 40).toFixed(4)),
      }));

      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/zones`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Too Many Vertices',
          zoneType: 'INCLUSION',
          coordinates: excessiveVertices,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('strictly rejects negative coordinates without silent clamping', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/zones`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Negative Coord Zone',
          zoneType: 'EXCLUSION',
          coordinates: [
            { x: -0.05, y: 0.1 },
            { x: 0.8, y: 0.1 },
            { x: 0.8, y: 0.8 },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(JSON.stringify(body)).toContain('X coordinate must be >= 0.0');
    });

    it('strictly rejects coordinates > 1.0 without silent clamping', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/zones`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Oversized Coord Zone',
          zoneType: 'EXCLUSION',
          coordinates: [
            { x: 0.1, y: 0.1 },
            { x: 1.05, y: 0.1 },
            { x: 0.8, y: 0.8 },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(JSON.stringify(body)).toContain('X coordinate must be <= 1.0');
    });

    it('rejects invalid test points outside [0.0, 1.0]', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cameras/${testCameraId}/zones/test`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { x: 1.5, y: 0.5 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('5. Formalized Multi-Zone Truth Table Evaluation', () => {
    const inclusionZoneA: MotionZoneDto = {
      id: 'inc-1',
      cameraId: testCameraId,
      name: 'Doorway',
      zoneType: 'INCLUSION',
      enabled: true,
      coordinates: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.1 },
        { x: 0.5, y: 0.5 },
        { x: 0.1, y: 0.5 },
      ],
    };

    const exclusionZoneB: MotionZoneDto = {
      id: 'exc-1',
      cameraId: testCameraId,
      name: 'Swaying Tree',
      zoneType: 'EXCLUSION',
      enabled: true,
      coordinates: [
        { x: 0.4, y: 0.4 },
        { x: 0.8, y: 0.4 },
        { x: 0.8, y: 0.8 },
        { x: 0.4, y: 0.8 },
      ],
    };

    it('Row 4: No Exclusion Hit + No Inclusion Configured -> PASS (full frame active)', () => {
      const res = spatialMotionFilter.evaluateMotionPoint({ x: 0.25, y: 0.25 }, []);
      expect(res.allowed).toBe(true);
      expect(res.reason).toContain('full frame active');
    });

    it('Row 1: Exclusion Hit + No Inclusion Configured -> DROP', () => {
      const res = spatialMotionFilter.evaluateMotionPoint(
        { x: 0.6, y: 0.6 },
        [exclusionZoneB]
      );
      expect(res.allowed).toBe(false);
      expect(res.matchedExclusion).toEqual(['Swaying Tree']);
    });

    it('Row 5: No Exclusion Hit + Inclusion Configured + No Inclusion Hit -> DROP', () => {
      const res = spatialMotionFilter.evaluateMotionPoint(
        { x: 0.9, y: 0.9 }, // completely outside doorway
        [inclusionZoneA]
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain('Outside all configured inclusion zones');
    });

    it('Row 6: No Exclusion Hit + Inclusion Configured + Inclusion Hit -> PASS', () => {
      const res = spatialMotionFilter.evaluateMotionPoint(
        { x: 0.2, y: 0.2 }, // inside doorway, outside tree
        [inclusionZoneA, exclusionZoneB]
      );
      expect(res.allowed).toBe(true);
      expect(res.matchedInclusion).toEqual(['Doorway']);
    });

    it('Row 3: Exclusion Hit + Inclusion Configured + Inclusion Hit -> DROP (Exclusion strictly wins)', () => {
      // Overlap point (0.45, 0.45) is inside BOTH doorway and tree
      const res = spatialMotionFilter.evaluateMotionPoint(
        { x: 0.45, y: 0.45 },
        [inclusionZoneA, exclusionZoneB]
      );
      expect(res.allowed).toBe(false);
      expect(res.matchedExclusion).toEqual(['Swaying Tree']);
    });

    it('Row 2: Exclusion Hit + Inclusion Configured + No Inclusion Hit -> DROP', () => {
      // Point (0.6, 0.6) is inside tree but not doorway
      const res = spatialMotionFilter.evaluateMotionPoint(
        { x: 0.6, y: 0.6 },
        [inclusionZoneA, exclusionZoneB]
      );
      expect(res.allowed).toBe(false);
      expect(res.matchedExclusion).toEqual(['Swaying Tree']);
    });
  });

  describe('6. ONVIF Event Grid Centroid Evaluation', () => {
    it('evaluates active grid cells using normalized centroids', () => {
      const zone: MotionZoneDto = {
        id: 'inc-quad',
        cameraId: testCameraId,
        name: 'TopLeftQuadrant',
        zoneType: 'INCLUSION',
        enabled: true,
        coordinates: [
          { x: 0.0, y: 0.0 },
          { x: 0.5, y: 0.0 },
          { x: 0.5, y: 0.5 },
          { x: 0.0, y: 0.5 },
        ],
      };

      // 4x4 grid: col 0, row 0 centroid is (0.125, 0.125) -> inside TopLeftQuadrant
      const hitRes = spatialMotionFilter.evaluateCellGrid(
        [{ col: 0, row: 0 }],
        4,
        4,
        [zone]
      );
      expect(hitRes.allowed).toBe(true);
      expect(hitRes.matchedInclusion).toEqual(['TopLeftQuadrant']);

      // col 3, row 3 centroid is (0.875, 0.875) -> outside
      const missRes = spatialMotionFilter.evaluateCellGrid(
        [{ col: 3, row: 3 }],
        4,
        4,
        [zone]
      );
      expect(missRes.allowed).toBe(false);
    });
  });

  describe('7. Dynamic Cache Synchronization (Zero Listener Restarts)', () => {
    it('updates spatial filter cache immediately upon zone CRUD', async () => {
      vi.spyOn(app.capabilities, 'has').mockImplementation((cap: string) => cap === 'extended.motion_zones');

      // Create zone via service
      const zone = await motionZoneService.createZone(testCameraId, {
        name: 'Dynamic Gate',
        zoneType: 'INCLUSION',
        coordinates: [
          { x: 0.3, y: 0.3 },
          { x: 0.7, y: 0.3 },
          { x: 0.7, y: 0.7 },
          { x: 0.3, y: 0.7 },
        ],
      });

      // SpatialMotionFilter cache must immediately contain the created zone
      const cached = spatialMotionFilter.getCameraZones(testCameraId);
      expect(cached.some((z) => z.id === zone.id)).toBe(true);

      // Subsequent point test immediately reflects new zone
      const res = spatialMotionFilter.evaluateMotionPoint({ x: 0.5, y: 0.5 }, cached);
      expect(res.allowed).toBe(true);

      // Clean up
      await motionZoneService.deleteZone(zone.id);
      const cachedAfterDel = spatialMotionFilter.getCameraZones(testCameraId);
      expect(cachedAfterDel.some((z) => z.id === zone.id)).toBe(false);
    });
  });

  describe('8. ONVIF Motion Event Interception & Suppression', () => {
    it('suppresses events inside exclusion zones and passes events inside inclusion zones', async () => {
      // Setup camera subscription in OnvifEventListenerService
      await onvifEventListenerService.subscribeCamera({
        id: testCameraId,
        name: 'Gate Cam',
        ip: '192.168.1.50',
      });

      // Configure exclusion zone on tree (0.6 - 0.9)
      const treeZone: MotionZoneDto = {
        id: 'tree-zone',
        cameraId: testCameraId,
        name: 'Roadway',
        zoneType: 'EXCLUSION',
        enabled: true,
        coordinates: [
          { x: 0.6, y: 0.6 },
          { x: 0.9, y: 0.6 },
          { x: 0.9, y: 0.9 },
          { x: 0.6, y: 0.9 },
        ],
      };
      spatialMotionFilter.setCameraZones(testCameraId, [treeZone]);

      const emittedEvents: any[] = [];
      const unsub = eventBus.subscribe(CoreEventType.MOTION_DETECTED, (evt) => {
        if (evt.cameraId === testCameraId) {
          emittedEvents.push(evt);
        }
      });

      // 1. Trigger motion inside Roadway exclusion zone (0.7, 0.7) -> Must be DROP/suppressed
      await onvifEventListenerService.triggerMockMotion(testCameraId, {
        X: '0.75',
        Y: '0.75',
      });
      expect(emittedEvents.length).toBe(0);

      // 2. Trigger motion outside Roadway exclusion zone (0.2, 0.2) -> Must PASS
      await onvifEventListenerService.triggerMockMotion(testCameraId, {
        X: '0.2',
        Y: '0.2',
      });
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].metadata.spatialFiltered).toBe(true);

      // 3. Trigger legacy coarse motion without spatial metadata -> Must PASS with spatialVerified: false
      await onvifEventListenerService.triggerMockMotion(testCameraId, {});
      expect(emittedEvents.length).toBe(2);
      expect(emittedEvents[1].metadata.spatialVerified).toBe(false);

      unsub();
      onvifEventListenerService.unsubscribeCamera(testCameraId);
    });
  });
});
