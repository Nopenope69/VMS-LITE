import { describe, it, expect } from 'vitest';
import {
  SegmentCreatedEventV1Schema,
  createSegmentCreatedEventV1,
} from '../src/events/segment-created-event.schema.js';

describe('SegmentCreatedEventV1 Contract', () => {
  it('parses a valid segment created event with defaults', () => {
    const rawInput = {
      source: {
        cameraId: 'cam_gate_01',
        siteId: 'site_north_plant',
      },
      recording: {
        id: 'rec_99482',
        startTime: '2026-10-06T12:00:00.000Z',
        endTime: '2026-10-06T12:01:00.000Z',
        durationMs: 60000,
      },
      media: {
        codec: 'h264',
        width: 1920,
        height: 1080,
      },
      artifact: {
        key: 'cam_gate_01/2026/10/06/12-00-00.mp4',
        sizeBytes: 15420000,
      },
      capture: {
        mode: 'CONTINUOUS' as const,
      },
      analysisHints: {
        priority: 'high' as const,
      },
    };

    const parsed = createSegmentCreatedEventV1(rawInput);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.eventType).toBe('recording.segment.created');
    expect(parsed.eventId).toBeDefined();
    expect(parsed.occurredAt).toBeDefined();
    expect(parsed.media.format).toBe('fmp4');
    expect(parsed.artifact.provider).toBe('local');
    expect(parsed.analysisHints.eligible).toBe(true);
    expect(parsed.analysisHints.preferredStream).toBe('sub');
    expect(parsed.source.cameraId).toBe('cam_gate_01');
    expect(parsed.recording.durationMs).toBe(60000);
  });

  it('rejects events missing essential fields', () => {
    const invalidInput = {
      source: {
        // missing cameraId
      },
      recording: {
        id: 'rec_1',
        // missing startTime / endTime
      },
      artifact: {
        key: 'test.mp4',
      },
    };

    expect(() => SegmentCreatedEventV1Schema.parse(invalidInput)).toThrow();
  });

  it('preserves motion incident context for AI priority dispatch', () => {
    const event = createSegmentCreatedEventV1({
      source: { cameraId: 'cam2' },
      recording: {
        id: 'rec_incident_1',
        startTime: '2026-10-06T14:30:00.000Z',
        endTime: '2026-10-06T14:30:30.000Z',
        durationMs: 30000,
      },
      media: { codec: 'h265' },
      artifact: { key: 'cam2/incident.mp4', sizeBytes: 8000000 },
      capture: {
        mode: 'MOTION_ONLY',
        incidentId: 'incident_4882',
      },
      analysisHints: {
        eligible: true,
        priority: 'high',
        preferredStream: 'main',
      },
    });

    expect(event.capture.mode).toBe('MOTION_ONLY');
    expect(event.capture.incidentId).toBe('incident_4882');
    expect(event.analysisHints.priority).toBe('high');
    expect(event.analysisHints.preferredStream).toBe('main');
  });
});
