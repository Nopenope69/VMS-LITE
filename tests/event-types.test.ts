import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server.js';
import { isEventType } from '../src/events/event.types.js';
import { signAs } from './helpers/auth.js';

describe('Event types', () => {
  it('knows every emitted type and nothing else', () => {
    expect(isEventType('camera.offline')).toBe(true);
    expect(isEventType('camera.ofline')).toBe(false);
  });

  it('rejects unknown types on the admin emit endpoint', async () => {
    const app = await createServer({ logger: false });
    await app.ready();
    const token = await signAs(app, { id: 'event-types-admin', role: 'ADMIN' });
    const emit = (type: string) =>
      app.inject({ method: 'POST', url: '/api/events/emit', headers: { authorization: `Bearer ${token}` }, payload: { type, source: 'test' } });

    expect((await emit('camera.ofline')).statusCode).toBe(400);
    expect((await emit('storage.warning')).statusCode).not.toBe(400);
    await app.close();
  });
});
