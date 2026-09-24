import crypto from 'node:crypto';
import { IceServerConfig } from './streaming.types.js';

export interface IceServerOptions {
  stunUrls?: string[];
  turnHost?: string;
  turnPort?: number;
  turnSecret?: string;
  ttlSeconds?: number;
}

export class IceServerService {
  private readonly stunUrls: string[];
  private readonly turnHost?: string;
  private readonly turnPort: number;
  private readonly turnSecret?: string;
  private readonly ttlSeconds: number;

  constructor(opts: IceServerOptions = {}) {
    this.stunUrls = opts.stunUrls || [
      process.env.STUN_SERVER_URL || 'stun:stun.l.google.com:19302',
    ];
    this.turnHost = opts.turnHost || process.env.TURN_SERVER_HOST;
    this.turnPort = opts.turnPort || Number(process.env.TURN_SERVER_PORT) || 3478;
    this.turnSecret = opts.turnSecret || process.env.TURN_SECRET;
    this.ttlSeconds = opts.ttlSeconds || 3600; // 1 hour default TTL
  }

  /**
   * Generates active ICE servers including ephemeral TURN credentials (RFC 5766 REST API) (LIVE-04, T-04-02).
   */
  getIceServers(userId: string = 'vms_client'): IceServerConfig[] {
    const servers: IceServerConfig[] = [{ urls: this.stunUrls }];

    // If Coturn TURN secret and host are configured, generate ephemeral credentials
    if (this.turnHost && this.turnSecret) {
      const expiry = Math.floor(Date.now() / 1000) + this.ttlSeconds;
      const username = `${expiry}:${userId}`;
      const credential = crypto
        .createHmac('sha1', this.turnSecret)
        .update(username)
        .digest('base64');

      servers.push({
        urls: [
          `turn:${this.turnHost}:${this.turnPort}?transport=udp`,
          `turn:${this.turnHost}:${this.turnPort}?transport=tcp`,
        ],
        username,
        credential,
      });
    }

    return servers;
  }
}

export const iceServerService = new IceServerService();
export default iceServerService;
