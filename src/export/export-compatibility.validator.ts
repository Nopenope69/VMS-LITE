import fs from 'node:fs/promises';
import { ExportCompatibilityResult } from './export.types.js';

export interface SegmentInfo {
  filePath: string;
  format?: string;
  codec?: string;
  resolution?: string;
  [key: string]: any;
}

export interface CompatibilityValidatorOptions {
  checkFileExists?: (filePath: string) => Promise<boolean>;
}

/**
 * Validates that candidate recording segments are compatible for zero-transcode stream copy (-c copy).
 *
 * Deterministically rejects incompatible segments (e.g., codec change, resolution shift, missing files)
 * with an INCOMPATIBLE_SEGMENTS error rather than silently triggering heavy transcoding.
 */
export class ExportCompatibilityValidator {
  private readonly checkFileExists: (filePath: string) => Promise<boolean>;

  constructor(opts: CompatibilityValidatorOptions = {}) {
    this.checkFileExists =
      opts.checkFileExists ||
      (async (p: string) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      });
  }

  async validate(segments: SegmentInfo[]): Promise<ExportCompatibilityResult> {
    if (!segments || segments.length === 0) {
      return {
        compatible: false,
        errorCode: 'NO_RECORDINGS_FOUND',
        message: 'No recording segments provided for export validation',
      };
    }

    // 1. Verify existence of all segment files
    for (const seg of segments) {
      const exists = await this.checkFileExists(seg.filePath);
      if (!exists) {
        return {
          compatible: false,
          errorCode: 'INCOMPATIBLE_SEGMENTS',
          message: `Recording segment file not found on disk: ${seg.filePath}`,
        };
      }
    }

    // 2. Check format consistency
    const firstFormat = (segments[0].format || 'fmp4').toLowerCase();
    for (let i = 1; i < segments.length; i++) {
      const segFormat = (segments[i].format || 'fmp4').toLowerCase();
      if (segFormat !== firstFormat) {
        return {
          compatible: false,
          errorCode: 'INCOMPATIBLE_SEGMENTS',
          message: `Incompatible container formats in recording stream: '${firstFormat}' vs '${segFormat}'`,
        };
      }
    }

    // 3. Check codec consistency (if provided in metadata)
    const firstCodec = segments[0].codec?.toLowerCase();
    if (firstCodec) {
      for (let i = 1; i < segments.length; i++) {
        const segCodec = segments[i].codec?.toLowerCase();
        if (segCodec && segCodec !== firstCodec) {
          return {
            compatible: false,
            errorCode: 'INCOMPATIBLE_SEGMENTS',
            message: `Incompatible video codecs across segments: '${firstCodec}' vs '${segCodec}'. Stream copy concat is disallowed.`,
          };
        }
      }
    }

    // 4. Check resolution consistency (if provided in metadata)
    const firstResolution = segments[0].resolution;
    if (firstResolution) {
      for (let i = 1; i < segments.length; i++) {
        const segResolution = segments[i].resolution;
        if (segResolution && segResolution !== firstResolution) {
          return {
            compatible: false,
            errorCode: 'INCOMPATIBLE_SEGMENTS',
            message: `Incompatible video resolution switch across segments: '${firstResolution}' to '${segResolution}'. Stream copy concat is disallowed.`,
          };
        }
      }
    }

    return {
      compatible: true,
    };
  }
}

export const exportCompatibilityValidator = new ExportCompatibilityValidator();
