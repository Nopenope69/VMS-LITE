import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';

describe('Guard Tour & Camera Zoning API (/api/tours, /api/camera-zones)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-1',
      username: 'admin',
      role: Role.ADMIN,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Camera Zones API', () => {
    it('GET /api/camera-zones lists seeded zones', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/camera-zones',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.zones)).toBe(true);
      expect(body.zones.length).toBeGreaterThanOrEqual(2);
      expect(body.zones.some((z: any) => z.id === 'zone-perimeter')).toBe(true);
    });

    it('POST /api/camera-zones creates a new zone', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/camera-zones',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Zone 3 - Warehouse & Dispatch',
          description: 'Loading docks, forklift aisle, and dispatch yard',
          cameraIds: ['cam-5', 'cam-6'],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.zone.name).toBe('Zone 3 - Warehouse & Dispatch');
      expect(body.zone.cameraIds).toEqual(['cam-5', 'cam-6']);
    });
  });

  describe('Guard Tours API', () => {
    it('GET /api/tours returns seeded tours with multi-hero layout modes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/tours',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.tours)).toBe(true);
      expect(body.tours.length).toBeGreaterThanOrEqual(2);

      const dualHero = body.tours.find((t: any) => t.id === 'tour-dual-hero');
      expect(dualHero).toBeDefined();
      expect(dualHero.layoutMode).toBe('2+6');
      expect(dualHero.heroCameraIds).toEqual(['cam-1', 'cam-2']);
    });

    it('POST /api/tours creates a custom drag-and-drop tour', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tours',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Gate 2 - 4-Hero Quad Zone Matrix',
          layoutMode: '4+8',
          dwellSeconds: 20,
          heroCameraIds: ['cam-1', 'cam-2', 'cam-3', 'cam-4'],
          carouselPoolIds: ['cam-5', 'cam-6', 'cam-7', 'cam-8'],
          alarmOverride: true,
          assignedScreen: 2,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.tour.name).toBe('Gate 2 - 4-Hero Quad Zone Matrix');
      expect(body.tour.layoutMode).toBe('4+8');
      expect(body.tour.dwellSeconds).toBe(20);
      expect(body.tour.heroCameraIds.length).toBe(4);
    });

    it('PUT /api/tours/:id updates tour dwell time and pool', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/tours/tour-gate-focus',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          dwellSeconds: 25,
          carouselPoolIds: ['cam-2', 'cam-4'],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.tour.dwellSeconds).toBe(25);
      expect(body.tour.carouselPoolIds).toEqual(['cam-2', 'cam-4']);
    });
  });
});
