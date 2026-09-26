import crypto from 'node:crypto';
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
  ManualCameraInput,
  OnboardCameraInput,
} from './camera.types.js';

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

  // In-memory fallback cache when PostgreSQL is not running in test/sandbox
  private readonly memoryCameras: Map<string, any> = new Map();
  private readonly mediaSourceMap: Map<string, string> = new Map();

  constructor(deps: CameraServiceDependencies = {}) {
    this.provider = deps.provider || defaultProvider;
    this.mediaMtx = deps.mediaMtx || defaultMediaMtx;
    this.eventBus = deps.eventBus || defaultEventBus;
    this.prisma = deps.prisma || defaultPrisma;
    this.initDemoCamerasIfEmpty();
  }

  private initDemoCamerasIfEmpty() {
    if (process.env.NODE_ENV === 'test' || this.memoryCameras.size > 0) return;
    const demo = [
      {
        id: 'cam-1',
        name: 'Gate 1 - Main Barrier Entry',
        ip: '192.168.1.101',
        port: 554,
        username: 'admin',
        rtspUrl: 'rtsp://192.168.1.101:554/live/ch0',
        subStreamUrl: 'rtsp://192.168.1.101:554/live/ch1',
        onvifUrl: 'http://192.168.1.101:80/onvif/device_service',
        profileToken: 'Profile_1',
        manufacturer: 'Hikvision',
        model: 'DS-2CD2043G2-I',
        serialNumber: 'HK-99238411',
        status: 'online',
        mediaMtxPath: 'cam_gate_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'cam-2',
        name: 'Warehouse - Logistics Bay',
        ip: '192.168.1.102',
        port: 554,
        username: 'admin',
        rtspUrl: 'rtsp://192.168.1.102:554/live/ch0',
        subStreamUrl: 'rtsp://192.168.1.102:554/live/ch1',
        onvifUrl: 'http://192.168.1.102:80/onvif/device_service',
        profileToken: 'Profile_1',
        manufacturer: 'CP Plus',
        model: 'CP-UNC-TA41L3-M',
        serialNumber: 'CP-44018291',
        status: 'online',
        mediaMtxPath: 'cam_warehouse_bay',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'cam-3',
        name: 'Perimeter - North Fence Line',
        ip: '192.168.1.103',
        port: 554,
        username: 'admin',
        rtspUrl: 'rtsp://192.168.1.103:554/live/ch0',
        subStreamUrl: 'rtsp://192.168.1.103:554/live/ch1',
        onvifUrl: 'http://192.168.1.103:80/onvif/device_service',
        profileToken: 'Profile_1',
        manufacturer: 'Dahua',
        model: 'DH-IPC-HFW2431S',
        serialNumber: 'DH-88192304',
        status: 'online',
        mediaMtxPath: 'cam_perimeter_north',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'cam-4',
        name: 'Admin Building - Reception Area',
        ip: '192.168.1.104',
        port: 554,
        username: 'admin',
        rtspUrl: 'rtsp://192.168.1.104:554/live/ch0',
        subStreamUrl: 'rtsp://192.168.1.104:554/live/ch1',
        onvifUrl: 'http://192.168.1.104:80/onvif/device_service',
        profileToken: 'Profile_1',
        manufacturer: 'Uniview',
        model: 'IPC2124SR3-DPF40',
        serialNumber: 'UNV-77182902',
        status: 'online',
        mediaMtxPath: 'cam_admin_reception',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    for (const cam of demo) {
      this.memoryCameras.set(cam.id, cam);
    }
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

    const ip = input.ip || '127.0.0.1';
    const port = input.port || 80;
    const xaddr = input.xaddr || input.onvifUrl || `http://${ip}:${port}/onvif/device_service`;

    const connectionParams = {
      ip,
      port,
      username: input.username,
      password: input.password,
      xaddr,
    };

    // Query device info
    const info: Partial<CameraDeviceDetails> = await this.provider
      .getDeviceInformation(connectionParams)
      .catch(() => ({}));

    // Query video stream profiles
    const profiles = await this.provider.getProfiles(connectionParams);
    if (!profiles || profiles.length === 0) {
      throw new Error(`No video stream profiles could be found on camera at ${ip}`);
    }

    const mainProfile = profiles.find((p) => p.isMainStream) || profiles[0];
    const subProfile = profiles.find((p) => !p.isMainStream);

    const mediaMtxPath = this.generatePathName(input.name);

    // Save camera to PostgreSQL (with in-memory fallback)
    const cameraRecord = await this.persistCamera({
      name: input.name,
      ip,
      port,
      username: input.username,
      password: input.password,
      rtspUrl: mainProfile.rtspUri,
      subStreamUrl: subProfile?.rtspUri || null,
      onvifUrl: xaddr,
      profileToken: mainProfile.token,
      manufacturer: info.manufacturer || null,
      model: info.model || null,
      serialNumber: info.serialNumber || null,
      status: 'online',
      mediaMtxPath,
    });

    // Dynamically provision path in MediaMTX
    await this.mediaMtx.addPath(mediaMtxPath, mainProfile.rtspUri);

    // Emit lifecycle event
    await this.eventBus.emitEvent({
      type: 'camera.online',
      source: 'camera.service',
      cameraId: cameraRecord.id,
      metadata: {
        name: cameraRecord.name,
        ip: cameraRecord.ip,
        port: cameraRecord.port,
        onvifXAddr: cameraRecord.onvifUrl,
        username: cameraRecord.username,
        password: input.password,
        mediaMtxPath: cameraRecord.mediaMtxPath,
        manufacturer: cameraRecord.manufacturer,
      },
    });

    return this.toDto(cameraRecord);
  }

  /**
   * Onboards a manual RTSP camera stream directly without ONVIF (CAM-03, CAM-05).
   */
  async onboardManualCamera(
    input: ManualCameraInput,
    cameraLimit: number
  ): Promise<CameraResponseDto> {
    await this.assertWithinLimit(cameraLimit);

    const mediaMtxPath = this.generatePathName(input.name);

    const cameraRecord = await this.persistCamera({
      name: input.name,
      rtspUrl: input.rtspUrl,
      subStreamUrl: input.subStreamUrl || null,
      status: 'online',
      mediaMtxPath,
    });

    await this.mediaMtx.addPath(mediaMtxPath, input.rtspUrl);

    await this.eventBus.emitEvent({
      type: 'camera.online',
      source: 'camera.service',
      cameraId: cameraRecord.id,
      metadata: {
        name: cameraRecord.name,
        mediaMtxPath: cameraRecord.mediaMtxPath,
        manual: true,
      },
    });

    return this.toDto(cameraRecord);
  }

  /**
   * Retrieves all onboarded cameras.
   */
  async listCameras(): Promise<CameraResponseDto[]> {
    try {
      const records = await this.prisma.camera.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return records.map((r) => this.toDto(r));
    } catch {
      return Array.from(this.memoryCameras.values()).map((r) => this.toDto(r));
    }
  }

  /**
   * Retrieves a single camera by ID.
   */
  async getCameraById(id: string): Promise<CameraResponseDto | null> {
    try {
      const record = await this.prisma.camera.findUnique({
        where: { id },
      });
      return record ? this.toDto(record) : null;
    } catch {
      const rec = this.memoryCameras.get(id);
      return rec ? this.toDto(rec) : null;
    }
  }

  /**
   * Removes a camera and tears down its streaming path in MediaMTX.
   */
  async removeCamera(id: string): Promise<boolean> {
    let existingCamera: any = null;

    try {
      existingCamera = await this.prisma.camera.findUnique({ where: { id } });
      if (existingCamera) {
        await this.prisma.camera.delete({ where: { id } });
      }
    } catch {
      existingCamera = this.memoryCameras.get(id);
      this.memoryCameras.delete(id);
    }

    if (!existingCamera) {
      return false;
    }

    // Teardown MediaMTX stream path
    await this.mediaMtx.removePath(existingCamera.mediaMtxPath);

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
    try {
      return await this.prisma.camera.count();
    } catch {
      return this.memoryCameras.size;
    }
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
   * Persists camera to PostgreSQL with fallback to in-memory store if DB is offline.
   */
  private async persistCamera(data: any): Promise<any> {
    try {
      return await this.prisma.camera.create({ data });
    } catch {
      const id = crypto.randomUUID();
      const now = new Date();
      const record = {
        id,
        ...data,
        createdAt: now,
        updatedAt: now,
      };
      this.memoryCameras.set(id, record);
      return record;
    }
  }

  /**
   * Sets or overrides the video clip source for simulated/streaming loop playback.
   */
  setCameraMediaSource(id: string, mediaSource: string): void {
    this.mediaSourceMap.set(id, mediaSource);
    const inMem = this.memoryCameras.get(id);
    if (inMem) {
      inMem.mediaSource = mediaSource;
    }
  }

  /**
   * Retrieves assigned video clip source.
   */
  getCameraMediaSource(id: string): string | undefined {
    return this.mediaSourceMap.get(id) || this.memoryCameras.get(id)?.mediaSource;
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
      subStreamUrl: record.subStreamUrl,
      onvifUrl: record.onvifUrl,
      profileToken: record.profileToken,
      manufacturer: record.manufacturer,
      model: record.model,
      serialNumber: record.serialNumber,
      status: record.status,
      mediaMtxPath: record.mediaMtxPath,
      mediaSource: this.mediaSourceMap.get(record.id) || record.mediaSource || null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export const cameraService = new CameraService();
export default cameraService;
