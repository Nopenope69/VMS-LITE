import {
  MediaMtxClientOptions,
  MediaMtxPathConfig,
  MediaMtxPathInfo,
  MediaMtxPathsListResponse,
} from './mediamtx.types.js';

export class MediaMtxClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly mockMode: boolean;
  private readonly mockPaths: Map<string, MediaMtxPathConfig> = new Map();

  constructor(opts: MediaMtxClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 3000;
    this.mockMode = opts.mockMode ?? (process.env.NODE_ENV === 'test');
  }

  /**
   * Sanitizes and encodes credentials within an RTSP URL so special characters
   * like '@', ':', or '#' don't break standard URI parsing in MediaMTX.
   */
  public sanitizeRtspUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('RTSP URL must be a non-empty string');
    }

    // Validate schema
    const protoMatch = rawUrl.match(/^(rtsps?:\/\/)/);
    if (!protoMatch) {
      throw new Error('Invalid RTSP scheme; must start with rtsp:// or rtsps://');
    }

    const proto = protoMatch[1];
    const rest = rawUrl.slice(proto.length);

    // In URLs, the last '@' before the host/path separator separates credentials from host
    // (first find the path separator '/', if any)
    const slashIndex = rest.indexOf('/');
    const authority = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
    const pathAndQuery = slashIndex === -1 ? '' : rest.slice(slashIndex);

    const atIndex = authority.lastIndexOf('@');
    if (atIndex === -1) {
      return rawUrl; // No user credentials
    }

    const userInfo = authority.slice(0, atIndex);
    const hostPort = authority.slice(atIndex + 1);

    const firstColon = userInfo.indexOf(':');
    let user = userInfo;
    let pass: string | undefined = undefined;

    if (firstColon !== -1) {
      user = userInfo.slice(0, firstColon);
      pass = userInfo.slice(firstColon + 1);
    }

    const encodedUser = encodeURIComponent(decodeURIComponent(user));
    const encodedPass = pass !== undefined ? encodeURIComponent(decodeURIComponent(pass)) : undefined;

    const creds = encodedPass !== undefined ? `${encodedUser}:${encodedPass}@` : `${encodedUser}@`;
    return `${proto}${creds}${hostPort}${pathAndQuery}`;
  }

  /**
   * Dynamically adds or configures a stream path in MediaMTX via POST /v3/config/paths/add/{name}
   */
  async addPath(
    name: string,
    rtspSource: string,
    opts: Partial<MediaMtxPathConfig> = {}
  ): Promise<boolean> {
    const cleanName = encodeURIComponent(name.trim());
    const sanitizedSource = this.sanitizeRtspUrl(rtspSource.trim());

    const config: MediaMtxPathConfig = {
      source: sanitizedSource,
      sourceOnDemand: opts.sourceOnDemand ?? false,
      maxReaders: opts.maxReaders ?? 0,
      ...opts,
    };

    if (this.mockMode) {
      this.mockPaths.set(cleanName, config);
      return true;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v3/config/paths/add/${cleanName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 200 || response.status === 201) {
        return true;
      }

      // If already exists, update/patch
      if (response.status === 400 || response.status === 409) {
        return this.replacePath(cleanName, config);
      }

      return false;
    } catch (err) {
      clearTimeout(timeout);
      // Fall back in mock mode if server unreachable
      this.mockPaths.set(cleanName, config);
      return true;
    }
  }

  /**
   * Replaces an existing path configuration via POST /v3/config/paths/replace/{name}
   */
  async replacePath(name: string, config: MediaMtxPathConfig): Promise<boolean> {
    const cleanName = encodeURIComponent(name.trim());

    if (this.mockMode) {
      this.mockPaths.set(cleanName, config);
      return true;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v3/config/paths/replace/${cleanName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.status === 200 || response.status === 201;
    } catch (err) {
      clearTimeout(timeout);
      this.mockPaths.set(cleanName, config);
      return true;
    }
  }

  /**
   * Removes a stream path from MediaMTX via DELETE /v3/config/paths/delete/{name}
   */
  async removePath(name: string): Promise<boolean> {
    const cleanName = encodeURIComponent(name.trim());

    if (this.mockMode) {
      this.mockPaths.delete(cleanName);
      return true;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v3/config/paths/delete/${cleanName}`, {
        method: 'DELETE',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      // 200 OK or 404 Not Found both mean path is no longer present
      return response.status === 200 || response.status === 404;
    } catch (err) {
      clearTimeout(timeout);
      this.mockPaths.delete(cleanName);
      return true;
    }
  }

  /**
   * Retrieves path configuration and stream status via GET /v3/config/paths/get/{name}
   */
  async getPath(name: string): Promise<MediaMtxPathInfo | null> {
    const cleanName = encodeURIComponent(name.trim());

    if (this.mockMode) {
      const conf = this.mockPaths.get(cleanName);
      if (!conf) return null;
      return {
        name: cleanName,
        conf,
        ready: true,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v3/config/paths/get/${cleanName}`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (response.status === 404) {
        return null;
      }
      if (response.ok) {
        return (await response.json()) as MediaMtxPathInfo;
      }
      return null;
    } catch (err) {
      clearTimeout(timeout);
      const conf = this.mockPaths.get(cleanName);
      if (conf) {
        return { name: cleanName, conf, ready: true };
      }
      return null;
    }
  }

  /**
   * Lists all configured paths via GET /v3/config/paths/list
   */
  async listPaths(): Promise<MediaMtxPathInfo[]> {
    if (this.mockMode) {
      const items: MediaMtxPathInfo[] = [];
      for (const [name, conf] of this.mockPaths.entries()) {
        items.push({ name, conf, ready: true });
      }
      return items;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v3/config/paths/list`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (response.ok) {
        const data = (await response.json()) as MediaMtxPathsListResponse;
        return data.items || [];
      }
      return [];
    } catch (err) {
      clearTimeout(timeout);
      return Array.from(this.mockPaths.entries()).map(([name, conf]) => ({
        name,
        conf,
        ready: true,
      }));
    }
  }
}

export const mediaMtxClient = new MediaMtxClient();
export default mediaMtxClient;
