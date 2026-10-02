import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import {
  EmitEventInput,
  EventQueryFilter,
  EventRecord,
  EventSeverity,
} from './event.types.js';

/**
 * High-frequency operational events that are useful in-process (catalog, ring buffer,
 * webhooks) but would flood the events table: one per camera per segment.
 */
const NON_PERSISTED_EVENT_TYPES = new Set(['recording.segment_created']);

const SECRET_KEY_PATTERN = /pass(word)?|secret|token|credential|api[-_]?key/i;

/**
 * Removes credentials from event metadata before it is stored or broadcast:
 * secret-looking keys are dropped and user:password@ is stripped from URLs.
 */
export function scrubSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') {
    return value.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/gi, '$1');
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubSecrets(v, depth + 1));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      out[k] = scrubSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

export class EventBus extends EventEmitter {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {
    super();
    // Allow up to 100 concurrent event listeners without warning
    this.setMaxListeners(100);
  }

  /**
   * Dispatches an event to in-process listeners and persists it to PostgreSQL.
   */
  async emitEvent<T = Record<string, unknown>>(
    input: EmitEventInput<T>
  ): Promise<EventRecord<T>> {
    const timestamp = input.timestamp
      ? new Date(input.timestamp)
      : new Date();
    const severity: EventSeverity = input.severity ?? 'info';
    const metadata = scrubSecrets(input.metadata ?? {}) as Record<string, unknown>;

    let record: EventRecord<T>;

    try {
      if (NON_PERSISTED_EVENT_TYPES.has(input.type)) {
        throw new Error('not persisted');
      }
      const created = await this.prisma.event.create({
        data: {
          cameraId: input.cameraId ?? null,
          timestamp,
          type: input.type,
          source: input.source,
          severity,
          metadata: metadata as any,
        },
      });

      record = {
        id: created.id,
        cameraId: created.cameraId,
        timestamp: created.timestamp,
        type: created.type,
        source: created.source,
        severity: created.severity as EventSeverity,
        metadata: created.metadata as T,
        createdAt: created.createdAt,
      };
    } catch (err) {
      // Not persisted by design, or the database is unavailable: still deliver in-process
      record = {
        id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        cameraId: input.cameraId ?? null,
        timestamp,
        type: input.type,
        source: input.source,
        severity,
        metadata: metadata as T,
        createdAt: new Date(),
      };
    }

    // Broadcast on wildcards and specific type
    this.emit('*', record);
    this.emit(input.type, record);

    return record;
  }

  /**
   * Subscribes to events of a specific type (or '*' for all events).
   */
  subscribe<T = Record<string, unknown>>(
    eventType: string,
    listener: (event: EventRecord<T>) => unknown
  ): () => void {
    // A throwing or rejecting subscriber must neither break the emitter nor surface
    // as an unhandled rejection (which terminates Node).
    const safeListener = (event: EventRecord<T>) => {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          result.catch((err) => this.reportListenerError(eventType, err));
        }
      } catch (err) {
        this.reportListenerError(eventType, err);
      }
    };
    this.on(eventType, safeListener);
    return () => {
      this.off(eventType, safeListener);
    };
  }

  private reportListenerError(eventType: string, err: unknown): void {
    console.error(`[EventBus] Subscriber for '${eventType}' failed:`, (err as Error)?.message ?? err);
  }

  /**
   * Deletes persisted events older than the given number of days.
   */
  async pruneOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.prisma.event.deleteMany({ where: { timestamp: { lt: cutoff } } });
    return result.count;
  }

  /**
   * Queries stored events with flexible filtering and pagination.
   */
  async queryEvents(filter: EventQueryFilter = {}): Promise<EventRecord[]> {
    const where: any = {};

    if (filter.type) {
      where.type = filter.type;
    }
    if (filter.cameraId) {
      where.cameraId = filter.cameraId;
    } else if (filter.cameraIds) {
      where.cameraId = { in: filter.cameraIds };
    }
    if (filter.since) {
      where.timestamp = {
        gte: new Date(filter.since),
      };
    }

    try {
      const events = await this.prisma.event.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: Math.min(Math.max(filter.limit ?? 50, 1), 500),
        skip: Math.max(filter.offset ?? 0, 0),
      });

      return events.map((e) => ({
        id: e.id,
        cameraId: e.cameraId,
        timestamp: e.timestamp,
        type: e.type,
        source: e.source,
        severity: e.severity as EventSeverity,
        metadata: e.metadata as Record<string, unknown>,
        createdAt: e.createdAt,
      }));
    } catch (err) {
      return [];
    }
  }
}

export const eventBus = new EventBus();
export default eventBus;
