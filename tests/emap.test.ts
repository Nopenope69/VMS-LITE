import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { emapService } from '../src/emap/emap.service.js';

describe('Interactive Site E-Map API (/api/emap)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-emap',
      username: 'admin',
      role: Role.ADMIN,
    });

    viewerToken = app.jwt.sign({
      id: 'viewer-emap',
      username: 'viewer',
      role: Role.VIEWER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/emap/plans lists default site blueprint plans', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/emap/plans',
      headers: { authorization: `Bearer ${viewerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.plans.length).toBeGreaterThanOrEqual(1);
    expect(json.plans[0].name).toContain('Main Facility');
    expect(json.plans[0].markers.length).toBeGreaterThanOrEqual(2);
  });

  it('PUT /api/emap/plans/:id/markers updates camera coordinates and FOV rotation', async () => {
    const plans = emapService.listFloorPlans();
    const planId = plans[0].id;

    const updatedMarkers = [
      {
        cameraId: 'cam-gate',
        cameraName: 'Gate Boom Barrier',
        x: 25.5,
        y: 80.0,
        angle: 90,
        fovDegrees: 90,
      },
    ];

    const res = await app.inject({
      method: 'PUT',
      url: `/api/emap/plans/${planId}/markers`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { markers: updatedMarkers },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.plan.markers[0].x).toBe(25.5);
    expect(json.plan.markers[0].angle).toBe(90);
  });

  it('POST /api/emap/plans creates a new floor plan (Admin only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/emap/plans',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Warehouse Floor 2 Layout',
        description: 'Mezzanine storage and loading ramp',
        widthMeters: 60,
        heightMeters: 40,
        markers: [],
      },
    });

    expect(res.statusCode).toBe(201);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.plan.name).toBe('Warehouse Floor 2 Layout');
  });
});
