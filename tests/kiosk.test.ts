import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

describe('Network URL Kiosk Display API (/api/kiosk)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates a 4-digit pairing code and auto-authenticates via permanent station token', async () => {
    // 1. TV requests pairing PIN
    const codeRes = await app.inject({
      method: 'POST',
      url: '/api/kiosk/pair-code',
    });
    expect(codeRes.statusCode).toBe(200);
    const codeBody = codeRes.json();
    expect(codeBody.success).toBe(true);
    expect(codeBody.code).toMatch(/^\d{4}$/);
    expect(codeBody.stationKey).toContain('kiosk-');

    const pairingCode = codeBody.code;

    // 2. Admin enters code to link TV station
    const pairRes = await app.inject({
      method: 'POST',
      url: '/api/kiosk/pair',
      payload: {
        pairingCode,
        name: 'Guard Cabin - South Wall TV',
        assignedTourId: 'tour-dual-hero',
        mode: 'DEDICATED',
      },
    });
    expect(pairRes.statusCode).toBe(201);
    const pairBody = pairRes.json();
    expect(pairBody.success).toBe(true);
    expect(pairBody.station.name).toBe('Guard Cabin - South Wall TV');
    expect(pairBody.station.assignedTourId).toBe('tour-dual-hero');

    const permanentKey = pairBody.station.stationKey;

    // 3. TV reboots and uses permanent station token to authenticate
    const authRes = await app.inject({
      method: 'GET',
      url: `/api/kiosk/station/${permanentKey}`,
    });
    expect(authRes.statusCode).toBe(200);
    const authBody = authRes.json();
    expect(authBody.success).toBe(true);
    expect(authBody.station.name).toBe('Guard Cabin - South Wall TV');

    // 4. Heartbeat update
    const hbRes = await app.inject({
      method: 'POST',
      url: `/api/kiosk/heartbeat/${permanentKey}`,
    });
    expect(hbRes.statusCode).toBe(200);

    // 5. Admin lists stations
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/stations',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().stations.length).toBeGreaterThanOrEqual(2);
  });
});
