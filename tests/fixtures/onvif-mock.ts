import {
  CameraDeviceDetails,
  CameraStreamProfile,
  DiscoveredCamera,
} from '../../src/cameras/camera-provider.interface.js';

export const MOCK_DISCOVERED_CAMERAS: DiscoveredCamera[] = [
  {
    urn: 'urn:uuid:48b48877-22d1-419b-a78b-302a5a123456',
    name: 'CP-PLUS-IPC-HDBW',
    xaddr: 'http://192.168.1.108:80/onvif/device_service',
    ip: '192.168.1.108',
    port: 80,
  },
  {
    urn: 'urn:uuid:99a11223-33b2-44c3-88d4-112233445566',
    name: 'HIKVISION-DS-2CD2143G0',
    xaddr: 'http://192.168.1.109:8000/onvif/device_service',
    ip: '192.168.1.109',
    port: 8000,
  },
];

export const MOCK_DEVICE_INFO: CameraDeviceDetails = {
  manufacturer: 'CP PLUS',
  model: 'CP-UNC-TA41PL3',
  firmwareVersion: '2.800.0000000.12.R',
  serialNumber: 'ABC1234567890',
  hardwareId: '1.0',
};

export const MOCK_PROFILES_DUAL: CameraStreamProfile[] = [
  {
    token: 'Profile_T_Main',
    name: 'MainStream_HighRes',
    encoding: 'H265',
    resolution: { width: 2560, height: 1440 },
    fps: 25,
    rtspUri: 'rtsp://192.168.1.108:554/cam/realmonitor?channel=1&subtype=0',
    isMainStream: true,
  },
  {
    token: 'Profile_S_Sub',
    name: 'SubStream_LowRes',
    encoding: 'H264',
    resolution: { width: 640, height: 480 },
    fps: 15,
    rtspUri: 'rtsp://192.168.1.108:554/cam/realmonitor?channel=1&subtype=1',
    isMainStream: false,
  },
];

export const MOCK_PROFILES_SINGLE_PROFILE_S: CameraStreamProfile[] = [
  {
    token: 'Profile_S_Standard',
    name: 'StandardStream',
    encoding: 'H264',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    rtspUri: 'rtsp://192.168.1.109:554/Streaming/Channels/101',
    isMainStream: true,
  },
];
