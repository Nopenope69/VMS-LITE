import { VirtualCamera } from './simulator-types.js';

export class NvrExporterService {
  /**
   * Generates CP Plus NVR Batch Camera Add CSV
   * Columns: Channel,Device Name,IP Address,Port,Protocol,User Name,Password,Remote Channel
   */
  public generateCpPlusCsv(cameras: VirtualCamera[], simulatorHost: string = '127.0.0.1'): string {
    const header = 'Channel,Device Name,IP Address,Port,Protocol,User Name,Password,Remote Channel';
    const rows = cameras.map((c, idx) => {
      // CP Plus uses ONVIF port or RTSP port
      return `${idx + 1},"${c.name}",${simulatorHost},${c.rtspPort},ONVIF,${c.username},${c.password},1`;
    });
    return [header, ...rows].join('\r\n');
  }

  /**
   * Generates Hikvision NVR / iVMS-4200 Batch Import CSV
   * Columns: No.,Device Name,IP,Port,Protocol,User Name,Password,Stream Type
   */
  public generateHikvisionCsv(cameras: VirtualCamera[], simulatorHost: string = '127.0.0.1'): string {
    const header = 'No.,Device Name,IP,Port,Protocol,User Name,Password,Stream Type';
    const rows = cameras.map((c, idx) => {
      return `${idx + 1},"${c.name}",${simulatorHost},${c.rtspPort},ONVIF,${c.username},${c.password},Main`;
    });
    return [header, ...rows].join('\r\n');
  }

  /**
   * Generates Dahua NVR / SmartPSS Batch Import CSV
   * Columns: No,Name,IP,Port,Protocol,UserName,Password
   */
  public generateDahuaCsv(cameras: VirtualCamera[], simulatorHost: string = '127.0.0.1'): string {
    const header = 'No,Name,IP,Port,Protocol,UserName,Password';
    const rows = cameras.map((c, idx) => {
      return `${idx + 1},"${c.name}",${simulatorHost},${c.rtspPort},ONVIF,${c.username},${c.password}`;
    });
    return [header, ...rows].join('\r\n');
  }

  /**
   * Generates Standard RTSP M3U Playlist for VLC / Media Players
   */
  public generateRtspM3u(cameras: VirtualCamera[], simulatorHost: string = '127.0.0.1'): string {
    const lines = ['#EXTM3U'];
    for (const c of cameras) {
      lines.push(`#EXTINF:-1,${c.name} [Main HD 1080p]`);
      lines.push(`rtsp://${simulatorHost}:${c.rtspPort}/${c.mediaMtxPathMain}`);
      lines.push(`#EXTINF:-1,${c.name} [Sub Stream 360p]`);
      lines.push(`rtsp://${simulatorHost}:${c.rtspPort}/${c.mediaMtxPathSub}`);
    }
    return lines.join('\n');
  }

  /**
   * Generates JSON export formatted for Basic VMS Camera Onboarding API
   */
  public generateBasicVmsJson(cameras: VirtualCamera[], simulatorHost: string = '127.0.0.1'): any {
    return {
      source: 'cctv-simulator',
      exportedAt: new Date().toISOString(),
      cameras: cameras.map((c) => ({
        id: c.id,
        name: c.name,
        ip: simulatorHost,
        port: c.rtspPort,
        username: c.username,
        password: c.password,
        rtspUrl: `rtsp://${simulatorHost}:${c.rtspPort}/${c.mediaMtxPathMain}`,
        subStreamUrl: `rtsp://${simulatorHost}:${c.rtspPort}/${c.mediaMtxPathSub}`,
        onvifUrl: `http://${simulatorHost}:${c.onvifPort}/onvif/device_service`,
        mediaMtxPath: c.mediaMtxPathMain,
        manufacturer: c.manufacturer,
        model: c.model,
        serialNumber: c.serialNumber,
      })),
    };
  }
}

export const nvrExporter = new NvrExporterService();
