import fs from 'node:fs';
import path from 'node:path';
import { VirtualCamera, SimulatorStateData } from './simulator-types.js';
import { BUILTIN_CLIPS } from './media-library.js';

const getBaseDir = () => {
  const candidate1 = path.resolve(process.cwd(), 'tools', 'cctv-simulator');
  if (fs.existsSync(candidate1)) return candidate1;
  const candidate2 = path.dirname(process.execPath);
  if (fs.existsSync(candidate2)) return candidate2;
  return process.cwd();
};

const CONFIG_FILE = path.resolve(getBaseDir(), 'simulator-config.json');

const MANUFACTURERS = ['CP Plus', 'Hikvision', 'Dahua', 'Uniview', 'Hanwha'];
const LOCATION_NAMES = [
  'Main Barrier Entry',
  'Logistics Bay & Racks',
  'North Fence Perimeter',
  'Production Floor Line A',
  'Vehicle Weighbridge',
  'Server Room & Hub',
  'South Emergency Exit',
  'Visitor Reception Lobby',
  'Finished Goods Dispatch',
  'Raw Material Staging',
  'East Wall Patrol Path',
  'Substation & Transformer',
  'Employee Turnstile Gate',
  'Cafeteria & Common Bay',
  'Loading Dock 2',
  'Rooftop HVAC & Solar Yard',
];

export class SimulatorState {
  private data: SimulatorStateData;
  private listeners: ((camId: string, eventType: string, payload: any) => void)[] = [];

  constructor() {
    this.data = this.loadOrCreate();
  }

  private loadOrCreate(): SimulatorStateData {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.cameras && Array.isArray(parsed.cameras)) {
          return parsed;
        }
      }
    } catch {}

    return this.generateDefaultState(16);
  }

  public save(): void {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {}
  }

  public getState(): SimulatorStateData {
    return this.data;
  }

  public getCameras(): VirtualCamera[] {
    return this.data.cameras;
  }

  public getCameraById(id: string): VirtualCamera | undefined {
    return this.data.cameras.find((c) => c.id === id);
  }

  public subscribe(fn: (camId: string, eventType: string, payload: any) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  public broadcast(camId: string, eventType: string, payload: any): void {
    for (const listener of this.listeners) {
      try {
        listener(camId, eventType, payload);
      } catch {}
    }
  }

  public setCameraCount(count: number): VirtualCamera[] {
    const safeCount = Math.max(1, Math.min(64, count));
    if (safeCount === this.data.cameras.length) {
      return this.data.cameras;
    }

    if (safeCount > this.data.cameras.length) {
      // Add more cameras
      const startIdx = this.data.cameras.length;
      for (let i = startIdx; i < safeCount; i++) {
        this.data.cameras.push(this.buildCamera(i + 1));
      }
    } else {
      // Trim cameras
      this.data.cameras = this.data.cameras.slice(0, safeCount);
    }

    this.data.cameraCount = this.data.cameras.length;
    this.save();
    this.broadcast('all', 'camera_count_changed', { count: this.data.cameraCount });
    return this.data.cameras;
  }

  public updateCamera(id: string, updates: Partial<VirtualCamera>): VirtualCamera | null {
    const cam = this.getCameraById(id);
    if (!cam) return null;

    Object.assign(cam, updates);
    this.save();
    this.broadcast(id, 'camera_updated', cam);
    return cam;
  }

  public triggerMotion(id: string): { success: boolean; camera?: VirtualCamera } {
    const cam = this.getCameraById(id);
    if (!cam) return { success: false };

    cam.status = 'alarm';
    cam.lastMotionAt = new Date().toISOString();

    this.broadcast(id, 'motion_detected', {
      cameraId: cam.id,
      cameraName: cam.name,
      channelNumber: cam.channelNumber,
      timestamp: cam.lastMotionAt,
      ip: cam.ip,
    });

    // Auto-restore to streaming after 8 seconds
    setTimeout(() => {
      if (cam.status === 'alarm') {
        cam.status = 'streaming';
        this.broadcast(id, 'motion_cleared', { cameraId: cam.id });
      }
    }, 8000);

    return { success: true, camera: cam };
  }

  public updatePtz(id: string, pan: number, tilt: number, zoom: number): void {
    const cam = this.getCameraById(id);
    if (!cam) return;

    cam.ptz = {
      pan: Math.max(-180, Math.min(180, pan)),
      tilt: Math.max(-90, Math.min(90, tilt)),
      zoom: Math.max(1, Math.min(10, zoom)),
    };

    this.broadcast(id, 'ptz_updated', {
      cameraId: cam.id,
      ptz: cam.ptz,
    });
  }

  private generateDefaultState(count: number): SimulatorStateData {
    const cameras: VirtualCamera[] = [];
    for (let i = 1; i <= count; i++) {
      cameras.push(this.buildCamera(i));
    }

    return {
      cameraCount: count,
      cameras,
      globalFps: 25,
      mediaMtxHost: 'localhost',
      mediaMtxRtspPort: 8554,
      mediaMtxWhepPort: 8889,
      mediaMtxHlsPort: 8888,
      onvifDiscoveryEnabled: true,
      vmsApiUrl: 'http://localhost:3000',
    };
  }

  private buildCamera(channel: number): VirtualCamera {
    const pad = String(channel).padStart(2, '0');
    const ipLast = 100 + channel;
    const ip = `192.168.1.${ipLast}`;
    const mfg = MANUFACTURERS[(channel - 1) % MANUFACTURERS.length];
    const locationName = LOCATION_NAMES[(channel - 1) % LOCATION_NAMES.length];
    const clip = BUILTIN_CLIPS[(channel - 1) % (BUILTIN_CLIPS.length - 1)]; // cycle through video clips

    // First 4 cameras map to default Basic VMS demo paths for instant zero-config play
    const primaryPaths: Record<number, string> = {
      1: 'cam_gate_1',
      2: 'cam_warehouse_bay',
      3: 'cam_perimeter_north',
      4: 'cam_production_floor',
    };

    const mainPath = primaryPaths[channel] || `cam_${pad}`;
    const subPath = `${mainPath}_sub`;

    return {
      id: `sim-cam-${pad}`,
      channelNumber: channel,
      name: `CH-${pad} [${mfg}] ${locationName}`,
      ip,
      rtspPort: 8554,
      onvifPort: 8000 + channel,
      httpPort: 8090,
      username: 'admin',
      password: 'admin123',
      manufacturer: mfg,
      model: `${mfg.toUpperCase()}-IPC-PRO-4K`,
      serialNumber: `${mfg.substring(0, 2).toUpperCase()}-${Math.floor(10000000 + Math.random() * 90000000)}`,
      mediaSource: clip.filename,
      mediaTitle: clip.title,
      mainResolution: '1920x1080',
      subResolution: '640x360',
      fps: 25,
      bitrateKbps: 2500,
      rtspUrlMain: `rtsp://${ip}:8554/${mainPath}`,
      rtspUrlSub: `rtsp://${ip}:8554/${subPath}`,
      mediaMtxPathMain: mainPath,
      mediaMtxPathSub: subPath,
      status: 'streaming',
      ptz: { pan: 0, tilt: 0, zoom: 1 },
    };
  }
}

export const simulatorState = new SimulatorState();
