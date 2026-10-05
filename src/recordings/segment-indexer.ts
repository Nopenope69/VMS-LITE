import fs from 'node:fs/promises';
import path from 'node:path';
import { IRecordingRepository } from './repositories/recording.repository.js';
import { parseSegmentFileTime } from './recording-catalog.js';
import { SegmentCompleteWebhookPayload } from './recording.types.js';

const SEGMENT_FILE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d{1,6})?\.mp4$/;

export interface SegmentIndexerOptions {
  repository: IRecordingRepository;
  recordingsRoot: string;
  ingest: (payload: SegmentCompleteWebhookPayload) => Promise<unknown>;
  /** A segment with no newer sibling is complete once it has not been written for this long. */
  quietPeriodMs?: number;
  now?: () => number;
  fsReaddirFn?: (dir: string) => Promise<string[]>;
  fsStatFn?: (filePath: string) => Promise<{ size: number; mtimeMs: number }>;
}

/**
 * Catalogues finished MediaMTX segments by scanning the shared recordings volume.
 *
 * This replaces reliance on MediaMTX's runOnRecordSegmentComplete hook (the official
 * image has no shell or HTTP client to run one) and is self-healing: segments written
 * while the control plane was down are picked up on the next scan instead of becoming
 * uncatalogued files that FIFO rollover can never delete.
 *
 * Per camera it keeps a watermark (start time of the newest handled segment, seeded
 * from the database) so each scan only stats new files.
 */
export class SegmentIndexer {
  private readonly watermarks = new Map<string, number>();
  private readonly quietPeriodMs: number;
  private readonly now: () => number;
  private readonly fsReaddir: (dir: string) => Promise<string[]>;
  private readonly fsStat: (filePath: string) => Promise<{ size: number; mtimeMs: number }>;

  constructor(private readonly opts: SegmentIndexerOptions) {
    this.quietPeriodMs = opts.quietPeriodMs ?? 15_000;
    this.now = opts.now ?? Date.now;
    this.fsReaddir = opts.fsReaddirFn || ((d) => fs.readdir(d));
    this.fsStat = opts.fsStatFn || ((p) => fs.stat(p));
  }

  async scanAll(): Promise<number> {
    const cameras = await this.opts.repository.listAllCameras();
    let indexed = 0;
    for (const camera of cameras) {
      try {
        indexed += await this.scanCamera(camera.id, camera.mediaMtxPath);
      } catch (err) {
        console.warn(`[SegmentIndexer] Scan failed for camera ${camera.id}: ${(err as Error).message}`);
      }
    }
    return indexed;
  }

  async scanCamera(cameraId: string, mediaMtxPath: string): Promise<number> {
    const dir = path.join(this.opts.recordingsRoot, mediaMtxPath);
    let names: string[];
    try {
      names = (await this.fsReaddir(dir)).filter((n) => SEGMENT_FILE.test(n));
    } catch (err: any) {
      if (err.code === 'ENOENT') return 0; // Nothing recorded yet
      throw err;
    }
    names.sort(); // Timestamped names sort chronologically

    if (!this.watermarks.has(cameraId)) {
      const latest = await this.opts.repository.findLatestStartTime(cameraId);
      this.watermarks.set(cameraId, latest ? latest.getTime() : -Infinity);
    }
    const watermark = this.watermarks.get(cameraId)!;

    let indexed = 0;
    for (let i = 0; i < names.length; i++) {
      const start = parseSegmentFileTime(names[i]);
      if (!start || start.getTime() <= watermark) continue;

      const filePath = path.join(dir, names[i]);
      let stat;
      try {
        stat = await this.fsStat(filePath);
      } catch {
        continue; // Removed between readdir and stat
      }

      // The newest file may still be written; MediaMTX flushes a part every second
      const hasNewer = i < names.length - 1;
      if (!hasNewer && this.now() - stat.mtimeMs < this.quietPeriodMs) {
        break;
      }
      if (stat.size === 0) {
        this.watermarks.set(cameraId, start.getTime());
        continue;
      }

      const duration = Math.max(0.1, (stat.mtimeMs - start.getTime()) / 1000);
      try {
        await this.opts.ingest({
          mediaMtxPath,
          segmentPath: filePath,
          duration: Math.round(duration * 1000) / 1000,
          size: stat.size,
          startTime: start.toISOString(),
        });
        indexed++;
      } catch (err) {
        const error = err as Error;
        if (error.name === 'UnknownCameraPathError') {
          // Camera removed
        } else if (error.message.includes('Segment validation failed')) {
          console.warn(`[SegmentIndexer] Segment quarantined for camera ${cameraId}: ${error.message}`);
          this.watermarks.set(cameraId, start.getTime());
          continue;
        } else {
          throw err; // Retry this file next scan; keep the watermark where it is
        }
      }
      this.watermarks.set(cameraId, start.getTime());
    }
    return indexed;
  }

  forgetCamera(cameraId: string): void {
    this.watermarks.delete(cameraId);
  }
}
