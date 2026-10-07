import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';
import { CameraMediaPaths, streamUrls } from '../src/mediamtx/camera-media-paths.js';

describe('Camera Media Paths', () => {
  let mediaMtx: MediaMtxClient;
  let paths: CameraMediaPaths;
  const gate = {
    mediaMtxPath: 'gate',
    rtspUrl: 'rtsp://10.0.0.5/main',
    subMediaMtxPath: null,
    subStreamUrl: 'rtsp://10.0.0.5/sub',
  };
  const names = async () => (await mediaMtx.listPaths()).map((p) => decodeURIComponent(p.name)).sort();

  beforeEach(() => {
    mediaMtx = new MediaMtxClient({ mockMode: true });
    paths = new CameraMediaPaths(mediaMtx);
  });

  it('names the sub-stream path and builds proxy URLs in one place', () => {
    expect(streamUrls(gate)).toEqual({
      mediaMtxPath: 'gate',
      subStreamPath: 'gate_sub',
      whepUrl: '/api/media/whep/gate/whep',
      subStreamWhepUrl: '/api/media/whep/gate_sub/whep',
      hlsUrl: '/api/media/hls/gate/index.m3u8',
      subStreamHlsUrl: '/api/media/hls/gate_sub/index.m3u8',
    });
    expect(streamUrls({ ...gate, subStreamUrl: null }).subStreamPath).toBeNull();
    expect(streamUrls({ ...gate, subMediaMtxPath: 'custom_sub' }).subStreamPath).toBe('custom_sub');
  });

  it('provisions main (always on, recording) and sub (on demand, never recorded)', async () => {
    await paths.provision(gate, true);

    expect((await mediaMtx.getPath('gate'))?.conf).toMatchObject({ sourceOnDemand: false, record: true });
    expect((await mediaMtx.getPath('gate_sub'))?.conf).toMatchObject({ sourceOnDemand: true, record: false });
  });

  it('undoes a half-provisioned camera when MediaMTX refuses the sub path', async () => {
    const setPath = mediaMtx.setPath.bind(mediaMtx);
    vi.spyOn(mediaMtx, 'setPath').mockImplementation(async (name, config) => (name === 'gate_sub' ? false : setPath(name, config)));

    await expect(paths.provision(gate, true)).rejects.toThrow(/sub-stream/);
    expect(await names()).toEqual([]);
  });

  it('reconciles missing paths, a changed source and a drifted record flag', async () => {
    await paths.reconcile(gate, false, true);
    expect(await names()).toEqual(['gate', 'gate_sub']);

    await paths.reconcile(gate, true, true);
    expect((await mediaMtx.getPath('gate'))?.conf.record).toBe(true);

    await paths.reconcile({ ...gate, rtspUrl: 'rtsp://10.0.0.6/main' }, true, false);
    expect((await mediaMtx.getPath('gate'))?.conf.source).toBe('rtsp://10.0.0.6/main');
  });

  it('sweeps paths no camera owns only after two consecutive sweeps, sparing live previews', async () => {
    await paths.provision(gate, true);
    await mediaMtx.addPath('deleted_cam', 'rtsp://10.0.0.9/s');
    await mediaMtx.addPath('preview_stale1', 'rtsp://10.0.0.9/s'); // left over from before a restart
    const { pathName: livePreview } = await paths.openPreview('rtsp://10.0.0.7/s');

    expect(await paths.sweepOrphans([gate])).toEqual([]);
    expect(await paths.sweepOrphans([gate])).toEqual(['deleted_cam', 'preview_stale1']);
    expect(await names()).toEqual(['gate', 'gate_sub', livePreview].sort());

    await paths.closePreview(livePreview);
  });

  it('keeps a path whose camera appears before the second sweep', async () => {
    await mediaMtx.addPath('new_cam', 'rtsp://10.0.0.8/s'); // provisioned, row not yet saved
    await paths.sweepOrphans([]);
    expect(await paths.sweepOrphans([{ mediaMtxPath: 'new_cam' }])).toEqual([]);
    expect(await names()).toEqual(['new_cam']);
  });
});
