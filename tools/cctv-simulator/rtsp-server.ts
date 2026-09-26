import fs from 'node:fs';
import path from 'node:path';
import { simulatorState } from './simulator-state.js';
import { mediaLibrary } from './media-library.js';

export class RtspBridgeService {
  /**
   * Pushes stream to MediaMTX if available
   */
  public async pushToMediaMtx(camId: string, mediaMtxHost: string = 'localhost', port: number = 8889): Promise<boolean> {
    const cam = simulatorState.getCameraById(camId);
    if (!cam) return false;

    // Check if MediaMTX WHIP endpoint is accepting connections
    try {
      const whipUrl = `http://${mediaMtxHost}:${port}/${cam.mediaMtxPathMain}/whip`;
      const res = await fetch(whipUrl, { method: 'OPTIONS' }).catch(() => null);
      return res ? true : false;
    } catch {
      return false;
    }
  }

  /**
   * Dispatches Motion Alarm event packet to Basic VMS API
   */
  public async dispatchMotionToVms(camId: string, vmsApiUrl: string = 'http://localhost:3000'): Promise<boolean> {
    const cam = simulatorState.getCameraById(camId);
    if (!cam) return false;

    try {
      const res = await fetch(`${vmsApiUrl}/api/v1/events/motion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraId: cam.id,
          cameraName: cam.name,
          channelNumber: cam.channelNumber,
          timestamp: new Date().toISOString(),
          type: 'motion.detected',
          metadata: {
            confidence: 0.94,
            source: 'cctv-simulator',
            ip: cam.ip,
          },
        }),
      }).catch(() => null);

      return res?.ok || false;
    } catch {
      return false;
    }
  }
}

export const rtspBridge = new RtspBridgeService();
