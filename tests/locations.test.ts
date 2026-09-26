import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';

describe('Custom Locations & Operational Zones API (/api/v1/locations)', () => {
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

  describe('Locations CRUD', () => {
    it('GET /api/v1/locations returns seeded locations and zones', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/locations',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.locations)).toBe(true);
      expect(body.locations.length).toBeGreaterThanOrEqual(4);
      expect(body.locations.some((l: any) => l.name.includes('Delhi'))).toBe(true);
      expect(Array.isArray(body.zones)).toBe(true);
      expect(body.zones.length).toBeGreaterThanOrEqual(4);
    });

    let createdLocId: string;

    it('POST /api/v1/locations creates a new custom location', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Hyderabad Cyber Hub',
          code: 'HYD-01',
          icon: '🏢',
          cameraIds: ['cam-hyd-1', 'cam-hyd-2'],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.location.name).toBe('Hyderabad Cyber Hub');
      expect(body.location.code).toBe('HYD-01');
      expect(body.location.cameraIds).toEqual(['cam-hyd-1', 'cam-hyd-2']);
      createdLocId = body.location.id;
    });

    it('PUT /api/v1/locations/:id updates custom location', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/locations/${createdLocId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Hyderabad Global Delivery Center',
          cameraIds: ['cam-hyd-1', 'cam-hyd-2', 'cam-hyd-3'],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.location.name).toBe('Hyderabad Global Delivery Center');
      expect(body.location.cameraIds).toHaveLength(3);
    });

    it('DELETE /api/v1/locations/:id deletes location', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/locations/${createdLocId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('Operational Zones CRUD', () => {
    it('GET /api/v1/locations/zones returns all operational zones', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/locations/zones',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.zones)).toBe(true);
      expect(body.zones.some((z: any) => z.id === 'entrance' || z.name.includes('Gates'))).toBe(true);
    });

    let createdZoneId: string;

    it('POST /api/v1/locations/zones creates a new custom operational zone', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/locations/zones',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Server Room & Data Vault',
          color: '#ec4899',
          icon: '💻',
          cameraIds: ['cam-srv-1'],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.zone.name).toBe('Server Room & Data Vault');
      expect(body.zone.color).toBe('#ec4899');
      expect(body.zone.cameraIds).toEqual(['cam-srv-1']);
      createdZoneId = body.zone.id;
    });

    it('PUT /api/v1/locations/zones/:id updates custom zone', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/locations/zones/${createdZoneId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          color: '#f43f5e',
          cameraIds: ['cam-srv-1', 'cam-srv-2'],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.zone.color).toBe('#f43f5e');
      expect(body.zone.cameraIds).toEqual(['cam-srv-1', 'cam-srv-2']);
    });

    it('DELETE /api/v1/locations/zones/:id deletes operational zone', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/locations/zones/${createdZoneId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });
  });
});
