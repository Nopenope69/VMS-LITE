import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

describe('Server Bootstrap & Healthcheck', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with service status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('basic-vms');
    expect(body.version).toBe('0.1.0');
    expect(body.timestamp).toBeDefined();
  });
});
