import { describe, it, expect, beforeEach } from 'vitest';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { PrismaDetectionRepository } from '../src/ai/detection.repository.js';
import { AiDetectionItem } from '../src/ai/ai.types.js';

describe('PrismaDetectionRepository (Spatio-Temporal Metadata Store)', () => {
  let mockPrisma: any;
  let repo: PrismaDetectionRepository;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    repo = new PrismaDetectionRepository(mockPrisma);
  });

  it('persists detections with absolute timestamps derived from segment start', async () => {
    const segmentStart = new Date('2026-10-06T20:00:00.000Z');
    const detections: AiDetectionItem[] = [
      {
        id: 'track-101',
        label: 'person',
        confidence: 0.95,
        boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.5 },
        timestampOffsetMs: 5000, // 5 seconds into segment
      },
      {
        id: 'track-102',
        label: 'vehicle',
        confidence: 0.82,
        boundingBox: { x: 0.5, y: 0.5, width: 0.4, height: 0.3 },
        timestampOffsetMs: 15000, // 15 seconds into segment
      },
    ];

    const saved = await repo.saveDetections(
      'rec_seg_1',
      'cam_east_gate',
      'site_surat_hub',
      detections,
      'yolov8m-v2',
      segmentStart
    );

    expect(saved).toHaveLength(2);
    expect(saved[0].cameraId).toBe('cam_east_gate');
    expect(saved[0].siteId).toBe('site_surat_hub');
    expect(saved[0].label).toBe('person');
    expect(saved[0].timestamp.toISOString()).toBe('2026-10-06T20:00:05.000Z');
    expect(saved[1].timestamp.toISOString()).toBe('2026-10-06T20:00:15.000Z');
  });

  it('executes spatio-temporal smart searches across camera, label, and time ranges', async () => {
    const baseTime = new Date('2026-10-06T10:00:00.000Z');

    // Seed test detections
    await repo.saveDetections(
      'rec_1',
      'cam_lobby',
      'site_hq',
      [
        {
          id: 'p1',
          label: 'person',
          confidence: 0.9,
          boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          timestampOffsetMs: 1000,
        },
        {
          id: 'v1',
          label: 'vehicle',
          confidence: 0.85,
          boundingBox: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
          timestampOffsetMs: 2000,
        },
      ],
      'yolo',
      baseTime
    );

    await repo.saveDetections(
      'rec_2',
      'cam_gate',
      'site_hq',
      [
        {
          id: 'p2',
          label: 'person',
          confidence: 0.6,
          boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          timestampOffsetMs: 1000,
        },
      ],
      'yolo',
      baseTime
    );

    // Query 1: Find all persons at cam_lobby
    const personsLobby = await repo.queryDetections({
      cameraId: 'cam_lobby',
      label: 'person',
    });
    expect(personsLobby).toHaveLength(1);
    expect(personsLobby[0].label).toBe('person');
    expect(personsLobby[0].cameraId).toBe('cam_lobby');

    // Query 2: Filter by confidence >= 0.8
    const highConfidence = await repo.queryDetections({
      minConfidence: 0.8,
    });
    expect(highConfidence).toHaveLength(2); // p1 (0.9) and v1 (0.85), p2 (0.6) filtered out

    // Query 3: Query by site
    const hqDetections = await repo.queryDetections({
      siteId: 'site_hq',
    });
    expect(hqDetections).toHaveLength(3);
  });
});
