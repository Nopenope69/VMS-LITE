import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/server.js';

describe('Production Serving & SPA Routing Fallback (Phase 14 - MVP-04)', () => {
  let app: FastifyInstance;
  const clientDist = path.resolve(process.cwd(), 'client/dist');
  const indexHtmlPath = path.join(clientDist, 'index.html');

  beforeAll(async () => {
    // Verify client build artifact exists
    expect(fs.existsSync(indexHtmlPath)).toBe(true);

    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the root SPA index.html on GET /', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<div id="root">');
    expect(res.payload).toContain('Basic VMS');
  });

  it('serves SPA fallback (index.html) on client-side route GET /live', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/live',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<div id="root">');
  });

  it('serves SPA fallback (index.html) on client-side route GET /playback', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/playback',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<div id="root">');
  });

  it('serves SPA fallback (index.html) on nested client route GET /cameras/diagnostics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cameras/diagnostics',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<div id="root">');
  });

  it('preserves native JSON response for API endpoints like GET /health', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('ok');
    expect(json.service).toBe('basic-vms');
  });

  it('returns standard JSON 404 for unmapped /api/* routes instead of HTML fallback', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/non-existent-subsystem',
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    const json = JSON.parse(res.payload);
    expect(json.error).toBe('NotFound');
    expect(json.message).toContain('not found');
  });

  it('serves bundled static JS assets from /assets/ directory', async () => {
    const assetsDir = path.join(clientDist, 'assets');
    const assetFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
    expect(assetFiles.length).toBeGreaterThan(0);

    const assetToTest = assetFiles[0];
    const res = await app.inject({
      method: 'GET',
      url: `/assets/${assetToTest}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.payload.length).toBeGreaterThan(0);
  });
});
