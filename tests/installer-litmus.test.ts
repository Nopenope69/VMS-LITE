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

  it('Gate 3: Caddy fronts only the control plane (media is served by the authenticated proxy)', async () => {
    const caddyfilePath = path.join(process.cwd(), 'Caddyfile');
    const caddyContent = await fs.readFile(caddyfilePath, 'utf8');

    expect(caddyContent).toContain('reverse_proxy 127.0.0.1:3000');
    // MediaMTX listeners must never be exposed directly (no auth on them)
    for (const port of ['8888', '8889', '9996', '9997', '8554']) {
      expect(caddyContent).not.toContain(`127.0.0.1:${port}`);
    }
  });

  it('Gate 3b: MediaMTX HTTP listeners are bound to localhost', async () => {
    const mtx = await fs.readFile(path.join(process.cwd(), 'mediamtx.yml'), 'utf8');
    for (const key of ['apiAddress', 'playbackAddress', 'hlsAddress', 'webrtcAddress', 'rtspAddress']) {
      expect(mtx).toMatch(new RegExp(`^${key}: 127\\.0\\.0\\.1:`, 'm'));
    }
    // 1.11 applies defaults from pathDefaults; 'paths: all:' would be a literal path
    expect(mtx).toMatch(/^pathDefaults:/m);
    expect(mtx).toMatch(/recordDeleteAfter: 0s/);
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
