import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { CameraScope } from '../src/users/camera-scope.js';
import { signAs } from './helpers/auth.js';
import { extendedLicense } from './helpers/license.js';

describe('Site-wide operator permissions', () => {
  let app: FastifyInstance;
  let admin: string;
  let operator: string;
  let northId: string;
  let southId: string;
  const cam: Record<string, string> = {};

  const api = (method: any, url: string, token: string, payload?: any) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
  const addCamera = async (name: string, siteId: string | null) => {
    const res = await api('POST', '/api/cameras', admin, {
      name,
      rtspUrl: `rtsp://10.2.0.${Object.keys(cam).length + 1}/s`,
      ...(siteId ? { siteId } : {}),
    });
    expect(res.statusCode).toBe(201);
    cam[name] = res.json().id;
    return res.json().id as string;
  };

  beforeAll(async () => {
    app = await createServer({ logger: false, licensing: await extendedLicense() });
    await app.ready();
    admin = await signAs(app, { id: 'sp-admin', username: 'sp-admin', role: 'ADMIN' });
    operator = await signAs(app, { id: 'sp-operator', username: 'sp-operator', role: 'OPERATOR' });
    northId = (await api('POST', '/api/sites', admin, { name: 'SP North' })).json().id;
    southId = (await api('POST', '/api/sites', admin, { name: 'SP South' })).json().id;
    await addCamera('North A', northId);
    await addCamera('South A', southId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('only admins may grant site permissions, and sites must exist', async () => {
    const body = { permissions: [{ siteId: northId, canViewLive: true }] };
    expect((await api('PUT', '/api/auth/users/sp-operator/site-permissions', operator, body)).statusCode).toBe(403);
    const missing = await api('PUT', '/api/auth/users/sp-operator/site-permissions', admin, {
      permissions: [{ siteId: 'nope', canViewLive: true }],
    });
    expect(missing.statusCode).toBe(400);
  });

  it('grants every camera of a site, including cameras added later', async () => {
    const res = await api('PUT', '/api/auth/users/sp-operator/site-permissions', admin, {
      permissions: [{ siteId: northId, canViewLive: true, canViewPlayback: true, canControlPtz: true }],
    });
    expect(res.statusCode).toBe(200);
    await addCamera('North B', northId); // added after the grant

    const list = (await api('GET', '/api/cameras', operator)).json();
    expect(list.cameras.map((c: any) => c.name).sort()).toEqual(['North A', 'North B']);

    const sites = (await api('GET', '/api/sites', operator)).json().sites;
    expect(sites.map((s: any) => s.name)).toEqual(['SP North']);
    expect(sites[0].cameraCount).toBe(2);

    // Per-camera guard (PTZ) and the media proxy both honour the site grant
    const ptz = await api('GET', `/api/cameras/${cam['North B']}/ptz/presets`, operator);
    expect(ptz.statusCode).not.toBe(403);
    const otherSitePtz = await api('GET', `/api/cameras/${cam['South A']}/ptz/presets`, operator);
    expect(otherSitePtz.statusCode).toBe(403);

    const me = (await api('GET', '/api/auth/me', operator)).json();
    const effective = me.user.cameraPermissions.find((p: any) => p.cameraId === cam['North B']);
    expect(effective).toMatchObject({ canViewLive: true, canControlPtz: true, canExportClips: false });
  });

  it('follows cameras that move between sites', async () => {
    const res = await api('PATCH', `/api/cameras/${cam['South A']}`, admin, { siteId: northId });
    expect(res.statusCode).toBe(200);
    let names = (await api('GET', '/api/cameras', operator)).json().cameras.map((c: any) => c.name);
    expect(names).toContain('South A');

    await api('PATCH', `/api/cameras/${cam['South A']}`, admin, { siteId: southId });
    names = (await api('GET', '/api/cameras', operator)).json().cameras.map((c: any) => c.name);
    expect(names).not.toContain('South A');
  });

  it('combines with per-camera grants and is revoked by sending the full list', async () => {
    await api('PUT', '/api/auth/users/sp-operator/permissions', admin, {
      permissions: [{ cameraId: cam['South A'], canViewLive: true, canViewPlayback: false }],
    });
    let names = (await api('GET', '/api/cameras', operator)).json().cameras.map((c: any) => c.name).sort();
    expect(names).toEqual(['North A', 'North B', 'South A']);

    // Empty list removes the site grant; the camera grant remains
    const cleared = await api('PUT', '/api/auth/users/sp-operator/site-permissions', admin, { permissions: [] });
    expect(cleared.statusCode).toBe(200);
    names = (await api('GET', '/api/cameras', operator)).json().cameras.map((c: any) => c.name);
    expect(names).toEqual(['South A']);
    expect((await api('GET', '/api/auth/users/sp-operator/site-permissions', admin)).json().count).toBe(0);
  });

  it('drops site grants when the site is deleted', async () => {
    const temp = (await api('POST', '/api/sites', admin, { name: 'SP Temp' })).json().id;
    await api('PUT', '/api/auth/users/sp-operator/site-permissions', admin, {
      permissions: [{ siteId: temp, canViewLive: true }],
    });
    expect((await api('DELETE', `/api/sites/${temp}`, admin)).statusCode).toBe(200);
    expect((await api('GET', '/api/auth/users/sp-operator/site-permissions', admin)).json().count).toBe(0);
  });
});

describe('Effective permission merge', () => {
  it('ORs camera and site grants flag by flag', async () => {
    const prisma = createMockPrisma();
    await prisma.camera.create({ data: { id: 'c1', name: 'c1', rtspUrl: 'rtsp://x/1', mediaMtxPath: 'c1', siteId: 's1' } });
    await prisma.camera.create({ data: { id: 'c2', name: 'c2', rtspUrl: 'rtsp://x/2', mediaMtxPath: 'c2', siteId: 's2' } });
    await prisma.cameraPermission.create({
      data: { userId: 'u', cameraId: 'c1', canViewLive: true, canViewPlayback: false, canControlPtz: false, canExportClips: true },
    });
    await prisma.sitePermission.create({
      data: { userId: 'u', siteId: 's1', canViewLive: false, canViewPlayback: true, canControlPtz: false, canExportClips: false },
    });

    const scope = await CameraScope.forUser({ id: 'u', role: 'OPERATOR' as any }, prisma);
    expect(scope.permissions(['c1', 'c2'])).toEqual([
      { cameraId: 'c1', canViewLive: true, canViewPlayback: true, canControlPtz: false, canExportClips: true, viaCamera: true, viaSite: true },
    ]);
    expect(scope.can('c1', 'canViewPlayback')).toBe(true);
    expect(scope.can('c1', 'canControlPtz')).toBe(false);
    expect(scope.can('c2', 'canViewLive')).toBe(false);
    expect(scope.cameraIds('view')).toEqual(['c1']);
  });
});
