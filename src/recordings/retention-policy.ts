import { prisma as defaultPrisma } from '../db/prisma.js';
import { IClock, systemClock } from './clock.js';
import { IRecordingRepository } from './repositories/recording.repository.js';
import { RecordingDto } from './recording.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Footage someone or something still needs, whatever its age. */
export interface RetentionHoldSource {
  /** Bookmarks whose timestamp falls within [from, to]. */
  bookmarks(from: Date, to: Date): Promise<Array<{ cameraId: string; timestamp: Date }>>;
  /** Time ranges of exports that are queued or running. */
  activeExports(): Promise<Array<{ cameraId: string; startTime: Date; endTime: Date }>>;
}

export class PrismaRetentionHolds implements RetentionHoldSource {
  constructor(private readonly prisma: any = defaultPrisma) {}

  async bookmarks(from: Date, to: Date) {
    const rows = await this.prisma.bookmark.findMany({ where: { timestamp: { gte: from, lte: to } } });
    return rows.map((b: any) => ({ cameraId: b.cameraId, timestamp: new Date(b.timestamp) }));
  }

  async activeExports() {
    const rows = await this.prisma.exportJob.findMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } } });
    return rows.map((j: any) => ({ cameraId: j.cameraId, startTime: new Date(j.startTime), endTime: new Date(j.endTime) }));
  }
}

export interface RetentionDays {
  continuous: number;
  event: number;
  incident: number;
}

export interface RetentionPolicyOptions {
  repository: IRecordingRepository;
  holds?: RetentionHoldSource;
  clock?: IClock;
  days?: Partial<RetentionDays>;
  /** A bookmark keeps every segment overlapping this many seconds either side of it. */
  bookmarkWindowSeconds?: number;
}

type Window = { cameraId: string; start: number; end: number };

/**
 * Retention Policy: the one place that decides whether a segment may be deleted.
 *
 * - Age: each tier has a lifetime (CONTINUOUS <= EVENT <= INCIDENT; a longer tier never
 *   expires sooner than a shorter one). Quarantined segments age like CONTINUOUS.
 * - Holds, whatever the age or disk pressure: legal hold (isProtected / PROTECTED tier),
 *   bookmarks (+/- the bookmark window) and the time range of queued or running exports.
 *
 * The Storage Controller asks "which of these oldest segments may go"; deletion itself
 * stays with the catalog's two-phase delete.
 */
export class RetentionPolicy {
  private readonly repository: IRecordingRepository;
  private readonly holds: RetentionHoldSource;
  private readonly clock: IClock;
  private readonly bookmarkWindowMs: number;
  private days: RetentionDays;

  constructor(opts: RetentionPolicyOptions) {
    this.repository = opts.repository;
    this.holds = opts.holds || new PrismaRetentionHolds();
    this.clock = opts.clock || systemClock;
    this.bookmarkWindowMs = (opts.bookmarkWindowSeconds ?? 120) * 1000;
    this.days = { continuous: 7, event: 15, incident: 60 };
    this.setDays(opts.days ?? {});
  }

  setDays(days: Partial<RetentionDays>): void {
    const next = { ...this.days, ...days };
    this.days = {
      continuous: Math.max(0, next.continuous),
      event: Math.max(0, next.event),
      incident: Math.max(0, next.incident),
    };
  }

  /** Configured lifetimes, raised so that a longer-lived tier never expires sooner. */
  getDays(): RetentionDays {
    const continuous = this.days.continuous;
    const event = Math.max(this.days.event, continuous);
    return { continuous, event, incident: Math.max(this.days.incident, event) };
  }

  /**
   * Of these candidates, the ones that may be deleted now. `age`: only segments past
   * their tier's lifetime (or `overrideDays`); `capacity`: any segment not on hold.
   */
  async deletable(
    candidates: RecordingDto[],
    mode: 'age' | 'capacity',
    overrideDays?: number
  ): Promise<RecordingDto[]> {
    const now = this.clock.now().getTime();
    const days = this.getDays();
    const lifetimeMs = (s: RecordingDto) =>
      (overrideDays ??
        (s.retentionTier === 'INCIDENT' ? days.incident : s.retentionTier === 'EVENT' ? days.event : days.continuous)) * DAY_MS;

    const unheld = candidates.filter((s) => s.status !== 'BUFFERED' && !this.isLegalHold(s));
    const due = mode === 'age' ? unheld.filter((s) => new Date(s.startTime).getTime() < now - lifetimeMs(s)) : unheld;
    if (due.length === 0) return [];

    const windows = await this.holdWindows(due);
    return due.filter((s) => !this.overlapsAny(s, windows));
  }

  /** Bytes the system will never reclaim on its own (legal holds, bookmarks, exports). */
  async protectedBytes(): Promise<number> {
    const windows = await this.holdWindows();
    const held = await this.repository.findHeldRecordings(
      windows.map((w) => ({ cameraId: w.cameraId, start: new Date(w.start), end: new Date(w.end) }))
    );
    return held.reduce((sum, s) => sum + Number(s.sizeBytes || 0), 0);
  }

  private isLegalHold(s: RecordingDto): boolean {
    return Boolean(s.isProtected) || s.retentionTier === 'PROTECTED';
  }

  /** Bookmark and export windows, limited to the time span of `segments` when given. */
  private async holdWindows(segments?: RecordingDto[]): Promise<Window[]> {
    let from = new Date(0);
    let to = new Date(8.64e15);
    if (segments?.length) {
      from = new Date(Math.min(...segments.map((s) => new Date(s.startTime).getTime())) - this.bookmarkWindowMs);
      to = new Date(Math.max(...segments.map((s) => new Date(s.endTime).getTime())) + this.bookmarkWindowMs);
    }
    const [bookmarks, exports] = await Promise.all([this.holds.bookmarks(from, to), this.holds.activeExports()]);
    return [
      ...bookmarks.map((b) => ({
        cameraId: b.cameraId,
        start: b.timestamp.getTime() - this.bookmarkWindowMs,
        end: b.timestamp.getTime() + this.bookmarkWindowMs,
      })),
      ...exports.map((e) => ({ cameraId: e.cameraId, start: e.startTime.getTime(), end: e.endTime.getTime() })),
    ];
  }

  private overlapsAny(s: RecordingDto, windows: Window[]): boolean {
    const start = new Date(s.startTime).getTime();
    const end = new Date(s.endTime).getTime();
    return windows.some((w) => w.cameraId === s.cameraId && start < w.end && end > w.start);
  }
}
