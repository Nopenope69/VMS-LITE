/**
 * Camera Health Service (EXT-06)
 *
 * Automated dual-plane background health poller:
 * 1. Network Control Plane: TCP socket handshake latency via net.Socket.
 * 2. Media Plane: MediaMTX stream runtime status and bitrate tracking.
 *
 * Implements bounded concurrency (MAX_CONCURRENT_CAMERA_CHECKS = 5),
 * non-overlapping cycle guards, telemetry warm-up, and deterministic
 * anti-flapping hysteresis with 30-second continuous downtime rules.
 *
 * ARCHITECTURAL INVARIANT:
 * Single active worker instance per appliance. Health polling, in-memory
 * telemetry caching, and failure counters are process-local to eliminate
 * distributed lock and Redis dependencies on budget NVR hardware.
 * Incident history is durably recorded via EventBus events in PostgreSQL.
 */

import net from 'node:net';
import { CameraService, cameraService as defaultCameraService } from '../cameras/camera.service.js';
import { MediaMtxClient, mediaMtxClient as defaultMediaMtx } from '../mediamtx/mediamtx.client.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import {
  CameraHealthEventMetadata,
  CameraHealthStatus,
  CameraHealthSummaryResponse,
  CameraHealthTelemetry,
  IMediaMtxRuntimeAdapter,
  NetworkCheckResult,
} from './health.types.js';

export interface CameraHealthDependencies {
  cameraService?: CameraService;
  mediaMtxClient?: IMediaMtxRuntimeAdapter;
  eventBus?: EventBus;
}

interface CameraInternalState {
  status: CameraHealthStatus;
  consecutiveFailures: number;
  unhealthySince: number | null;
  offlineSince: number | null;
  lastBytes?: number;
  lastTimestamp?: number;
  lastChecked: string | null;
  latencyMs: number | null;
  bitrateKbps: number | null;
  bytesReceived: number;
  networkCheck: NetworkCheckResult;
  reason?: string;
}

export class CameraHealthService {
  private readonly cameraService: CameraService;
  private readonly mediaMtxClient: IMediaMtxRuntimeAdapter;
  private readonly eventBus: EventBus;

  public readonly MAX_CONCURRENT_CAMERA_CHECKS = 5;

  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private cameraStates: Map<string, CameraInternalState> = new Map();
  private unsubscribeCameraDeleted: (() => void) | null = null;

  constructor(deps: CameraHealthDependencies = {}) {
    this.cameraService = deps.cameraService || defaultCameraService;
    this.mediaMtxClient = deps.mediaMtxClient || defaultMediaMtx;
    this.eventBus = deps.eventBus || defaultEventBus;
  }

  /**
   * Pings camera TCP port (default RTSP 554 or HTTP 80).
   * Strict connection timeout with guaranteed socket.destroy() on all completion/error paths.
   */
  async pingTcp(
    host: string,
    port = 554,
    timeoutMs = 2500
  ): Promise<{ reachable: boolean; latencyMs: number | null; error?: string }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const cleanup = (reachable: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        const latency = reachable ? Math.max(1, Date.now() - startTime) : null;
        resolve({ reachable, latencyMs: latency, error });
      };

      socket.setTimeout(timeoutMs);

      socket.once('connect', () => {
        cleanup(true);
      });

      socket.once('timeout', () => {
        cleanup(false, `TCP connection timed out after ${timeoutMs}ms`);
      });

      socket.once('error', (err) => {
        cleanup(false, err.message);
      });

      try {
        socket.connect(port, host);
      } catch (err: any) {
        cleanup(false, err.message);
      }
    });
  }

  /**
   * Evaluates camera health across dual planes (TCP + MediaMTX) and updates state machine.
   */
  async checkCamera(camera: {
    id: string;
    name: string;
    ip?: string | null;
    port?: number | null;
    mediaMtxPath: string;
  }): Promise<CameraHealthTelemetry> {
    const now = Date.now();
    let state = this.cameraStates.get(camera.id);

    if (!state) {
      state = {
        status: 'UNKNOWN',
        consecutiveFailures: 0,
        unhealthySince: null,
        offlineSince: null,
        lastChecked: null,
        latencyMs: null,
        bitrateKbps: null,
        bytesReceived: 0,
        networkCheck: 'NOT_APPLICABLE',
      };
      this.cameraStates.set(camera.id, state);
    }

    // 1. Network Plane: TCP Socket Ping
    let tcpReachable = false;
    let latencyMs: number | null = null;
    let tcpError: string | undefined;
    let networkCheck: NetworkCheckResult = 'NOT_APPLICABLE';

    if (camera.ip) {
      const pingResult = await this.pingTcp(camera.ip, camera.port || 554);
      tcpReachable = pingResult.reachable;
      latencyMs = pingResult.latencyMs;
      tcpError = pingResult.error;
      networkCheck = pingResult.reachable ? 'PASSED' : 'FAILED';
    } else {
      // If no IP configured (e.g. simulated camera, cloud stream, or external path),
      // mark networkCheck as NOT_APPLICABLE and do NOT manufacture a synthetic latency value.
      tcpReachable = true;
      latencyMs = null;
      networkCheck = 'NOT_APPLICABLE';
    }

    // 2. Media Plane: MediaMTX Stream Runtime
    let streamReady = false;
    let bytesReceived = 0;

    try {
      const runtime = await this.mediaMtxClient.getPathRuntime(camera.mediaMtxPath);
      if (runtime) {
        streamReady = runtime.ready;
        bytesReceived = runtime.bytesReceived || 0;
      }
    } catch {
      streamReady = false;
    }

    // 3. Bitrate Math & Warm-up
    let computedBitrate: number | null = null;

    if (state.lastBytes === undefined || state.lastTimestamp === undefined) {
      // First poll cycle: Warm-up baseline
      state.lastBytes = bytesReceived;
      state.lastTimestamp = now;
      computedBitrate = null; // No bitrate on sample 1; do NOT falsely trigger DEGRADED
    } else {
      const deltaBytes = bytesReceived - state.lastBytes;
      const deltaTimeSec = Math.max(0.001, (now - state.lastTimestamp) / 1000);

      if (bytesReceived < state.lastBytes) {
        // Counter reset (MediaMTX restart or stream re-publish)
        state.lastBytes = bytesReceived;
        state.lastTimestamp = now;
        computedBitrate = null;
      } else {
        computedBitrate = Math.round((deltaBytes * 8) / (1000 * deltaTimeSec));
        state.lastBytes = bytesReceived;
        state.lastTimestamp = now;
      }
    }

    // 4. Sample Evaluation
    // Fully healthy criteria: TCP reachable < 500ms (or NOT_APPLICABLE), stream ready, and bitrate > 50kbps (or warm-up sample)
    const isTcpHealthy = networkCheck === 'NOT_APPLICABLE'
      ? true
      : (tcpReachable && latencyMs !== null && latencyMs < 500);
    const isBitrateHealthy = computedBitrate === null || computedBitrate > 50;
    const isSampleFullyHealthy = isTcpHealthy && streamReady && isBitrateHealthy;

    // Degraded sample criteria: TCP reachable/applicable, but high latency, stream not ready, or low bitrate
    const isSampleDegraded = tcpReachable && (!isTcpHealthy || !streamReady || (computedBitrate !== null && computedBitrate <= 50));

    // Offline sample criteria: TCP unreachable (when applicable)
    const isSampleOffline = !tcpReachable && networkCheck !== 'NOT_APPLICABLE';

    let reason: string | undefined;
    if (!tcpReachable && networkCheck !== 'NOT_APPLICABLE') {
      reason = tcpError || 'TCP handshake connection failed';
    } else if (latencyMs !== null && latencyMs >= 500) {
      reason = `High network latency (${latencyMs}ms >= 500ms)`;
    } else if (!streamReady) {
      reason = 'MediaMTX stream path not ready / no video packet feed';
    } else if (computedBitrate !== null && computedBitrate <= 50) {
      reason = `Low stream bitrate (${computedBitrate} kbps <= 50 kbps)`;
    }

    // 5. Deterministic State Machine with Anti-Flapping Hysteresis & 30s Downtime Rule
    const previousStatus = state.status;
    let nextStatus = previousStatus;
    let outageDurationMs: number | null = null;

    if (isSampleFullyHealthy) {
      // 1 healthy sample recovers immediately to ONLINE
      if (state.unhealthySince !== null) {
        outageDurationMs = now - state.unhealthySince;
      }
      state.consecutiveFailures = 0;
      state.unhealthySince = null;
      state.offlineSince = null;
      nextStatus = 'ONLINE';
      reason = undefined;
    } else {
      // Unhealthy sample: increment failure count & timestamp
      state.consecutiveFailures += 1;
      if (state.unhealthySince === null) {
        state.unhealthySince = now;
      }

      if (isSampleOffline) {
        if (state.offlineSince === null) {
          state.offlineSince = now;
        }
        const offlineDowntimeMs = now - state.offlineSince;

        // Continuous disconnection >= 30s AND at least 2 consecutive failure samples (anti-flap)
        if (offlineDowntimeMs >= 30_000 && state.consecutiveFailures >= 2) {
          nextStatus = 'OFFLINE';
        } else if (state.consecutiveFailures >= 2) {
          // While awaiting the 30s continuous downtime threshold, mark DEGRADED to indicate failure
          nextStatus = 'DEGRADED';
        } else {
          // Candidate state (sample 1): wait for hysteresis
          nextStatus = previousStatus;
        }
      } else {
        // TCP is reachable; clear offline disconnection timer
        state.offlineSince = null;

        if (isSampleDegraded) {
          if (state.consecutiveFailures >= 2) {
            nextStatus = 'DEGRADED';
          } else {
            // Candidate state: retain previous status
            nextStatus = previousStatus;
          }
        }
      }
    }

    state.status = nextStatus;
    state.latencyMs = latencyMs;
    state.bitrateKbps = computedBitrate;
    state.bytesReceived = bytesReceived;
    state.lastChecked = new Date(now).toISOString();
    state.networkCheck = networkCheck;
    state.reason = reason;

    // 6. EventBus Emission strictly on transition between operational states
    // (Do NOT emit camera.online if previousStatus was UNKNOWN - that is initial boot discovery, not recovery)
    if (nextStatus !== previousStatus) {
      const isBootOnline = previousStatus === 'UNKNOWN' && nextStatus === 'ONLINE';
      if (!isBootOnline) {
        await this.emitTransitionEvent(camera, nextStatus, previousStatus, state, outageDurationMs);
      }
    }

    return {
      cameraId: camera.id,
      status: state.status,
      latencyMs: state.latencyMs,
      bitrateKbps: state.bitrateKbps,
      bytesReceived: state.bytesReceived,
      lastChecked: state.lastChecked,
      consecutiveFailures: state.consecutiveFailures,
      unhealthySince: state.unhealthySince ? new Date(state.unhealthySince).toISOString() : null,
      networkCheck: state.networkCheck,
      reason: state.reason,
    };
  }

  /**
   * Emits standardized CameraHealthEventMetadata on state transition.
   */
  private async emitTransitionEvent(
    camera: { id: string; name: string },
    newStatus: CameraHealthStatus,
    previousStatus: CameraHealthStatus,
    state: CameraInternalState,
    outageDurationMs?: number | null
  ): Promise<void> {
    const eventType =
      newStatus === 'ONLINE'
        ? 'camera.online'
        : newStatus === 'DEGRADED'
        ? 'camera.degraded'
        : 'camera.offline';

    const severity =
      newStatus === 'ONLINE' ? 'info' : newStatus === 'DEGRADED' ? 'warning' : 'critical';

    const metadata: CameraHealthEventMetadata = {
      cameraId: camera.id,
      cameraName: camera.name,
      status: newStatus,
      previousStatus,
      reason: state.reason,
      latencyMs: state.latencyMs,
      bitrateKbps: state.bitrateKbps,
      consecutiveFailures: state.consecutiveFailures,
      outageDurationMs: outageDurationMs ?? null,
      networkCheck: state.networkCheck,
      timestamp: new Date().toISOString(),
    };

    await this.eventBus.emitEvent<CameraHealthEventMetadata>({
      cameraId: camera.id,
      type: eventType,
      source: 'camera-health.service',
      severity,
      metadata,
    });
  }

  /**
   * Helper to execute asynchronous worker tasks with a fixed concurrency limit.
   */
  private async runWithConcurrencyLimit<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>
  ): Promise<void> {
    const executing: Promise<void>[] = [];
    for (const item of items) {
      const p = Promise.resolve().then(() => fn(item));
      executing.push(p);
      const clean = () => {
        const idx = executing.indexOf(p);
        if (idx !== -1) executing.splice(idx, 1);
      };
      p.then(clean, clean);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);
  }

  /**
   * Runs a complete polling cycle over all active cameras.
   * Prunes cached telemetry for cameras that have been deleted or removed from the database.
   * Skips execution if a cycle is already active (non-overlapping cycle guard).
   */
  async pollAllCameras(): Promise<void> {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;

    try {
      const cameras = await this.cameraService.listCameras();
      // Filter out invalid or disabled cameras without mediaMtxPath
      const activeCameras = cameras.filter((c) => Boolean(c.mediaMtxPath));
      const activeIds = new Set(activeCameras.map((c) => c.id));

      // Prune stale cameras that were deleted or removed from database
      for (const cachedId of this.cameraStates.keys()) {
        if (!activeIds.has(cachedId)) {
          this.cameraStates.delete(cachedId);
        }
      }

      await this.runWithConcurrencyLimit(
        activeCameras,
        this.MAX_CONCURRENT_CAMERA_CHECKS,
        async (camera) => {
          try {
            await this.checkCamera(camera);
          } catch {
            // Individual camera check error does not abort entire batch
          }
        }
      );
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Removes cached telemetry for a camera (e.g. upon camera deletion).
   */
  removeCamera(cameraId: string): void {
    this.cameraStates.delete(cameraId);
  }

  /**
   * Starts background health polling and subscribes to camera deletion events.
   */
  start(intervalMs = 15000): void {
    if (this.pollTimer) {
      return;
    }

    // Subscribe to camera deletion events for immediate cache eviction
    this.unsubscribeCameraDeleted = this.eventBus.subscribe('camera.deleted', (event) => {
      if (event.cameraId) {
        this.removeCamera(event.cameraId);
      }
    });

    // Run first poll asynchronously
    this.pollAllCameras().catch(() => {});

    this.pollTimer = setInterval(() => {
      this.pollAllCameras().catch(() => {});
    }, intervalMs);
  }

  /**
   * Stops background health polling and unsubscribes from event bus.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.unsubscribeCameraDeleted) {
      this.unsubscribeCameraDeleted();
      this.unsubscribeCameraDeleted = null;
    }
    this.isPolling = false;
  }

  /**
   * Returns telemetry for a single camera.
   */
  getTelemetry(cameraId: string): CameraHealthTelemetry | null {
    const state = this.cameraStates.get(cameraId);
    if (!state) return null;
    return {
      cameraId,
      status: state.status,
      latencyMs: state.latencyMs,
      bitrateKbps: state.bitrateKbps,
      bytesReceived: state.bytesReceived,
      lastChecked: state.lastChecked,
      consecutiveFailures: state.consecutiveFailures,
      unhealthySince: state.unhealthySince ? new Date(state.unhealthySince).toISOString() : null,
      networkCheck: state.networkCheck,
      reason: state.reason,
    };
  }

  /**
   * Returns summary response for all cached camera health records.
   */
  getAllTelemetry(): CameraHealthSummaryResponse {
    let onlineCount = 0;
    let degradedCount = 0;
    let offlineCount = 0;
    let unknownCount = 0;
    const cameras: Record<string, CameraHealthTelemetry> = {};

    for (const [id, state] of this.cameraStates.entries()) {
      if (state.status === 'ONLINE') onlineCount++;
      else if (state.status === 'DEGRADED') degradedCount++;
      else if (state.status === 'OFFLINE') offlineCount++;
      else if (state.status === 'UNKNOWN') unknownCount++;

      cameras[id] = {
        cameraId: id,
        status: state.status,
        latencyMs: state.latencyMs,
        bitrateKbps: state.bitrateKbps,
        bytesReceived: state.bytesReceived,
        lastChecked: state.lastChecked,
        consecutiveFailures: state.consecutiveFailures,
        unhealthySince: state.unhealthySince ? new Date(state.unhealthySince).toISOString() : null,
        networkCheck: state.networkCheck,
        reason: state.reason,
      };
    }

    return {
      totalCameras: this.cameraStates.size,
      onlineCount,
      degradedCount,
      offlineCount,
      unknownCount,
      cameras,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Resets all cached states (used in tests).
   */
  reset(): void {
    this.cameraStates.clear();
    this.isPolling = false;
  }
}

export const cameraHealthService = new CameraHealthService();
export default cameraHealthService;
