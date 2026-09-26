import dgram from 'node:dgram';
import { simulatorState } from './simulator-state.js';
import { VirtualCamera } from './simulator-types.js';

const MULTICAST_ADDR = '239.255.255.250';
const WS_DISCOVERY_PORT = 3702;

export class OnvifResponderService {
  private socket: dgram.Socket | null = null;
  private isRunning: boolean = false;
  private httpHost: string = '127.0.0.1';
  private httpPort: number = 8190;

  public start(httpHost: string = '127.0.0.1', httpPort: number = 8190): void {
    if (this.isRunning) return;
    this.httpHost = httpHost;
    this.httpPort = httpPort;

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.warn(`[ONVIF WS-Discovery] UDP socket error: ${err.message}`);
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleDiscoveryMessage(msg.toString('utf-8'), rinfo);
      });

      this.socket.bind(WS_DISCOVERY_PORT, () => {
        try {
          this.socket?.addMembership(MULTICAST_ADDR);
          this.isRunning = true;
          console.log(`[ONVIF WS-Discovery] Multicast listening on ${MULTICAST_ADDR}:${WS_DISCOVERY_PORT}`);
        } catch (e: any) {
          console.warn(`[ONVIF WS-Discovery] Add membership note: ${e.message}`);
        }
      });
    } catch (err: any) {
      console.warn(`[ONVIF WS-Discovery] Start failed: ${err.message}`);
    }
  }

  public stop(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.isRunning = false;
  }

  private handleDiscoveryMessage(xml: string, rinfo: dgram.RemoteInfo): void {
    // Check if message is a Probe request
    if (!xml.includes('Probe') || xml.includes('ProbeMatches')) return;

    const cameras = simulatorState.getCameras().slice(0, 16); // Respond with top 16 virtual devices
    for (const cam of cameras) {
      const response = this.buildProbeMatchXml(cam);
      const buffer = Buffer.from(response, 'utf-8');
      this.socket?.send(buffer, 0, buffer.length, rinfo.port, rinfo.address);
    }
  }

  private buildProbeMatchXml(cam: VirtualCamera): string {
    const xaddr = `http://${this.httpHost}:${this.httpPort}/onvif/${cam.id}/device_service`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <SOAP-ENV:Header>
    <wsa:MessageID>urn:uuid:${cam.id}-probe</wsa:MessageID>
    <wsa:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:To>
    <wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <d:ProbeMatches>
      <d:ProbeMatch>
        <wsa:EndpointReference>
          <wsa:Address>urn:uuid:${cam.id}</wsa:Address>
        </wsa:EndpointReference>
        <d:Types>dn:NetworkVideoTransmitter</d:Types>
        <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/Profile/Streaming onvif://www.onvif.org/name/${encodeURIComponent(cam.name)} onvif://www.onvif.org/hardware/${encodeURIComponent(cam.model)} onvif://www.onvif.org/location/${encodeURIComponent(cam.ip)}</d:Scopes>
        <d:XAddrs>${xaddr}</d:XAddrs>
        <d:MetadataVersion>1</d:MetadataVersion>
      </d:ProbeMatch>
    </d:ProbeMatches>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
  }

  /**
   * Handles ONVIF SOAP requests (GetDeviceInformation, GetProfiles, GetStreamUri, etc.)
   */
  public handleSoapRequest(camId: string, soapBody: string, rtspHost: string = '127.0.0.1', rtspPort: number = 8554): string {
    const cam = simulatorState.getCameraById(camId) || simulatorState.getCameras()[0];
    const serviceUrl = `http://${rtspHost}:${this.httpPort}/onvif/${cam.id}/device_service`;

    if (soapBody.includes('GetSystemDateAndTime')) {
      const now = new Date();
      return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <tds:GetSystemDateAndTimeResponse>
      <tds:SystemDateAndTime>
        <tt:DateTimeType>Manual</tt:DateTimeType>
        <tt:DaylightSavings>false</tt:DaylightSavings>
        <tt:TimeZone><tt:TZ>GMT</tt:TZ></tt:TimeZone>
        <tt:UTCDateTime>
          <tt:Time><tt:Hour>${now.getUTCHours()}</tt:Hour><tt:Minute>${now.getUTCMinutes()}</tt:Minute><tt:Second>${now.getUTCSeconds()}</tt:Second></tt:Time>
          <tt:Date><tt:Year>${now.getUTCFullYear()}</tt:Year><tt:Month>${now.getUTCMonth() + 1}</tt:Month><tt:Day>${now.getUTCDate()}</tt:Day></tt:Date>
        </tt:UTCDateTime>
      </tds:SystemDateAndTime>
    </tds:GetSystemDateAndTimeResponse>
  </s:Body>
</s:Envelope>`;
    }

    if (soapBody.includes('GetCapabilities')) {
      return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <tds:GetCapabilitiesResponse>
      <tds:Capabilities>
        <tt:Device>
          <tt:XAddr>${serviceUrl}</tt:XAddr>
        </tt:Device>
        <tt:Media>
          <tt:XAddr>${serviceUrl}</tt:XAddr>
          <tt:StreamingCapabilities>
            <tt:RTSPStreaming>true</tt:RTSPStreaming>
          </tt:StreamingCapabilities>
        </tt:Media>
        <tt:Events>
          <tt:XAddr>${serviceUrl}</tt:XAddr>
        </tt:Events>
        <tt:PTZ>
          <tt:XAddr>${serviceUrl}</tt:XAddr>
        </tt:PTZ>
      </tds:Capabilities>
    </tds:GetCapabilitiesResponse>
  </s:Body>
</s:Envelope>`;
    }

    if (soapBody.includes('GetServices')) {
      return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body>
    <tds:GetServicesResponse>
      <tds:Service>
        <tds:Namespace>http://www.onvif.org/ver10/device/wsdl</tds:Namespace>
        <tds:XAddr>${serviceUrl}</tds:XAddr>
        <tds:Version><tds:Major>2</tds:Major><tds:Minor>5</tds:Minor></tds:Version>
      </tds:Service>
      <tds:Service>
        <tds:Namespace>http://www.onvif.org/ver10/media/wsdl</tds:Namespace>
        <tds:XAddr>${serviceUrl}</tds:XAddr>
        <tds:Version><tds:Major>2</tds:Major><tds:Minor>5</tds:Minor></tds:Version>
      </tds:Service>
    </tds:GetServicesResponse>
  </s:Body>
</s:Envelope>`;
    }

    if (soapBody.includes('GetDeviceInformation')) {
      return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body>
    <tds:GetDeviceInformationResponse>
      <tds:Manufacturer>${cam.manufacturer}</tds:Manufacturer>
      <tds:Model>${cam.model}</tds:Model>
      <tds:FirmwareVersion>V2.8.102-build2026</tds:FirmwareVersion>
      <tds:SerialNumber>${cam.serialNumber}</tds:SerialNumber>
      <tds:HardwareId>HW-4K-AI</tds:HardwareId>
    </tds:GetDeviceInformationResponse>
  </s:Body>
</s:Envelope>`;
    }

    if (soapBody.includes('GetProfiles')) {
      return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <trt:GetProfilesResponse>
      <trt:Profiles token="Profile_1" fixed="true">
        <tt:Name>MainStream-1080P</tt:Name>
        <tt:VideoEncoderConfiguration token="VEnc_1">
          <tt:Name>H264-1080P</tt:Name>
          <tt:Encoding>H264</tt:Encoding>
          <tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution>
          <tt:Quality>5</tt:Quality>
          <tt:RateControl><tt:FrameRateLimit>${cam.fps}</tt:FrameRateLimit><tt:BitrateLimit>${cam.bitrateKbps}</tt:BitrateLimit></tt:RateControl>
        </tt:VideoEncoderConfiguration>
      </trt:Profiles>
      <trt:Profiles token="Profile_2" fixed="true">
        <tt:Name>SubStream-360P</tt:Name>
        <tt:VideoEncoderConfiguration token="VEnc_2">
          <tt:Name>H264-360P</tt:Name>
          <tt:Encoding>H264</tt:Encoding>
          <tt:Resolution><tt:Width>640</tt:Width><tt:Height>360</tt:Height></tt:Resolution>
          <tt:Quality>3</tt:Quality>
          <tt:RateControl><tt:FrameRateLimit>15</tt:FrameRateLimit><tt:BitrateLimit>400</tt:BitrateLimit></tt:RateControl>
        </tt:VideoEncoderConfiguration>
      </trt:Profiles>
    </trt:GetProfilesResponse>
  </s:Body>
</s:Envelope>`;
    }

    if (soapBody.includes('GetStreamUri')) {
      const isSub = soapBody.includes('Profile_2');
      const streamPath = isSub ? cam.mediaMtxPathSub : cam.mediaMtxPathMain;
      const rtspUri = `rtsp://${rtspHost}:${rtspPort}/${streamPath}`;

      return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <trt:GetStreamUriResponse>
      <trt:MediaUri>
        <tt:Uri>${rtspUri}</tt:Uri>
        <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
        <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
        <tt:Timeout>PT60S</tt:Timeout>
      </trt:MediaUri>
    </trt:GetStreamUriResponse>
  </s:Body>
</s:Envelope>`;
    }

    // Default Generic ONVIF SOAP Response
    return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body><s:Fault><s:Code><s:Value>s:Receiver</s:Value></s:Code><s:Reason><s:Text xml:lang="en">Operation OK</s:Text></s:Reason></s:Fault></s:Body>
</s:Envelope>`;
  }
}

export const onvifResponder = new OnvifResponderService();
