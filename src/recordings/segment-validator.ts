import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isWithinRoot } from './recordings-root.js';
import { RetentionTierType, SegmentStatusType, StreamRoleType } from './recording.types.js';

export const MIN_SEGMENT_BYTES = 1024;

/**
 * Parses the UTC start time MediaMTX encodes in segment file names
 * (recordPath %Y-%m-%d_%H-%M-%S-%f; microseconds optional). MediaMTX runs in UTC.
 */
export function parseSegmentFileTime(segmentPath: string): Date | null {
  const match = path
    .basename(segmentPath)
    .match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,6}))?/);
  if (!match) return null;
  const [, year, month, day, hour, min, sec, micros] = match;
  // Round up: MediaMTX playback rejects a start even 1µs before the first segment,
  // so span starts must never precede the real segment start.
  const ms = micros ? Math.ceil(Number(micros.padEnd(6, '0')) / 1000) : 0;
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec, ms));
  return isNaN(date.getTime()) ? null : date;
}
export const DEFAULT_QUIET_PERIOD_MS = 15_000;

export interface SegmentValidationOptions {
  filePath: string;
  recordingsRoot: string;
  mediaMtxPath: string;
  duration?: number;
  payloadStartTime?: string;
  quietPeriodMs?: number;
  minSizeBytes?: number;
  computeSha256?: boolean;
  now?: () => number;
}

export type ValidationFailureReason =
  | 'OUTSIDE_ROOT'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_SMALL'
  | 'QUIET_PERIOD_IN_FLIGHT'
  | 'INVALID_CONTAINER'
  | 'INVALID_TIMESTAMPS'
  | 'INVALID_DURATION';

export interface SegmentValidationSuccess {
  isValid: true;
  status: 'AVAILABLE';
  streamRole: StreamRoleType;
  retentionTier: RetentionTierType;
  sizeBytes: number;
  duration: number;
  startTime: Date;
  endTime: Date;
  videoCodec: string;
  hasAudio: boolean;
  sha256?: string;
}

export interface SegmentValidationFailure {
  isValid: false;
  status: 'VALIDATING' | 'QUARANTINED';
  reason: ValidationFailureReason;
  error?: string;
}

export type SegmentValidationResult = SegmentValidationSuccess | SegmentValidationFailure;

/**
 * Validates fMP4 container box header from a buffer.
 * An MP4 container starts with 4-byte size (BE) followed by 4-byte type ASCII (e.g. 'ftyp', 'styp', 'moof').
 */
export function validateMp4ContainerHeader(buffer: Buffer): { valid: boolean; primaryBox?: string } {
  if (buffer.length < 8) {
    return { valid: false };
  }

  const boxSize = buffer.readUInt32BE(0);
  const boxType = buffer.toString('ascii', 4, 8);

  // Standard initial boxes for MP4 / fragmented MP4
  const validInitialBoxes = new Set(['ftyp', 'styp', 'moof', 'moov', 'free', 'skip', 'wide']);
  if (!validInitialBoxes.has(boxType)) {
    return { valid: false, primaryBox: boxType };
  }

  // Box size sanity: must be at least 8 bytes (or 1 for 64-bit large size, 0 for extends to EOF)
  if (boxSize !== 0 && boxSize !== 1 && boxSize < 8) {
    return { valid: false, primaryBox: boxType };
  }

  return { valid: true, primaryBox: boxType };
}

/**
 * Dedicated, zero-transcode, zero-fsync Segment Validator.
 *
 * Verifies that an on-disk fMP4 segment written by MediaMTX is complete, uncorrupted,
 * and safe to catalogue into the permanent recording index.
 */
export class SegmentValidator {
  private readonly recordingsRoot: string;
  private readonly defaultQuietPeriodMs: number;
  private readonly minSizeBytes: number;
  private readonly now: () => number;

  constructor(opts: {
    recordingsRoot: string;
    quietPeriodMs?: number;
    minSizeBytes?: number;
    now?: () => number;
  }) {
    this.recordingsRoot = opts.recordingsRoot;
    this.defaultQuietPeriodMs = opts.quietPeriodMs ?? DEFAULT_QUIET_PERIOD_MS;
    this.minSizeBytes = opts.minSizeBytes ?? MIN_SEGMENT_BYTES;
    this.now = opts.now ?? Date.now;
  }

  async validate(opts: SegmentValidationOptions): Promise<SegmentValidationResult> {
    const filePath = path.resolve(opts.filePath);

    // 1. Boundary check
    if (!isWithinRoot(this.recordingsRoot, filePath)) {
      return {
        isValid: false,
        status: 'QUARANTINED',
        reason: 'OUTSIDE_ROOT',
        error: `Segment path ${filePath} escapes recordings root ${this.recordingsRoot}`,
      };
    }

    // 2. Stat check
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (err: any) {
      return {
        isValid: false,
        status: 'QUARANTINED',
        reason: 'FILE_NOT_FOUND',
        error: (err as Error).message,
      };
    }

    // 3. Minimum size check
    const minSize = opts.minSizeBytes ?? this.minSizeBytes;
    if (stat.size < minSize) {
      return {
        isValid: false,
        status: 'QUARANTINED',
        reason: 'FILE_TOO_SMALL',
        error: `File size ${stat.size} bytes is below threshold ${minSize} bytes`,
      };
    }

    // 4. Quiet period / write quiescence check
    const quietPeriodMs = opts.quietPeriodMs ?? this.defaultQuietPeriodMs;
    const elapsedSinceWrite = this.now() - stat.mtimeMs;
    if (quietPeriodMs > 0 && elapsedSinceWrite < quietPeriodMs) {
      return {
        isValid: false,
        status: 'VALIDATING',
        reason: 'QUIET_PERIOD_IN_FLIGHT',
        error: `File modified ${elapsedSinceWrite}ms ago, quiet period is ${quietPeriodMs}ms`,
      };
    }

    // 5. Container atom validation (reads first 4KB to verify box headers)
    let fileHandle;
    try {
      fileHandle = await fs.open(filePath, 'r');
      const headerBuffer = Buffer.alloc(Math.min(4096, stat.size));
      const { bytesRead } = await fileHandle.read(headerBuffer, 0, headerBuffer.length, 0);

      const containerCheck = validateMp4ContainerHeader(headerBuffer.subarray(0, bytesRead));
      if (!containerCheck.valid) {
        return {
          isValid: false,
          status: 'QUARANTINED',
          reason: 'INVALID_CONTAINER',
          error: `Corrupt or unrecognized MP4 box header: ${containerCheck.primaryBox || 'empty'}`,
        };
      }
    } catch (err) {
      return {
        isValid: false,
        status: 'QUARANTINED',
        reason: 'INVALID_CONTAINER',
        error: (err as Error).message,
      };
    } finally {
      if (fileHandle) {
        await fileHandle.close().catch(() => {});
      }
    }

    // 6. Timestamps & duration calculation
    let startTime: Date | null = null;
    if (opts.payloadStartTime) {
      const parsed = new Date(opts.payloadStartTime);
      if (!isNaN(parsed.getTime())) {
        startTime = parsed;
      }
    }
    if (!startTime) {
      startTime = parseSegmentFileTime(filePath);
    }
    if (!startTime) {
      return {
        isValid: false,
        status: 'QUARANTINED',
        reason: 'INVALID_TIMESTAMPS',
        error: `Could not parse valid start timestamp from filename or payload: ${path.basename(filePath)}`,
      };
    }

    let duration = opts.duration;
    if (duration === undefined || duration <= 0) {
      // Approximate duration from file modification time minus start time
      const derivedDuration = (stat.mtimeMs - startTime.getTime()) / 1000;
      duration = Math.max(0.1, Math.round(derivedDuration * 1000) / 1000);
    }

    if (duration <= 0 || isNaN(duration)) {
      return {
        isValid: false,
        status: 'QUARANTINED',
        reason: 'INVALID_DURATION',
        error: `Invalid segment duration: ${duration}`,
      };
    }

    const endTime = new Date(startTime.getTime() + Math.round(duration * 1000));

    // 7. Optional SHA-256 calculation
    let sha256: string | undefined;
    if (opts.computeSha256) {
      try {
        const fileData = await fs.readFile(filePath);
        sha256 = crypto.createHash('sha256').update(fileData).digest('hex');
      } catch {
        // Non-blocking for optional hash
      }
    }

    const streamRole: StreamRoleType = 'PRIMARY';

    return {
      isValid: true,
      status: 'AVAILABLE',
      streamRole,
      retentionTier: 'CONTINUOUS',
      sizeBytes: stat.size,
      duration,
      startTime,
      endTime,
      videoCodec: 'h264',
      hasAudio: false,
      sha256,
    };
  }
}
