import http from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

/**
 * The media proxy is the only browser path to MediaMTX, so its auth rules matter:
 * a fake upstream records what gets through.
 */
describe('Authenticated media proxy (/api/media)', () => {
  let app: FastifyInstance;
  let upstream: http.Server;
  const seen: Array<{ method: string; url: string; body: string; auth?: string }> = [];
  let adminToken: string;
  let viewerToken: string;
  let operatorToken: string;
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method!, url: req.url!, body, auth: req.headers.authorization });
        if (req.method === 'POST' && req.url!.endsWith('/whep')) {
          res.writeHead(201, {
            'Content-Type': 'application/sdp',
            Location: `/${req.url!.split('/')[1]}/whep/session-123`,
            ETag: '*',
          });
          res.end('v=0\r\nanswer');
          return;
        }
        if (req.url!.startsWith('/get?')) {
          res.writeHead(200, { 'Content-Type': 'video/mp4' });
          res.end(Buffer.from('fmp4-bytes'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U');
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    process.env.MEDIAMTX_WEBRTC_URL = base;
    process.env.MEDIAMTX_HLS_URL = base;
    process.env.MEDIAMTX_PLAYBACK_URL = base;

    app = await createServer({ logger: false });
    await app.ready();

    const { prisma } = await import('../src/db/prisma.js');
    for (const [id, path] of [
      ['proxy-cam-1', 'proxy_cam_1'],
      ['proxy-cam-2', 'proxy_cam_2'],
    ]) {
      if (!(await prisma.camera.findUnique({ where: { id } }))) {
        await prisma.camera.create({
          data: { id, name: id, rtspUrl: 'rtsp://10.0.0.9/s', mediaMtxPath: path, subMediaMtxPath: `${path}_sub` },
        });
      }
    }
    await prisma.cameraPermission.create({
      data: { userId: 'proxy-operator', cameraId: 'proxy-cam-1', canViewLive: true, canViewPlayback: false },
    });

    adminToken = app.jwt.sign({ id: 'proxy-admin', username: 'a', role: 'ADMIN' });
    viewerToken = app.jwt.sign({ id: 'proxy-viewer', username: 'v', role: 'VIEWER' });
    operatorToken = app.jwt.sign({ id: 'proxy-operator', username: 'o', role: 'OPERATOR' });
  });

  afterAll(async () => {
    process.env = previousEnv;
    await app.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  const whep = (path: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/media/whep/${path}/whep`,
      headers: { 'content-type': 'application/sdp', ...headers },
      payload: 'v=0\r\noffer',
    });

  it('rejects unauthenticated WHEP offers', async () => {
    expect((await whep('proxy_cam_1')).statusCode).toBe(401);
  });

  it('does not accept the media cookie for WHEP (state-changing POST)', async () => {
    const res = await whep('proxy_cam_1', { cookie: `vms_media=${adminToken}` });
    expect(res.statusCode).toBe(401);
  });

  it('forwards authorised offers and rewrites the session Location onto the proxy', async () => {
    const res = await whep('proxy_cam_1', { authorization: `Bearer ${viewerToken}` });
    expect(res.statusCode).toBe(201);
    expect(res.body).toContain('answer');
    expect(res.headers.location).toBe('/api/media/whep/proxy_cam_1/whep/session-123');
    expect(seen.at(-1)).toMatchObject({ method: 'POST', url: '/proxy_cam_1/whep', body: 'v=0\r\noffer' });
  });

  it('allows sub-stream paths of a permitted camera', async () => {
    const res = await whep('proxy_cam_1_sub', { authorization: `Bearer ${operatorToken}` });
    expect(res.statusCode).toBe(201);
  });

  it('enforces operator camera grants', async () => {
    const res = await whep('proxy_cam_2', { authorization: `Bearer ${operatorToken}` });
    expect(res.statusCode).toBe(403);
  });

  it('refuses paths that belong to no camera, and previews for non-admins', async () => {
    expect((await whep('not_a_camera', { authorization: `Bearer ${adminToken}` })).statusCode).toBe(403);
    expect((await whep('preview_abc', { authorization: `Bearer ${viewerToken}` })).statusCode).toBe(403);
    expect((await whep('preview_abc', { authorization: `Bearer ${adminToken}` })).statusCode).toBe(201);
  });

  it('serves HLS with the media cookie and blocks traversal', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/api/media/hls/proxy_cam_1/index.m3u8?_HLS_msn=3',
      headers: { cookie: `other=1; vms_media=${viewerToken}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('#EXTM3U');
    expect(seen.at(-1)?.url).toBe('/proxy_cam_1/index.m3u8?_HLS_msn=3');

    const traversal = await app.inject({
      method: 'GET',
      url: '/api/media/hls/proxy_cam_1/..%2F..%2Fv3/config/paths/list',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(traversal.statusCode).toBe(400);
  });

  it('proxies recorded playback with permission and parameter checks', async () => {
    const url = '/api/media/playback/get?path=proxy_cam_1&start=2026-10-01T10:00:00.000Z&duration=30';
    const ok = await app.inject({ method: 'GET', url, headers: { cookie: `vms_media=${viewerToken}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('video/mp4');
    expect(ok.body).toBe('fmp4-bytes');
    expect(seen.at(-1)?.url).toBe('/get?path=proxy_cam_1&start=2026-10-01T10%3A00%3A00.000Z&duration=30&format=fmp4');

    // Operator has live but not playback on cam 1
    const denied = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${operatorToken}` } });
    expect(denied.statusCode).toBe(403);

    const bad = await app.inject({
      method: 'GET',
      url: '/api/media/playback/get?path=proxy_cam_1&start=nope&duration=30',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('sets the HttpOnly media cookie on login', async () => {
    const { AuthService } = await import('../src/users/auth.service.js');
    await new AuthService().createUser('proxy-login-user', 'proxy-pass-123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'proxy-login-user', password: 'proxy-pass-123' },
    });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('vms_media=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/media');
  });
});
