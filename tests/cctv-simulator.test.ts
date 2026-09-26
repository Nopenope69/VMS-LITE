import { describe, it, expect } from 'vitest';
import { SimulatorState } from '../tools/cctv-simulator/simulator-state.js';
import { NvrExporterService } from '../tools/cctv-simulator/nvr-exporter.js';
import { OnvifResponderService } from '../tools/cctv-simulator/onvif-responder.js';

describe('Universal CCTV Simulator Engine (Standby Utility)', () => {
  const state = new SimulatorState();
  const exporter = new NvrExporterService();
  const onvif = new OnvifResponderService();

  it('initializes with default camera roster', () => {
    const cameras = state.getCameras();
    expect(cameras.length).toBeGreaterThanOrEqual(1);
    expect(cameras[0].id).toBeDefined();
    expect(cameras[0].rtspUrlMain).toContain('rtsp://');
  });

  it('scales virtual cameras dynamically from 1 to 64', () => {
    state.setCameraCount(4);
    expect(state.getCameras().length).toBe(4);

    state.setCameraCount(32);
    expect(state.getCameras().length).toBe(32);

    state.setCameraCount(64);
    expect(state.getCameras().length).toBe(64);

    // Bounds checking
    state.setCameraCount(100);
    expect(state.getCameras().length).toBe(64);

    state.setCameraCount(0);
    expect(state.getCameras().length).toBe(1);

    // Reset to 16
    state.setCameraCount(16);
    expect(state.getCameras().length).toBe(16);
  });

  it('triggers motion alerts with timestamp and alarm state', () => {
    const cam = state.getCameras()[0];
    const res = state.triggerMotion(cam.id);
    expect(res.success).toBe(true);
    expect(res.camera?.status).toBe('alarm');
    expect(res.camera?.lastMotionAt).toBeDefined();
  });

  it('generates standard CP Plus NVR batch CSV', () => {
    const cameras = state.getCameras().slice(0, 4);
    const csv = exporter.generateCpPlusCsv(cameras, '192.168.1.50');
    expect(csv).toContain('Channel,Device Name,IP Address,Port,Protocol,User Name,Password,Remote Channel');
    expect(csv).toContain('192.168.1.50');
    expect(csv).toContain('ONVIF');
  });

  it('generates standard Hikvision NVR batch CSV', () => {
    const cameras = state.getCameras().slice(0, 4);
    const csv = exporter.generateHikvisionCsv(cameras, '192.168.1.50');
    expect(csv).toContain('No.,Device Name,IP,Port,Protocol,User Name,Password,Stream Type');
    expect(csv).toContain('Main');
  });

  it('generates standard Dahua NVR batch CSV', () => {
    const cameras = state.getCameras().slice(0, 4);
    const csv = exporter.generateDahuaCsv(cameras, '192.168.1.50');
    expect(csv).toContain('No,Name,IP,Port,Protocol,UserName,Password');
  });

  it('generates standard RTSP M3U playlist', () => {
    const cameras = state.getCameras().slice(0, 4);
    const m3u = exporter.generateRtspM3u(cameras, '192.168.1.50');
    expect(m3u).toContain('#EXTM3U');
    expect(m3u).toContain('rtsp://192.168.1.50:8554/');
  });

  it('generates Basic VMS JSON payload', () => {
    const cameras = state.getCameras().slice(0, 4);
    const vmsJson = exporter.generateBasicVmsJson(cameras, '192.168.1.50');
    expect(vmsJson.source).toBe('cctv-simulator');
    expect(Array.isArray(vmsJson.cameras)).toBe(true);
    expect(vmsJson.cameras.length).toBe(4);
    expect(vmsJson.cameras[0].mediaMtxPath).toBeDefined();
  });

  it('handles ONVIF SOAP GetDeviceInformation & GetStreamUri requests', () => {
    const cam = state.getCameras()[0];
    const devInfo = onvif.handleSoapRequest(cam.id, '<GetDeviceInformation />');
    expect(devInfo).toContain('GetDeviceInformationResponse');
    expect(devInfo).toContain(cam.manufacturer);

    const streamUri = onvif.handleSoapRequest(cam.id, '<GetStreamUri />', '127.0.0.1', 8554);
    expect(streamUri).toContain('GetStreamUriResponse');
    expect(streamUri).toContain('rtsp://127.0.0.1:8554/');
  });
});
