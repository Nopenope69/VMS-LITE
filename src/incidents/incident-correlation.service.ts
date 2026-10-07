import { PrismaClient, IncidentSeverity, IncidentStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';

export interface CreateIncidentInput {
  title: string;
  description?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  siteId?: string | null;
  primaryCameraId?: string | null;
  startTime: Date;
  endTime: Date;
  createdById?: string | null;
  createdSource?: string;
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
}

export class IncidentCorrelationService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly eventBus: EventBus = defaultEventBus
  ) {}

  /**
   * Creates an incident aggregate, correlates multi-sensor events within the temporal window,
   * links overlapping recording segments, and locks them under the INCIDENT retention tier.
   */
  async createIncident(input: CreateIncidentInput) {
    const severity = input.severity || IncidentSeverity.MEDIUM;
    const status = input.status || IncidentStatus.OPEN;

    const incident = await this.prisma.incident.create({
      data: {
        title: input.title,
        description: input.description,
        severity,
        status,
        siteId: input.siteId ?? null,
        primaryCameraId: input.primaryCameraId ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
        createdById: input.createdById ?? null,
        createdSource: input.createdSource || 'manual',
      },
    });

    // 1. Correlate and link physical/operational events in the window
    const eventWhere: any = {
      timestamp: {
        gte: input.startTime,
        lte: input.endTime,
      },
    };
    if (input.primaryCameraId) {
      eventWhere.OR = [
        { cameraId: input.primaryCameraId },
        input.siteId ? { siteId: input.siteId } : {},
      ];
    } else if (input.siteId) {
      eventWhere.siteId = input.siteId;
    }

    const events = await this.prisma.event.findMany({
      where: eventWhere,
      take: 100,
    });

    for (const evt of events) {
      await this.prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          eventId: evt.id,
        },
      }).catch(() => {}); // Unique constraint safe
    }

    // 2. Correlate and lock recording segments within the incident window
    const recordingWhere: any = {
      startTime: { lt: input.endTime },
      endTime: { gt: input.startTime },
    };
    if (input.primaryCameraId) {
      recordingWhere.cameraId = input.primaryCameraId;
    }

    const overlappingRecordings = await this.prisma.recording.findMany({
      where: recordingWhere,
      take: 100,
    });

    for (const rec of overlappingRecordings) {
      await this.prisma.incidentRecording.create({
        data: {
          incidentId: incident.id,
          recordingId: rec.id,
        },
      }).catch(() => {});

      // Incident footage is kept for the INCIDENT tier's lifetime; a permanent legal hold
      // (isProtected) is a person's decision, not an automatic one
      await this.prisma.recording.update({
        where: { id: rec.id },
        data: {
          retentionTier: 'INCIDENT',
          protectionReason: `Incident #${incident.incidentNumber}: ${incident.title}`,
        },
      }).catch(() => {});
    }

    await this.eventBus.emitEvent({
      type: 'incident.created',
      source: 'incident.service',
      siteId: input.siteId ?? null,
      metadata: {
        incidentId: incident.id,
        incidentNumber: incident.incidentNumber,
        title: incident.title,
        severity: incident.severity,
        eventsCount: events.length,
        recordingsCount: overlappingRecordings.length,
        startTime: incident.startTime.toISOString(),
        endTime: incident.endTime.toISOString(),
      },
    });

    return {
      ...incident,
      events,
      recordings: overlappingRecordings,
    };
  }

  async getIncident(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
    });
    if (!incident) return null;

    const incidentRecordings = await this.prisma.incidentRecording.findMany({
      where: { incidentId: id },
    });
    const recordingIds = incidentRecordings.map((ir) => ir.recordingId);

    const recordings = await this.prisma.recording.findMany({
      where: { id: { in: recordingIds } },
    });

    const incidentEvents = await this.prisma.incidentEvent.findMany({
      where: { incidentId: id },
    });
    const eventIds = incidentEvents.map((ie) => ie.eventId);

    const events = await this.prisma.event.findMany({
      where: { id: { in: eventIds } },
    });

    return {
      ...incident,
      recordings,
      events,
    };
  }

  async listIncidents(params: {
    siteId?: string;
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    limit?: number;
  } = {}) {
    const where: any = {};
    if (params.siteId) where.siteId = params.siteId;
    if (params.status) where.status = params.status;
    if (params.severity) where.severity = params.severity;

    return this.prisma.incident.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: params.limit ?? 50,
    });
  }

  async updateIncident(id: string, updates: UpdateIncidentInput) {
    const updated = await this.prisma.incident.update({
      where: { id },
      data: updates,
    });

    await this.eventBus.emitEvent({
      type: 'incident.updated',
      source: 'incident.service',
      metadata: {
        incidentId: id,
        ...updates,
      },
    });

    return updated;
  }
}

export const incidentCorrelationService = new IncidentCorrelationService();
