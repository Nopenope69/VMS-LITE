import bcrypt from 'bcrypt';
import { createMockPrisma } from './mock-prisma.js';

export async function createSeededMockPrisma() {
  const mock = createMockPrisma();

  // 1. Seed default admin and operator users
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const operatorPasswordHash = await bcrypt.hash('operator123', 10);

  await mock.user.create({
    data: {
      id: 'usr-admin-01',
      username: 'admin',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await mock.user.create({
    data: {
      id: 'usr-operator-01',
      username: 'operator',
      passwordHash: operatorPasswordHash,
      role: 'OPERATOR',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // 2. Seed 4 surveillance cameras matching PRISM HUD
  const sampleCameras = [
    {
      id: 'cam-01',
      name: '01 · North Gatehouse',
      ip: '192.168.1.101',
      port: 80,
      rtspUrl: 'rtsp://localhost:8554/cam-01',
      mediaMtxPath: 'cam-01',
      status: 'online',
      recordingMode: 'CONTINUOUS',
      manufacturer: 'Hikvision',
      model: 'DS-2CD2043G2-I',
    },
    {
      id: 'cam-02',
      name: '02 · Perimeter Fence (East)',
      ip: '192.168.1.102',
      port: 80,
      rtspUrl: 'rtsp://localhost:8554/cam-02',
      mediaMtxPath: 'cam-02',
      status: 'online',
      recordingMode: 'CONTINUOUS',
      manufacturer: 'CP Plus',
      model: 'CP-VNC-T41R3',
    },
    {
      id: 'cam-03',
      name: '03 · Main Loading Dock',
      ip: '192.168.1.103',
      port: 80,
      rtspUrl: 'rtsp://localhost:8554/cam-03',
      mediaMtxPath: 'cam-03',
      status: 'online',
      recordingMode: 'CONTINUOUS',
      manufacturer: 'Dahua',
      model: 'IPC-HFW2431S-S',
    },
    {
      id: 'cam-04',
      name: '04 · Server Room Corridor',
      ip: '192.168.1.104',
      port: 80,
      rtspUrl: 'rtsp://localhost:8554/cam-04',
      mediaMtxPath: 'cam-04',
      status: 'online',
      recordingMode: 'CONTINUOUS',
      manufacturer: 'Axis',
      model: 'M3046-V',
    },
  ];

  for (const c of sampleCameras) {
    await mock.camera.create({
      data: {
        ...c,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Seed continuous recording timeline segments
    const now = Date.now();
    await mock.recording.create({
      data: {
        id: `rec-${c.id}-01`,
        cameraId: c.id,
        startTime: new Date(now - 4 * 60 * 60 * 1000),
        endTime: new Date(now),
        mediaMtxPath: c.mediaMtxPath,
        duration: 14400,
        filePath: `/recordings/${c.id}/segment-01.mp4`,
        fileName: 'segment-01.mp4',
        sizeBytes: 1024 * 1024 * 500,
        format: 'fmp4',
        createdAt: new Date(),
      },
    });
  }

  // 3. Seed default notification config
  await mock.notificationConfig.create({
    data: {
      id: 'default-config',
      provider: 'mock',
      recipientPhones: [],
      cooldownSeconds: 60,
      events: ['motion.detected', 'camera.offline'],
      enabled: false,
    },
  });

  // 4. Seed sample events
  const eventTypes = [
    { type: 'motion.detected', severity: 'warning', cam: 'cam-01', desc: 'Motion detected at North Gatehouse' },
    { type: 'camera.online', severity: 'info', cam: 'cam-02', desc: 'Camera stream reconnected' },
    { type: 'motion.detected', severity: 'warning', cam: 'cam-03', desc: 'Motion detected at Loading Dock' },
  ];

  for (let i = 0; i < eventTypes.length; i++) {
    const et = eventTypes[i];
    await mock.event.create({
      data: {
        id: `evt-0${i + 1}`,
        cameraId: et.cam,
        type: et.type,
        source: 'ONVIF Profile T',
        severity: et.severity,
        metadata: { message: et.desc, cameraName: sampleCameras.find(c => c.id === et.cam)?.name },
        timestamp: new Date(Date.now() - (i + 1) * 3 * 60 * 1000),
        createdAt: new Date(),
      },
    });
  }

  return mock;
}
