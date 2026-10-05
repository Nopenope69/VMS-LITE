export interface DiagnosticLogContext {
  camera?: string;
  stream?: 'primary' | 'sub' | string;
  operation:
    | 'rtsp_read'
    | 'segment_write'
    | 'segment_index'
    | 'fsync'
    | 'unlink'
    | 'statfs'
    | 'db_query'
    | 'retention_purge'
    | 'canary_probe'
    | 'invariant_audit'
    | string;
  durationMs?: number;
  reason?: string;
  recordingId?: string;
  path?: string;
  bytes?: number;
  error?: Error | string;
  level?: 'info' | 'warn' | 'error';
  metadata?: Record<string, any>;
}

export interface DiagnosticsLoggerOptions {
  slowThresholds?: Record<string, number>;
  maxHistory?: number;
  enableConsole?: boolean;
}

const DEFAULT_SLOW_THRESHOLDS: Record<string, number> = {
  fsync: 1000,
  segment_write: 2000,
  unlink: 500,
  statfs: 200,
  db_query: 500,
  canary_probe: 1000,
  segment_index: 3000,
};

/**
 * High-context operational diagnostics logger inspired by Moonfire NVR.
 * Formats events with rich operational context (camera, stream, duration, reason, path)
 * and proactively warns on slow storage or I/O operations.
 */
export class DiagnosticsLogger {
  private readonly slowThresholds: Record<string, number>;
  private readonly maxHistory: number;
  private readonly enableConsole: boolean;
  private readonly history: DiagnosticLogContext[] = [];

  constructor(options: DiagnosticsLoggerOptions = {}) {
    this.slowThresholds = { ...DEFAULT_SLOW_THRESHOLDS, ...(options.slowThresholds || {}) };
    this.maxHistory = options.maxHistory ?? 1000;
    this.enableConsole = options.enableConsole ?? (process.env.NODE_ENV !== 'test');
  }

  logOperation(ctx: DiagnosticLogContext): DiagnosticLogContext {
    let level = ctx.level || 'info';

    // Auto-escalate to warn if duration exceeds slow operation threshold
    if (ctx.durationMs !== undefined) {
      const threshold = this.slowThresholds[ctx.operation];
      if (threshold && ctx.durationMs >= threshold && level === 'info') {
        level = 'warn';
        if (!ctx.reason) ctx.reason = 'slow_io_threshold_exceeded';
      }
    }

    if (ctx.error) {
      level = 'error';
    }

    const enriched: DiagnosticLogContext = {
      ...ctx,
      level,
    };

    this.history.push(enriched);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    if (this.enableConsole) {
      const parts: string[] = [`[DIAGNOSTICS] [${level.toUpperCase()}]`];
      if (enriched.camera) parts.push(`camera=${enriched.camera}`);
      if (enriched.stream) parts.push(`stream=${enriched.stream}`);
      parts.push(`operation=${enriched.operation}`);
      if (enriched.durationMs !== undefined) parts.push(`durationMs=${enriched.durationMs}`);
      if (enriched.reason) parts.push(`reason=${enriched.reason}`);
      if (enriched.recordingId) parts.push(`recordingId=${enriched.recordingId}`);
      if (enriched.path) parts.push(`path=${enriched.path}`);
      if (enriched.bytes !== undefined) parts.push(`bytes=${enriched.bytes}`);
      if (enriched.error) {
        const errMsg = enriched.error instanceof Error ? enriched.error.message : String(enriched.error);
        parts.push(`error="${errMsg}"`);
      }

      const line = parts.join(' ');
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    }

    return enriched;
  }

  getRecentLogs(limit = 100): DiagnosticLogContext[] {
    return this.history.slice(-limit);
  }

  clearHistory(): void {
    this.history.length = 0;
  }
}

export const diagnosticsLogger = new DiagnosticsLogger();
