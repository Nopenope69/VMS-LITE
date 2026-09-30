import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageTelemetryService } from '../src/system/storage-telemetry.service.js';
import { EventBus } from '../src/events/event-bus.js';

describe('StorageTelemetryService', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('discovers block devices from mock lsblk output', async () => {
    const mockLsblk = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          path: '/dev/sda',
          model: 'WDC WD40PURZ',
          size: '4000787030016',
          rota: true,
          type: 'disk',
          rm: false,
          hotplug: false,
          children: [{ name: 'sda1', mountpoint: '/var/recordings' }],
        },
        {
          name: 'sdb',
          path: '/dev/sdb',
          model: 'SanDisk Ultra',
          size: '64000000000',
          rota: false,
          type: 'disk',
          rm: true,
          hotplug: true,
          mountpoint: '/media/usb1',
        },
      ],
    });

    const mockExec = vi.fn().mockImplementation(async (cmd, args) => {
      if (cmd === 'lsblk') {
        return { stdout: mockLsblk, stderr: '' };
      }
      return { stdout: '{}', stderr: '' };
    });

    const service = new StorageTelemetryService({ execFn: mockExec });
    const devices = await service.discoverBlockDevices();

    expect(devices).toHaveLength(2);
    expect(devices[0].name).toBe('sda');
    expect(devices[0].model).toBe('WDC WD40PURZ');
    expect(devices[0].mountpoint).toBe('/var/recordings');
    expect(devices[0].rotational).toBe(true);

    expect(devices[1].name).toBe('sdb');
    expect(devices[1].removable).toBe(true);
    expect(devices[1].mountpoint).toBe('/media/usb1');
  });

  it('parses smartctl JSON output and detects temperature and health', async () => {
    const mockSmart = JSON.stringify({
      smart_support: { available: true },
      smart_status: { passed: true },
      temperature: { current: 42 },
      power_on_time: { hours: 5200 },
      ata_smart_attributes: {
        table: [{ id: 5, name: 'Reallocated_Sector_Ct', raw: { value: 0 } }],
      },
    });

    const mockExec = vi.fn().mockResolvedValue({ stdout: mockSmart, stderr: '' });
    const service = new StorageTelemetryService({ execFn: mockExec });
    const smart = await service.querySmartctl('/dev/sda');

    expect(smart.smartSupported).toBe(true);
    expect(smart.healthStatus).toBe('PASSED');
    expect(smart.temperatureCelsius).toBe(42);
    expect(smart.powerOnHours).toBe(5200);
    expect(smart.reallocatedSectors).toBe(0);
  });

  it('emits critical warning alert when SMART predictive failure is detected', async () => {
    const events: any[] = [];
    eventBus.subscribe('storage.drive_degraded', (e) => events.push(e));

    const mockLsblk = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          path: '/dev/sda',
          model: 'Seagate SkyHawk',
          size: '2000000000',
          rota: true,
          type: 'disk',
          mountpoint: '/mnt/cctv',
        },
      ],
    });

    const mockSmart = JSON.stringify({
      smart_support: { available: true },
      smart_status: { passed: false }, // FAILED
      temperature: { current: 58 }, // Above warning threshold
    });

    const mockExec = vi.fn().mockImplementation(async (cmd) => {
      if (cmd === 'lsblk') return { stdout: mockLsblk, stderr: '' };
      return { stdout: mockSmart, stderr: '' };
    });

    const service = new StorageTelemetryService({ eventBus, execFn: mockExec });
    await service.poll();

    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('critical');
    expect(events[0].metadata.healthStatus).toBe('FAILED');
  });

  it('generates accurate drive summary telemetry', async () => {
    const mockLsblk = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          path: '/dev/sda',
          model: 'Drive 1',
          size: '1000',
          type: 'disk',
          mountpoint: '/',
        },
        {
          name: 'sdb',
          path: '/dev/sdb',
          model: 'USB Backup',
          size: '500',
          type: 'disk',
          rm: true,
          mountpoint: '/mnt/backup',
        },
      ],
    });

    const mockExec = vi.fn().mockImplementation(async (cmd, args) => {
      if (cmd === 'lsblk') return { stdout: mockLsblk, stderr: '' };
      return {
        stdout: JSON.stringify({
          smart_status: { passed: true },
          temperature: { current: 38 },
        }),
        stderr: '',
      };
    });

    const service = new StorageTelemetryService({ execFn: mockExec });
    await service.poll();

    const summary = service.getSummary();
    expect(summary.totalDrives).toBe(2);
    expect(summary.healthyCount).toBe(2);
    expect(summary.maxTemperatureCelsius).toBe(38);
    expect(summary.removableMounts).toHaveLength(1);
    expect(summary.removableMounts[0].mountpoint).toBe('/mnt/backup');
  });
});
