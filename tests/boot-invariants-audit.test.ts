import { describe, it, expect } from 'vitest';
import { RecordingEngine } from '../src/recordings/recording-engine.js';
import { InMemoryRecordingRepository } from '../src/recordings/repositories/recording.repository.js';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';
import { EventBus } from '../src/events/event-bus.js';

async function bootWith(statfsFn: () => Promise<any>) {
  const repository = new InMemoryRecordingRepository();
  repository.registerCamera({ id: 'cam-1', name: 'Gate', mediaMtxPath: 'gate' });
  const rec = await repository.createRecording({
    cameraId: 'cam-1', mediaMtxPath: 'gate', filePath: '/tmp/vms-boot-audit/gate/gone.mp4', fileName: 'gone.mp4',
    startTime: new Date(Date.now() - 60_000), endTime: new Date(), duration: 60, sizeBytes: 1,
  });
  const engine = new RecordingEngine({
    repository,
    mediaMtx: new MediaMtxClient({ mockMode: true }),
    eventBus: new EventBus(),
    recordingsDir: '/tmp/vms-boot-audit',
    statfsFn,
  });
  await engine.start();
  await engine.stop();
  return (await repository.findRecordingById(rec.id))!.status;
}

describe('Boot invariants audit', () => {
  it('marks catalogued files that are gone as MISSING when storage is healthy', async () => {
    expect(await bootWith(async () => ({ bsize: 1, blocks: 1000, bfree: 900 }))).toBe('MISSING');
  });

  it('leaves the catalog alone when the recordings volume is not mounted', async () => {
    expect(await bootWith(async () => { throw new Error('ENOENT: mount missing'); })).toBe('AVAILABLE');
  });
});
