import { prisma } from '../db/prisma.js';
import {
  CameraConnectionParams,
  CameraPreset,
  ICameraProvider,
  PtzMoveParams,
} from '../cameras/camera-provider.interface.js';
import { onvifCameraProvider } from '../cameras/onvif.provider.js';

export interface PtzVelocity {
  x?: number; // Pan: -1.0 to 1.0
  y?: number; // Tilt: -1.0 to 1.0
  z?: number; // Zoom: -1.0 to 1.0
}

export class CameraNotFoundError extends Error {
  statusCode = 404;
  constructor(cameraId: string) {
    super(`Camera with id '${cameraId}' not found`);
    this.name = 'CameraNotFoundError';
  }
}

export class PtzNotSupportedError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PtzNotSupportedError';
  }
}

export class PtzService {
  private readonly provider: ICameraProvider;
  private readonly watchdogTimeoutMs: number;
  private activeWatchdogs: Map<string, NodeJS.Timeout> = new Map();

  constructor(provider: ICameraProvider = onvifCameraProvider, watchdogTimeoutMs = 1500) {
    this.provider = provider;
    this.watchdogTimeoutMs = watchdogTimeoutMs;
  }

  /**
   * Clears any active watchdog timer for the given camera.
   */
  public clearWatchdog(cameraId: string): void {
    const existing = this.activeWatchdogs.get(cameraId);
    if (existing) {
      clearTimeout(existing);
      this.activeWatchdogs.delete(cameraId);
    }
  }

  /**
   * Retrieves connection parameters for a registered camera.
   */
  private async getConnectionParams(cameraId: string): Promise<{ params: CameraConnectionParams; profileToken?: string }> {
    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
    });

    if (!camera) {
      throw new CameraNotFoundError(cameraId);
    }

    if (!camera.onvifUrl && !camera.ip) {
      throw new PtzNotSupportedError(`Camera '${camera.name}' does not have ONVIF network settings configured`);
    }

    const params: CameraConnectionParams = {
      xaddr: camera.onvifUrl || undefined,
      ip: camera.ip || undefined,
      port: camera.port || undefined,
      username: camera.username || undefined,
      password: camera.password || undefined,
    };

    return {
      params,
      profileToken: camera.profileToken || undefined,
    };
  }

  /**
   * Commands continuous camera movement and starts a 1.5-second safety watchdog.
   */
  async move(cameraId: string, velocity: PtzVelocity): Promise<{ success: boolean; moving: boolean }> {
    const { params, profileToken } = await this.getConnectionParams(cameraId);

    // Cancel existing watchdog to reset the safety window
    this.clearWatchdog(cameraId);

    // Clamp speed values to [-1.0, 1.0]
    const clampedSpeed = {
      x: Math.max(-1, Math.min(1, velocity.x ?? 0)),
      y: Math.max(-1, Math.min(1, velocity.y ?? 0)),
      z: Math.max(-1, Math.min(1, velocity.z ?? 0)),
    };

    const moveParams: PtzMoveParams = {
      speed: clampedSpeed,
      timeout: 2, // hardware timeout safety buffer
    };

    await this.provider.ptzMove(params, moveParams, profileToken);

    // Schedule 1500ms safety watchdog auto-stop (Threat T-09-01)
    const timer = setTimeout(async () => {
      try {
        await this.stop(cameraId);
      } catch (err) {
        // Watchdog background stop error suppressed to avoid crashing process
      } finally {
        this.activeWatchdogs.delete(cameraId);
      }
    }, this.watchdogTimeoutMs);

    this.activeWatchdogs.set(cameraId, timer);

    return { success: true, moving: true };
  }

  /**
   * Halts active PTZ movement and cancels watchdog.
   */
  async stop(cameraId: string): Promise<{ success: boolean; moving: boolean }> {
    this.clearWatchdog(cameraId);
    const { params, profileToken } = await this.getConnectionParams(cameraId);
    await this.provider.ptzStop(params, profileToken);
    return { success: true, moving: false };
  }

  /**
   * Retrieves stored camera presets.
   */
  async getPresets(cameraId: string): Promise<CameraPreset[]> {
    const { params, profileToken } = await this.getConnectionParams(cameraId);
    return this.provider.getPresets(params, profileToken);
  }

  /**
   * Commands camera to navigate to a saved preset position.
   */
  async gotoPreset(cameraId: string, presetToken: string): Promise<{ success: boolean; presetToken: string }> {
    const { params, profileToken } = await this.getConnectionParams(cameraId);
    await this.provider.gotoPreset(params, presetToken, profileToken);
    return { success: true, presetToken };
  }

  /**
   * Saves current camera coordinates as a named preset.
   */
  async setPreset(cameraId: string, presetName: string): Promise<{ success: boolean; token: string; name: string }> {
    const { params, profileToken } = await this.getConnectionParams(cameraId);
    const token = await this.provider.setPreset(params, presetName, profileToken);
    return { success: true, token, name: presetName };
  }

  /**
   * Deletes a camera preset.
   */
  async removePreset(cameraId: string, presetToken: string): Promise<{ success: boolean }> {
    const { params, profileToken } = await this.getConnectionParams(cameraId);
    await this.provider.removePreset(params, presetToken, profileToken);
    return { success: true };
  }

  /**
   * Checks if an active watchdog timer is currently running for a camera.
   */
  hasActiveWatchdog(cameraId: string): boolean {
    return this.activeWatchdogs.has(cameraId);
  }

  /**
   * Cleans up all active timers on service shutdown.
   */
  destroy(): void {
    for (const timer of this.activeWatchdogs.values()) {
      clearTimeout(timer);
    }
    this.activeWatchdogs.clear();
  }
}

export const ptzService = new PtzService();
export default ptzService;
