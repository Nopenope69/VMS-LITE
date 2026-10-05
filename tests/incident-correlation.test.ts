import { describe, it, expect, beforeEach } from 'vitest';
import { IncidentCorrelationService } from '../src/incidents/incident-correlation.service.js';
import { createMockPrisma } from '../src/db/mock-prisma.js';
import { EventBus } from '../src/events/event-bus.js';
import { IncidentSeverity, IncidentStatus } from '@prisma/client';

describe('Phase 4: Industrial Operations (Incident Correlation & Evidence Protection)', () => {
  let mockPrisma: any;
  let eventBus: EventBus;
  let service: IncidentCorrelationService;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    eventBus = new EventBus();
    service = new IncidentCorrelationService(mockPrisma, eventBus);
  });

  it('correlates multi-sensor events and locks overlapping recordings under INCIDENT tier', async () => {
    const tStart = new Date('2026-10-06T10:00:00.000Z');
    const tEnd = new Date('2026-10-06T10:10:00.000Z');

    // 1. Seed camera & site
    await mockPrisma.site.create({ data: { id: 'site-warehouse', name: 'Main Warehouse' } });
    await mockPrisma.camera.create({
      data: {
        id: 'cam-dock-1',
        name: 'Loading Dock 1',
        siteId: 'site-warehouse',
        mediaMtxPath: 'dock_1',
        rtspUrl: 'rtsp://10.0.0.1/live',
      },
    });

    // 2. Seed physical & operational events in window
    await mockPrisma.event.create({
      data: {
        id: 'evt-door-opened',
        siteId: 'site-warehouse',
        cameraId: 'cam-dock-1',
        type: 'access.door_opened',
        source: 'access_controller',
        timestamp: new Date('2026-10-06T10:02:00.000Z'),
      },
    });
    await mockPrisma.event.create({
      data: {
        id: 'evt-motion-detected',
        siteId: 'site-warehouse',
        cameraId: 'cam-dock-1',
        type: 'motion.detected',
        source: 'onvif_motion',
        timestamp: new Date('2026-10-06T10:02:15.000Z'),
      },
    });

    // 3. Seed recording segments
    const rec1 = await mockPrisma.recording.create({
      data: {
        id: 'rec-dock-seg-1',
        cameraId: 'cam-dock-1',
        siteId: 'site-warehouse',
        mediaMtxPath: 'dock_1',
        filePath: '/var/recordings/dock_1/seg1.mp4',
        fileName: 'seg1.mp4',
        startTime: new Date('2026-10-06T10:00:00.000Z'),
        endTime: new Date('2026-10-06T10:05:00.000Z'),
        duration: 300,
        sizeBytes: 15_000_000n,
        retentionTier: 'CONTINUOUS',
        isProtected: false,
      },
    });

    let emittedIncidentEvent: any = null;
    eventBus.subscribe('incident.created', (evt) => {
      emittedIncidentEvent = evt;
    });

    // 4. Create Incident
    const incident = await service.createIncident({
      title: 'Unauthorized Loading Dock Access',
      description: 'Door forced open while facility closed',
      severity: IncidentSeverity.HIGH,
      siteId: 'site-warehouse',
      primaryCameraId: 'cam-dock-1',
      startTime: tStart,
      endTime: tEnd,
    });

    expect(incident.id).toBeDefined();
    expect(incident.title).toBe('Unauthorized Loading Dock Access');
    expect(incident.events.length).toBe(2);
    expect(incident.recordings.length).toBe(1);

    // 5. Verify recording is locked and protected
    const lockedRecording = await mockPrisma.recording.findUnique({
      where: { id: rec1.id },
    });
    expect(lockedRecording.isProtected).toBe(true);
    expect(lockedRecording.retentionTier).toBe('INCIDENT');
    expect(lockedRecording.protectionReason).toContain('Unauthorized Loading Dock Access');

    // 6. Verify event emitted on eventBus
    expect(emittedIncidentEvent).not.toBeNull();
    expect(emittedIncidentEvent.metadata.incidentId).toBe(incident.id);
    expect(emittedIncidentEvent.metadata.severity).toBe('HIGH');
  });

  it('retrieves incident details with correlated events and recordings', async () => {
    const tStart = new Date('2026-10-06T11:00:00.000Z');
    const tEnd = new Date('2026-10-06T11:05:00.000Z');

    const created = await service.createIncident({
      title: 'Perimeter Fence Motion',
      startTime: tStart,
      endTime: tEnd,
      severity: IncidentSeverity.MEDIUM,
    });

    const fetched = await service.getIncident(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe('Perimeter Fence Motion');
    expect(Array.isArray(fetched?.recordings)).toBe(true);
    expect(Array.isArray(fetched?.events)).toBe(true);
  });

  it('updates incident status and emits incident.updated event', async () => {
    const tStart = new Date('2026-10-06T12:00:00.000Z');
    const tEnd = new Date('2026-10-06T12:05:00.000Z');

    const created = await service.createIncident({
      title: 'Gate Tamper Alert',
      startTime: tStart,
      endTime: tEnd,
    });

    let updatedEvt: any = null;
    eventBus.subscribe('incident.updated', (evt) => {
      updatedEvt = evt;
    });

    const updated = await service.updateIncident(created.id, {
      status: IncidentStatus.RESOLVED,
      description: 'False alarm caused by severe wind',
    });

    expect(updated.status).toBe('RESOLVED');
    expect(updated.description).toContain('wind');
    expect(updatedEvt).not.toBeNull();
    expect(updatedEvt.metadata.status).toBe('RESOLVED');
  });
});
