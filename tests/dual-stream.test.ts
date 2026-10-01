// tests/dual-stream.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CameraService } from '../src/cameras/camera.service.js';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';

describe('Dual-Stream Model & On-Demand Path Provisioning', () => {
  let cameraService: CameraService;
  let mockMediaMtx: MediaMtxClient;
  let mockPrisma: any;

  beforeEach(() => {
    mockMediaMtx = new MediaMtxClient({ mockMode: true });
    vi.spyOn(mockMediaMtx, 'setPath').mockResolvedValue(true);
    vi.spyOn(mockMediaMtx, 'removePath').mockResolvedValue(true);

    const cameras: any[] = [];
    mockPrisma = {
      camera: {
        create: vi.fn(async ({ data }) => {
          const record = { id: `cam-${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
          cameras.push(record);
          return record;
        }),
        findMany: vi.fn(async () => cameras),
        findUnique: vi.fn(async ({ where }) => cameras.find((c: any) => c.id === where.id || c.mediaMtxPath === where.mediaMtxPath)),
      },
    };

    cameraService = new CameraService(mockPrisma as any, mockMediaMtx);
  });

  it('provisions both main and sub streams with sourceOnDemand enabled for sub-stream', async () => {
    const camera = await cameraService.createCamera({
      name: 'Warehouse Gate',
      rtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream1',
      subRtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream2',
    });

    expect(camera.mediaMtxPath).toBeDefined();
    expect(camera.subMediaMtxPath).toBeDefined();
    expect(camera.subMediaMtxPath).toContain('_sub');

    // Verify main stream provisioned in MediaMTX with sourceOnDemand: false (recording invariant)
    expect(mockMediaMtx.setPath).toHaveBeenCalledWith(
      camera.mediaMtxPath,
      expect.objectContaining({
        source: 'rtsp://admin:pass@192.168.1.50:554/stream1',
        sourceOnDemand: false,
      })
    );

    // Verify sub-stream provisioned with sourceOnDemand: true
    expect(mockMediaMtx.setPath).toHaveBeenCalledWith(
      camera.subMediaMtxPath,
      expect.objectContaining({
        source: 'rtsp://admin:pass@192.168.1.50:554/stream2',
        sourceOnDemand: true,
      })
    );
  });

  it('provisions only main stream when subRtspUrl is not provided', async () => {
    const camera = await cameraService.createCamera({
      name: 'Main Entrance',
      rtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream1',
    });

    expect(camera.mediaMtxPath).toBeDefined();
    expect(camera.subMediaMtxPath).toBeNull();

    expect(mockMediaMtx.setPath).toHaveBeenCalledWith(
      camera.mediaMtxPath,
      expect.objectContaining({
        source: 'rtsp://admin:pass@192.168.1.50:554/stream1',
        sourceOnDemand: false,
      })
    );

    expect(mockMediaMtx.setPath).not.toHaveBeenCalledWith(
      expect.stringContaining('_sub'),
      expect.anything()
    );
  });

  it('throws an error and rolls back provisioned paths when media plane setPath fails', async () => {
    vi.spyOn(mockMediaMtx, 'setPath')
      .mockResolvedValueOnce(true) // main stream succeeds
      .mockResolvedValueOnce(false); // sub stream fails

    await expect(
      cameraService.createCamera({
        name: 'Failing Sub Camera',
        rtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream1',
        subRtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream2',
      })
    ).rejects.toThrow(/Failed to configure sub-stream path in media plane/);

    expect(mockMediaMtx.removePath).toHaveBeenCalledWith(expect.stringMatching(/failing_sub_camera.*_sub/));
    expect(mockMediaMtx.removePath).toHaveBeenCalledWith(expect.stringMatching(/failing_sub_camera/));
    expect(mockPrisma.camera.create).not.toHaveBeenCalled();
  });

  it('cleanly tears down provisioned MediaMTX paths if database persistence fails', async () => {
    mockPrisma.camera.create.mockRejectedValueOnce(new Error('Database disk full'));

    await expect(
      cameraService.createCamera({
        name: 'Database Failure Camera',
        rtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream1',
        subRtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream2',
      })
    ).rejects.toThrow('Database disk full');

    expect(mockMediaMtx.removePath).toHaveBeenCalledWith(expect.stringMatching(/database_failure_camera.*_sub/));
    expect(mockMediaMtx.removePath).toHaveBeenCalledWith(expect.stringMatching(/database_failure_camera/));
  });
});
