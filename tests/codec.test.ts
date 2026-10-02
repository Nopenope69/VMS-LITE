import { describe, it, expect, vi } from 'vitest';
import {
  codecLabel,
  codecNotes,
  H265_LIVE_HINT,
  H265_MAIN_HINT,
  isBrowserUnfriendlyCodec,
  liveViewCodec,
  pickSubProfile,
} from '../client/src/utils/codec.js';
import { CameraHealthService, videoCodecOf } from '../src/health/camera-health.service.js';
import { EventBus } from '../src/events/event-bus.js';
import { createMockPrisma } from '../src/db/mock-prisma.js';

describe('Codec helpers', () => {
  it('flags H.265 for live view and labels codecs', () => {
    expect(isBrowserUnfriendlyCodec('H265')).toBe(true);
    expect(isBrowserUnfriendlyCodec('hevc')).toBe(true);
    expect(isBrowserUnfriendlyCodec('H264')).toBe(false);
    expect(isBrowserUnfriendlyCodec(null)).toBe(false);
    expect(codecLabel('H265')).toBe('H.265');
    expect(codecLabel(undefined)).toBe('Unknown');
  });

  it('judges live view by the sub-stream when there is one', () => {
    expect(liveViewCodec({ videoCodec: 'H265', hasSubStream: true, subVideoCodec: 'H264' })).toBe('H264');
    expect(liveViewCodec({ videoCodec: 'H265', hasSubStream: false, subVideoCodec: null })).toBe('H265');
    // Sub-stream not pulled yet: unknown, so no warning based on the main stream
    expect(liveViewCodec({ videoCodec: 'H265', hasSubStream: true, subVideoCodec: null })).toBeNull();
  });

  it('explains what an H.265 stream affects', () => {
    expect(codecNotes({ videoCodec: 'H265', hasSubStream: false })).toEqual([H265_LIVE_HINT]);
    expect(codecNotes({ videoCodec: 'H265', hasSubStream: true, subVideoCodec: 'H264' })).toEqual([H265_MAIN_HINT]);
    expect(codecNotes({ videoCodec: 'H264', hasSubStream: true, subVideoCodec: 'H265' })).toEqual([H265_LIVE_HINT]);
    expect(codecNotes({ videoCodec: 'H264', hasSubStream: false })).toEqual([]);
  });

  it('prefers an H.264 profile as sub-stream', () => {
    const main = { rtspUri: 'main', isMainStream: true, encoding: 'H265' };
    const subHevc = { rtspUri: 'sub1', encoding: 'H265' };
    const subAvc = { rtspUri: 'sub2', encoding: 'H264' };
    expect(pickSubProfile([main, subHevc, subAvc], main)?.rtspUri).toBe('sub2');
    expect(pickSubProfile([main, subHevc], main)?.rtspUri).toBe('sub1');
    expect(pickSubProfile([main], main)).toBeUndefined();
  });

  it('reads the video codec from MediaMTX track lists', () => {
    expect(videoCodecOf(['MPEG-4 Audio', 'H265'])).toBe('H265');
    expect(videoCodecOf(['Opus'])).toBeNull();
    expect(videoCodecOf(undefined)).toBeNull();
  });
});

describe('Camera health: codecs and sub-stream bitrate', () => {
  it('reports both streams’ codecs and the sub-stream bitrate', async () => {
    let bytes = 0;
    const service = new CameraHealthService({
      cameraService: {} as any,
      eventBus: new EventBus(createMockPrisma() as any),
      mediaMtxClient: {
        getPathRuntime: async (path: string) =>
          path.endsWith('_sub')
            ? { ready: true, bytesReceived: bytes / 4, tracks: ['H264'] }
            : { ready: true, bytesReceived: bytes, tracks: ['H265', 'MPEG-4 Audio'] },
      },
    });
    vi.spyOn(service, 'pingTcp').mockResolvedValue({ reachable: true, latencyMs: 3 });
    const camera = { id: 'c', name: 'C', ip: '10.0.0.1', mediaMtxPath: 'c', subMediaMtxPath: 'c_sub' };

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await service.checkCamera(camera);
    bytes = 2_000_000; // 16 Mbit main, 4 Mbit sub over 10 s
    vi.setSystemTime(10_000);
    const t = await service.checkCamera(camera);
    vi.useRealTimers();

    expect(t).toMatchObject({ videoCodec: 'H265', hasSubStream: true, subVideoCodec: 'H264', bitrateKbps: 1600, subBitrateKbps: 400 });
  });
});
