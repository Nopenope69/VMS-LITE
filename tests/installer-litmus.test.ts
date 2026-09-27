import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

const execFileAsync = promisify(execFile);

describe('Installer Litmus Acceptance Test (Phase 21 - MVP-14)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('Gate 1: Verifies Node.js runtime meets or exceeds LTS v20.0.0', () => {
    const versionStr = process.versions.node;
    const major = parseInt(versionStr.split('.')[0], 10);
    expect(major).toBeGreaterThanOrEqual(20);
  });

  it('Gate 2: Verifies backend control plane and Vite web client build artifacts', async () => {
    const rootDir = process.cwd();

    // Verify backend build output exists or builds
    const distIndexPath = path.join(rootDir, 'dist', 'index.js');
    let backendBuilt = false;
    try {
      await fs.access(distIndexPath);
      backendBuilt = true;
    } catch {
      // Build if not present
      await execFileAsync('npm', ['run', 'build'], { cwd: rootDir });
      backendBuilt = true;
    }
    expect(backendBuilt).toBe(true);

    // Verify Vite frontend build output exists or builds
    const clientDistPath = path.join(rootDir, 'client', 'dist', 'index.html');
    let clientBuilt = false;
    try {
      await fs.access(clientDistPath);
      clientBuilt = true;
    } catch {
      await execFileAsync('npm', ['run', 'build:client'], { cwd: rootDir });
      clientBuilt = true;
    }
    expect(clientBuilt).toBe(true);

    const clientHtml = await fs.readFile(clientDistPath, 'utf8');
    expect(clientHtml).toContain('<div id="root"></div>');
  });

  it('Gate 3: Verifies Caddy reverse-proxy configuration routes media, api, and SPA', async () => {
    const caddyfilePath = path.join(process.cwd(), 'Caddyfile');
    const caddyContent = await fs.readFile(caddyfilePath, 'utf8');

    // MediaMTX media plane routes
    expect(caddyContent).toContain('path /whep/*');
    expect(caddyContent).toContain('path /hls/*');
    expect(caddyContent).toContain('reverse_proxy 127.0.0.1:8889');

    // Fastify control plane API & WebSockets
    expect(caddyContent).toContain('path /api/*');
    expect(caddyContent).toContain('path /ws');
    expect(caddyContent).toContain('path /health');
    expect(caddyContent).toContain('reverse_proxy 127.0.0.1:3000');

    // Frontend SPA static server
    expect(caddyContent).toContain('root * ./client/dist');
    expect(caddyContent).toContain('try_files {path} /index.html');
  });

  it('Gate 4: Verifies 100% Permissive third-party dependency licensing', async () => {
    const auditScriptPath = path.join(process.cwd(), 'scripts', 'audit-licenses.js');
    const { stdout } = await execFileAsync(process.execPath, [auditScriptPath], {
      cwd: process.cwd(),
    });

    expect(stdout).toContain('100% Permissive Licensing Verified');
    expect(stdout).toContain('All production packages pass audit');
    expect(stdout).not.toContain('GPL');
    expect(stdout).not.toContain('AGPL');
  });

  it('Gate 5: Verifies system health endpoint (/health) and capability readiness', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('basic-vms');
    expect(body.timestamp).toBeDefined();

    // Verify licensing capabilities baseline
    expect(app.capabilities).toBeDefined();
    expect(app.capabilities.has('core.camera_health')).toBe(true);
  });
});
