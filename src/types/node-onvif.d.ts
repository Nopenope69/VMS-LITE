declare module 'node-onvif' {
  export interface OnvifDeviceOptions {
    xaddr: string;
    user?: string;
    pass?: string;
  }

  export class OnvifDevice {
    constructor(options: OnvifDeviceOptions);
    init(): Promise<any>;
    getInformation(): {
      Manufacturer?: string;
      Model?: string;
      FirmwareVersion?: string;
      SerialNumber?: string;
      HardwareId?: string;
      [key: string]: any;
    };
    getProfileList(): any[];
    getUdpStreamUrl(profileToken?: string): string;
  }

  export interface ProbeOptions {
    timeout?: number;
  }

  export function startProbe(options?: ProbeOptions): Promise<any[]>;

  const onvif: {
    OnvifDevice: typeof OnvifDevice;
    startProbe: typeof startProbe;
  };

  export default onvif;
}
