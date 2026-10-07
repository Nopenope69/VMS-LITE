import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server.js';
import { RecordingEngine } from '../src/recordings/recording-engine.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';
import { EventBus } from '../src/events/event-bus.js';
import { signAs } from './helpers/auth.js';

describe('Server composition', () => {
  it('routes and settings use the injected recording engine, and services start and stop with the server', async () => {
    const engine = new RecordingEngine({
      repository: new InMemoryRecordingRepository(),
      mediaMtx: new MediaMtxClient({ mockMode: true }),
      eventBus: new EventBus(),
      statfsFn: async () => ({ bsize: 1, blocks: 1000, bfree: 1000 }),
      recordingsDir: '/tmp/vms-composition-test',
    });
    const app = await createServer({ logger: false, recordingEngine: engine });
    await app.ready();
    expect(engine.isActive()).toBe(true);

    const token = await signAs(app, { id: 'composition-admin', role: 'ADMIN' });
    const res = await app.inject({ method: 'GET', url: '/api/recordings/storage', headers: { authorization: `Bearer ${token}` } });
    expect(res.json().metrics.mountPath).toBe('/tmp/vms-composition-test');

    await app.close();
    expect(engine.isActive()).toBe(false);
  });
});
