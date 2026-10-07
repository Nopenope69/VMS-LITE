import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { EventEmitter } from 'node:events';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';
import { AuthService } from '../src/users/auth.service.js';
import { mediaMtxClient } from '../src/mediamtx/mediamtx.client.js';
import { seedRecording } from './helpers/recordings.js';
import fs from 'node:fs/promises';
import { exportService } from '../src/export/export.service.js';

describe('Golden Installer Path Integration Test (Phase 13 - MVP-02)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let createdCamera: any;
  const todayStr = new Date().toISOString().split('T')[0];

  beforeAll(async () => {
    // Clear mock database collections for clean installer run
    (globalThis as any).prismaGlobal?.camera?.clear();
    (globalThis as any).prismaGlobal?.user?.clear();
    (globalThis as any).prismaGlobal?.recording?.clear();
    (globalThis as any).prismaGlobal?.exportJob?.clear();

    app = await createServer({ logger: false });
    await app.ready();

    // Enable capabilities for full installer verification
    vi.spyOn(app.capabilities, 'has').mockReturnValue(true);

    // 1. Seed initial admin user
    const authService = new AuthService(prisma);
    await authService.seedInitialAdmin('admin', 'installerAdmin123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('Step 1: Verifies system health check endpoint (/health)', async () => {
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

  it('Step 2: Admin authenticates and acquires JWT token (/api/auth/login)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'admin',
        password: 'installerAdmin123',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.user.role).toBe(Role.ADMIN);
    expect(body.user.username).toBe('admin');

    adminToken = body.token;
  });

  it('Step 3: Onboards IP camera with credentials and stream URL (/api/cameras)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cameras',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: 'Entrance Gate',
        rtspUrl: 'rtsp://admin:pass123@192.168.1.100:554/stream1',
      },
    });

    expect(res.statusCode).toBe(201);
    createdCamera = res.json();
    expect(createdCamera.id).toBeDefined();
    expect(createdCamera.name).toBe('Entrance Gate');
    expect(createdCamera.mediaMtxPath).toContain('entrance_gate');
    expect(createdCamera.status).toBe('online');
  });

  it('Step 4: Verifies synchronous MediaMTX stream path provisioning', async () => {
    const pathConfig = await mediaMtxClient.getPath(createdCamera.mediaMtxPath);
    expect(pathConfig).not.toBeNull();
    expect(pathConfig?.conf?.source).toBe('rtsp://admin:pass123@192.168.1.100:554/stream1');
  });

  it('Step 5: Ingests recorded video segment and validates 24h timeline query (/api/playback/timeline)', async () => {
    await seedRecording({
      cameraId: createdCamera.id,
      mediaMtxPath: createdCamera.mediaMtxPath,
      startTime: `${todayStr}T11:00:00Z`,
      durationSeconds: 120,
    });

    // Query timeline for the camera on today's date
    const res = await app.inject({
      method: 'GET',
      url: `/api/playback/timeline?cameraId=${createdCamera.id}&date=${todayStr}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cameraId).toBe(createdCamera.id);
    expect(Array.isArray(body.spans)).toBe(true);
    expect(body.spans.length).toBeGreaterThanOrEqual(1);
    expect(body.spans[0].durationSeconds).toBe(120);
  });

  it('Step 6: Requests video clip export without mock fallback (/api/recordings/export)', async () => {
    // Provide successful spawn stub for ffmpeg export process
    (exportService as any).spawnFfmpegFn = vi.fn().mockImplementation(async (args: string[]) => {
      const outPath = args[args.length - 1];
      await fs.writeFile(outPath, 'VIDEO_PAYLOAD_TEST');
      return { exitCode: 0, stderr: '' };
    });
    (exportService as any).validator.checkFileExists = vi.fn().mockResolvedValue(true);

    const startTime = new Date(`${todayStr}T10:55:00.000Z`).toISOString();
    const endTime = new Date(`${todayStr}T11:05:00.000Z`).toISOString();

    const res = await app.inject({
      method: 'POST',
      url: '/api/recordings/export',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        cameraId: createdCamera.id,
        startTime,
        endTime,
        exportMode: 'STREAM_COPY',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.job).toBeDefined();
    expect(body.job.cameraId).toBe(createdCamera.id);
    expect(body.job.exportMode).toBe('STREAM_COPY');
  });

  it('Step 7: Enforces fail-loud contract (503 on database unavailability) with zero silent in-memory fallback', async () => {
    // Spy on prisma.camera.create to simulate database outage
    const dbSpy = vi.spyOn(prisma.camera as any, 'create').mockImplementationOnce(async () => {
      const dbErr: any = new Error("Can't reach database server at 127.0.0.1:5432");
      dbErr.code = 'DATABASE_UNAVAILABLE';
      throw dbErr;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/cameras',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: 'Should Fail Camera',
        rtspUrl: 'rtsp://10.0.0.99/live',
      },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error).toBe('DatabaseUnavailable');
    expect(body.code).toBe('DATABASE_UNAVAILABLE');

    dbSpy.mockRestore();
  });
});
