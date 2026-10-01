import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { signAs } from './helpers/auth.js';

describe('Storage Telemetry Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
    token = await signAs(app, {
      id: 'test-user',
      username: 'operator',
      role: 'OPERATOR',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/system/storage/drives returns 200 with drive telemetry list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/storage/drives',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();
    expect(Array.isArray(body.drives)).toBe(true);
  });

  it('GET /api/system/storage/removable returns 200 with removable mounts array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/storage/removable',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.removableMounts)).toBe(true);
  });

  it('GET /api/system/dashboard includes drive health telemetry summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/dashboard',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.drives).toBeDefined();
    expect(typeof body.drives.totalDrives).toBe('number');
  });

  it('rejects unauthenticated requests to storage routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/storage/drives',
    });

    expect(res.statusCode).toBe(401);
  });
});
