import crypto from 'node:crypto';
import net from 'node:net';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import { MediaMtxClient, mediaMtxClient as defaultMediaMtx } from '../mediamtx/mediamtx.client.js';
import {
  CameraDeviceDetails,
  DiscoveredCamera,
  ICameraProvider,
} from './camera-provider.interface.js';
import { onvifCameraProvider as defaultProvider } from './onvif.provider.js';
import {
  CameraResponseDto,
  CameraDto,
  CreateCameraDto,
  ManualCameraInput,
  OnboardCameraInput,
  CommitCameraInput,
} from './camera.types.js';

const PREVIEW_TTL_MS = 10 * 60 * 1000;

export class LicenseLimitExceededError extends Error {
  public readonly code = 'LICENSE_LIMIT_EXCEEDED';
  public readonly cameraLimit: number;

  constructor(message: string, cameraLimit: number) {
    super(message);
    this.name = 'LicenseLimitExceededError';
    this.cameraLimit = cameraLimit;
  }
}

export interface CameraServiceDependencies {
  provider?: ICameraProvider;
  mediaMtx?: MediaMtxClient;
  eventBus?: EventBus;
  prisma?: PrismaClient;
}

export class CameraService {
  private readonly provider: ICameraProvider;
  private readonly mediaMtx: MediaMtxClient;
  private readonly eventBus: EventBus;
  private readonly prisma: PrismaClient;

  constructor(
    depsOrPrisma: CameraServiceDependencies | PrismaClient | any = {},
    mediaMtx?: MediaMtxClient,
    eventBus?: EventBus,
    provider?: ICameraProvider
  ) {
    if (depsOrPrisma && ('$connect' in depsOrPrisma || 'camera' in depsOrPrisma)) {
      this.prisma = depsOrPrisma as PrismaClient;
      this.mediaMtx = mediaMtx || defaultMediaMtx;
      this.eventBus = eventBus || defaultEventBus;
      this.provider = provider || defaultProvider;
    } else {
      const deps = (depsOrPrisma || {}) as CameraServiceDependencies;
      this.provider = deps.provider || defaultProvider;
      this.mediaMtx = deps.mediaMtx || defaultMediaMtx;
      this.eventBus = deps.eventBus || defaultEventBus;
      this.prisma = deps.prisma || defaultPrisma;
    }
  }

  /**
   * Probe camera network reachability and measure round-trip TCP handshake latency (Step 3).
   */
  async probeNetwork(
    ip: string,
    port = 554,
    timeoutMs = 2500
  ): Promise<{ reachable: boolean; latencyMs: number | null; error?: string }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = net.createConnection({ host: ip, port });
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve({ reachable: false, latencyMs: null, error: `Connection timed out after ${timeoutMs}ms` });
        }
      }, timeoutMs);

      socket.on('connect', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          const latencyMs = Date.now() - start;
          socket.destroy();
          resolve({ reachable: true, latencyMs });
        }
      });

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          socket.destroy();
          resolve({ reachable: false, latencyMs: null, error: err.message });
        }
      });
    });
  }

  /**
   * Probe ONVIF camera credentials and resolve video stream profiles (Step 2).
   */
  async probeAuthAndProfiles(params: {
    ip: string;
    port?: number;
    username?: string;
    password?: string;
    xaddr?: string;
  }): Promise<{
    authenticated: boolean;
    device: Partial<CameraDeviceDetails>;
    profiles: any[];
  }> {
    const connectionParams = {
      ip: params.ip,
      port: params.port ?? 80,
      username: params.username,
      password: params.password,
      xaddr: params.xaddr,
    };

    const device = await this.provider.getDeviceInformation(connectionParams).catch(() => ({}));
    const profiles = await this.provider.getProfiles(connectionParams);
    if (!profiles || profiles.length === 0) {
      throw new Error(`Authentication succeeded but no stream profiles found on camera at ${params.ip}`);
    }

    return {
      authenticated: true,
      device,
      profiles,
    };
  }

  /**
   * Provisions a temporary preview path in MediaMTX and polls for readiness (Step 4 & 5).
   */
  async provisionPreviewPath(
    rtspUrl: string,
    pathPrefix = 'preview'
  ): Promise<{
    pathName: string;
    ready: boolean;
    whepUrl: string;
    warning?: string;
  }> {
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const pathName = `${pathPrefix}_${randomSuffix}`;

    await this.mediaMtx.addPath(pathName, rtspUrl, { record: false });

    // Previews are transient: remove automatically if the wizard is abandoned
    const expiry = setTimeout(() => {
      this.teardownPreviewPath(pathName).catch(() => {});
    }, PREVIEW_TTL_MS);
    expiry.unref?.();

    // Poll MediaMTX for up to 5 seconds to verify stream readiness
    let ready = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const state = await this.mediaMtx.getPath(pathName).catch(() => null);
      if (state && state.ready) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    const whepUrl = `/api/media/whep/${pathName}/whep`;

    return {
      pathName,
      ready,
      whepUrl,
      warning: ready
        ? undefined
        : 'Stream source configured in media plane, waiting for first keyframe.',
    };
  }

  /**
   * Cleans up a temporary preview path from MediaMTX.
   */
  async teardownPreviewPath(pathName: string): Promise<void> {
    if (!pathName || !pathName.startsWith('preview_')) return;
    await this.mediaMtx.removePath(pathName).catch(() => {});
  }

  /**
   * Directly creates and provisions a camera with dual-stream support.
   */
  async createCamera(dto: CreateCameraDto): Promise<CameraDto> {
    return this.provisionCamera({
      name: dto.name,
      ip: dto.ip || null,
      port: dto.port ?? 554,
      username: dto.username || null,
      password: dto.password || null,
      rtspUrl: dto.rtspUrl,
      subStreamUrl: dto.subRtspUrl || null,
    });
  }

  /**
   * Commits a camera verified by the onboarding wizard and locks in its permanent stream paths (Step 6).
   */
  async commitVerifiedCamera(
    input: CommitCameraInput,
    cameraLimit: number
  ): Promise<CameraResponseDto> {
    await this.assertWithinLimit(cameraLimit);

    const camera = await this.provisionCamera({
      name: input.name,
      ip: input.ip || null,
      port: input.port || null,
      username: input.username || null,
      password: input.password || null,
      rtspUrl: input.rtspUrl,
      subStreamUrl: input.subStreamUrl || null,
      onvifUrl: input.onvifUrl || null,
      profileToken: input.profileToken || null,
      manufacturer: input.manufacturer || null,
      model: input.model || null,
      serialNumber: input.serialNumber || null,
    });

    if (input.previewPath) {
      await this.teardownPreviewPath(input.previewPath).catch(() => {});
    }

    return camera;
  }

  /**
   * Single provisioning path for every onboarding flow:
   * 1. configure main (always-on, recording) and optional sub (on-demand) paths in MediaMTX,
   * 2. persist the camera,
   * 3. roll back the media paths if anything fails,
   * 4. announce camera.online (never including credentials: events are stored and broadcast).
   */
  private async provisionCamera(data: {
    name: string;
    rtspUrl: string;
    subStreamUrl?: string | null;
    ip?: string | null;
    port?: number | null;
    username?: string | null;
    password?: string | null;
    onvifUrl?: string | null;
    profileToken?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
  }): Promise<CameraResponseDto> {
    const mediaMtxPath = this.generatePathName(data.name);
    const subMediaMtxPath = data.subStreamUrl ? `${mediaMtxPath}_sub` : null;

    let record: any;
    try {
      const mainOk = await this.mediaMtx.setPath(mediaMtxPath, {
        source: data.rtspUrl,
        sourceOnDemand: false,
        record: true, // New cameras start in CONTINUOUS mode; the scheduler owns this flag afterwards
      });
      if (!mainOk) {
        throw new Error(`Failed to configure main stream path in media plane: ${mediaMtxPath}`);
      }

      if (data.subStreamUrl && subMediaMtxPath) {
        const subOk = await this.mediaMtx.setPath(subMediaMtxPath, {
          source: data.subStreamUrl,
          sourceOnDemand: true,
          record: false,
        });
        if (!subOk) {
          throw new Error(`Failed to configure sub-stream path in media plane: ${subMediaMtxPath}`);
        }
      }

      record = await this.prisma.camera.create({
        data: {
          ...data,
          subStreamUrl: data.subStreamUrl || null,
          subRtspUrl: data.subStreamUrl || null,
          mediaMtxPath,
          subMediaMtxPath,
          status: 'online',
          recordingMode: 'CONTINUOUS',
        },
      });
    } catch (err) {
      if (subMediaMtxPath) {
        await this.mediaMtx.removePath(subMediaMtxPath).catch(() => {});
      }
      await this.mediaMtx.removePath(mediaMtxPath).catch(() => {});
      throw err;
    }

    await this.eventBus
      .emitEvent({
        type: 'camera.online',
        source: 'camera.service',
        cameraId: record.id,
        metadata: {
          name: record.name,
          ip: record.ip,
          port: record.port,
          onvifXAddr: record.onvifUrl,
          manufacturer: record.manufacturer,
          mediaMtxPath: record.mediaMtxPath,
          subMediaMtxPath: record.subMediaMtxPath,
        },
      })
      .catch(() => {});

    return this.toDto(record);
  }

  /**
   * Discover ONVIF IP cameras on the local network (CAM-01).
   */
  async discover(timeoutMs = 3000): Promise<DiscoveredCamera[]> {
    return this.provider.discover(timeoutMs);
  }

  /**
   * Onboards an ONVIF Profile T/S camera, extracting stream profiles and provisioning MediaMTX (CAM-02, CAM-05).
   */
  async onboardOnvifCamera(
    input: OnboardCameraInput,
    cameraLimit: number
  ): Promise<CameraResponseDto> {
    await this.assertWithinLimit(cameraLimit);

    const connectionParams = {
      ip: input.ip,
      port: input.port,
      username: input.username,
      password: input.password,
      xaddr: input.xaddr,
    };

    // Query device info
    const info: Partial<CameraDeviceDetails> = await this.provider
      .getDeviceInformation(connectionParams)
      .catch(() => ({}));

    // Query video stream profiles
    const profiles = await this.provider.getProfiles(connectionParams);
    if (!profiles || profiles.length === 0) {
      throw new Error(`No video stream profiles could be found on camera at ${input.ip}`);
    }

    const mainProfile = profiles.find((p) => p.isMainStream) || profiles[0];
    const subProfile = profiles.find((p) => !p.isMainStream);

    return this.provisionCamera({
      name: input.name,
      ip: input.ip,
      port: input.port,
      username: input.username || null,
      password: input.password || null,
      rtspUrl: mainProfile.rtspUri,
      subStreamUrl: subProfile?.rtspUri || null,
      onvifUrl: input.xaddr || `http://${input.ip}:${input.port}/onvif/device_service`,
      profileToken: mainProfile.token,
      manufacturer: info.manufacturer || null,
      model: info.model || null,
      serialNumber: info.serialNumber || null,
    });
  }

  /**
   * Onboards a manual RTSP camera stream directly without ONVIF (CAM-03, CAM-05).
   */
  async onboardManualCamera(
    input: ManualCameraInput,
    cameraLimit: number
  ): Promise<CameraResponseDto> {
    await this.assertWithinLimit(cameraLimit);

    return this.provisionCamera({
      name: input.name,
      rtspUrl: input.rtspUrl,
      subStreamUrl: input.subStreamUrl || null,
    });
  }

  /**
   * Retrieves all onboarded cameras.
   */
  async listCameras(): Promise<CameraResponseDto[]> {
    const records = await this.prisma.camera.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.toDto(r));
  }

  /**
   * Retrieves a single camera by ID.
   */
  async getCameraById(id: string): Promise<CameraResponseDto | null> {
    const record = await this.prisma.camera.findUnique({
      where: { id },
    });
    return record ? this.toDto(record) : null;
  }

  /**
   * Removes a camera and tears down its streaming path in MediaMTX.
   */
  async removeCamera(id: string): Promise<boolean> {
    const existingCamera = await this.prisma.camera.findUnique({ where: { id } });
    if (!existingCamera) {
      return false;
    }

    await this.prisma.camera.delete({ where: { id } });

    // Teardown MediaMTX stream paths (the DB row is gone, so a failure here only leaves
    // an orphaned path that a MediaMTX restart clears; don't fail the request for it)
    await this.mediaMtx.removePath(existingCamera.mediaMtxPath).catch((err: Error) => {
      console.warn(`[CameraService] Failed to remove media path ${existingCamera.mediaMtxPath}: ${err.message}`);
    });
    if (existingCamera.subMediaMtxPath) {
      await this.mediaMtx.removePath(existingCamera.subMediaMtxPath).catch(() => {});
    }

    // Emit lifecycle event
    await this.eventBus.emitEvent({
      type: 'camera.offline',
      source: 'camera.service',
      cameraId: id,
      metadata: {
        name: existingCamera.name,
        mediaMtxPath: existingCamera.mediaMtxPath,
      },
    });

    await this.eventBus.emitEvent({
      type: 'camera.deleted',
      source: 'camera.service',
      cameraId: id,
      metadata: {
        name: existingCamera.name,
        mediaMtxPath: existingCamera.mediaMtxPath,
      },
    });

    return true;
  }

  /**
   * Counts currently installed cameras.
   */
  async getCameraCount(): Promise<number> {
    return await this.prisma.camera.count();
  }

  /**
   * Helper asserting that the current number of cameras is below the licensed limit (T-02-04).
   */
  private async assertWithinLimit(cameraLimit: number): Promise<void> {
    const currentCount = await this.getCameraCount();
    if (currentCount >= cameraLimit) {
      throw new LicenseLimitExceededError(
        `License limit exceeded. Maximum cameras allowed: ${cameraLimit}, currently active: ${currentCount}`,
        cameraLimit
      );
    }
  }

  /**
   * Generates a safe identifier for the MediaMTX stream path.
   */
  private generatePathName(cameraName: string): string {
    const slug = cameraName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 24);
    const suffix = crypto.randomBytes(3).toString('hex');
    return `${slug}_${suffix}`;
  }

  /**
   * Formats camera database record into public DTO, deliberately excluding password (T-02-06).
   */
  private toDto(record: any): CameraResponseDto {
    return {
      id: record.id,
      name: record.name,
      ip: record.ip,
      port: record.port,
      username: record.username,
      rtspUrl: record.rtspUrl,
      subRtspUrl: record.subRtspUrl ?? record.subStreamUrl ?? null,
      subStreamUrl: record.subStreamUrl ?? record.subRtspUrl ?? null,
      onvifUrl: record.onvifUrl,
      profileToken: record.profileToken,
      manufacturer: record.manufacturer,
      model: record.model,
      serialNumber: record.serialNumber,
      status: record.status,
      recordingMode: record.recordingMode ?? 'CONTINUOUS',
      mediaMtxPath: record.mediaMtxPath,
      subMediaMtxPath: record.subMediaMtxPath ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export const cameraService = new CameraService();
export default cameraService;
