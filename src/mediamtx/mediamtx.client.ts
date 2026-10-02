import {
  MediaMtxClientOptions,
  MediaMtxPathConfig,
  MediaMtxPathInfo,
  MediaMtxPathsListResponse,
} from './mediamtx.types.js';

export class MediaMtxUnavailableError extends Error {
  public readonly code = 'MEDIAMTX_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'MediaMtxUnavailableError';
  }
}

/**
 * Thin client for the MediaMTX v3 control API.
 *
 * Network failures surface as MediaMtxUnavailableError. The in-memory path table is
 * only used in explicit mock mode (unit tests); it is never a fallback for a down
 * media server, because reporting success there hides real outages (cameras looked
 * "online" and onboarding "succeeded" with MediaMTX stopped).
 */
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

    const protoMatch = rawUrl.match(/^(rtsps?:\/\/)/);
    if (!protoMatch) {
      throw new Error('Invalid RTSP scheme; must start with rtsp:// or rtsps://');
    }

    const proto = protoMatch[1];
    const rest = rawUrl.slice(proto.length);

    // The last '@' before the first path separator splits credentials from host
    const slashIndex = rest.indexOf('/');
    const authority = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
    const pathAndQuery = slashIndex === -1 ? '' : rest.slice(slashIndex);

    const atIndex = authority.lastIndexOf('@');
    if (atIndex === -1) {
      return rawUrl;
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

    const encodedUser = encodeURIComponent(safeDecode(user));
    const encodedPass = pass !== undefined ? encodeURIComponent(safeDecode(pass)) : undefined;

    const creds = encodedPass !== undefined ? `${encodedUser}:${encodedPass}@` : `${encodedUser}@`;
    return `${proto}${creds}${hostPort}${pathAndQuery}`;
  }

  /**
   * Sets or updates path configuration in MediaMTX.
   */
  async setPath(
    name: string,
    config: Partial<MediaMtxPathConfig> & { source: string }
  ): Promise<boolean> {
    return this.addPath(name, config.source, config);
  }

  /**
   * Adds a path (POST /v3/config/paths/add/{name}); replaces it if it already exists.
   */
  async addPath(
    name: string,
    rtspSource: string,
    opts: Partial<MediaMtxPathConfig> = {}
  ): Promise<boolean> {
    const cleanName = encodeURIComponent(name.trim());
    const config: MediaMtxPathConfig = {
      sourceOnDemand: false,
      ...opts,
      source: this.sanitizeRtspUrl(rtspSource.trim()),
    };

    if (this.mockMode) {
      this.mockPaths.set(cleanName, config);
      return true;
    }

    const response = await this.request('POST', `/v3/config/paths/add/${cleanName}`, config);
    if (response.ok) {
      return true;
    }
    // Path already exists: replace its configuration
    if (response.status === 400 || response.status === 409) {
      return this.replacePath(name, config);
    }
    throw new Error(`MediaMTX rejected path ${name}: HTTP ${response.status} ${await safeText(response)}`);
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

    const response = await this.request('POST', `/v3/config/paths/replace/${cleanName}`, config);
    if (!response.ok) {
      throw new Error(`MediaMTX failed to replace path ${name}: HTTP ${response.status} ${await safeText(response)}`);
    }
    return true;
  }

  /**
   * Patches an existing path configuration via PATCH /v3/config/paths/patch/{name}
   */
  async patchPath(name: string, patch: Partial<MediaMtxPathConfig>): Promise<boolean> {
    const cleanName = encodeURIComponent(name.trim());

    if (this.mockMode) {
      const existing = this.mockPaths.get(cleanName) || { source: '' };
      this.mockPaths.set(cleanName, { ...existing, ...patch });
      return true;
    }

    const response = await this.request('PATCH', `/v3/config/paths/patch/${cleanName}`, patch);
    if (!response.ok) {
      throw new Error(`MediaMTX failed to patch path ${name}: HTTP ${response.status} ${await safeText(response)}`);
    }
    return true;
  }

  /**
   * Removes a path via DELETE /v3/config/paths/delete/{name}. Missing paths count as removed.
   */
  async removePath(name: string): Promise<boolean> {
    const cleanName = encodeURIComponent(name.trim());

    if (this.mockMode) {
      this.mockPaths.delete(cleanName);
      return true;
    }

    const response = await this.request('DELETE', `/v3/config/paths/delete/${cleanName}`);
    if (response.ok || response.status === 404) {
      return true;
    }
    throw new Error(`MediaMTX failed to remove path ${name}: HTTP ${response.status}`);
  }

  /**
   * Retrieves a path's configuration via GET /v3/config/paths/get/{name}; null if absent.
   */
  async getPath(name: string): Promise<MediaMtxPathInfo | null> {
    const cleanName = encodeURIComponent(name.trim());

    if (this.mockMode) {
      const conf = this.mockPaths.get(cleanName);
      return conf ? { name: cleanName, conf, ready: true } : null;
    }

    const response = await this.request('GET', `/v3/config/paths/get/${cleanName}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`MediaMTX failed to read path ${name}: HTTP ${response.status}`);
    }
    // The config endpoint returns the bare path configuration
    const conf = (await response.json()) as MediaMtxPathConfig;
    const runtime = await this.getPathRuntime(name).catch(() => null);
    return { name: cleanName, conf, ready: runtime?.ready ?? false };
  }

  /**
   * Retrieves runtime path status and byte counters via GET /v3/paths/get/{name}.
   * Returns null when the path has no runtime state (not configured / no source).
   */
  async getPathRuntime(name: string): Promise<{ ready: boolean; bytesReceived: number } | null> {
    const cleanName = encodeURIComponent(name.trim());

    if (this.mockMode) {
      const conf = this.mockPaths.get(cleanName);
      if (!conf) return null;
      return { ready: true, bytesReceived: Math.floor(Date.now() * 125) }; // ~1 Mbps
    }

    const response = await this.request('GET', `/v3/paths/get/${cleanName}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`MediaMTX failed to read runtime for ${name}: HTTP ${response.status}`);
    }
    const data = (await response.json()) as any;
    return {
      ready: Boolean(data.ready),
      bytesReceived: Number(data.bytesReceived || 0),
    };
  }

  /**
   * Lists configured paths via GET /v3/config/paths/list
   */
  async listPaths(): Promise<MediaMtxPathInfo[]> {
    if (this.mockMode) {
      return Array.from(this.mockPaths.entries()).map(([name, conf]) => ({ name, conf, ready: true }));
    }

    const response = await this.request('GET', '/v3/config/paths/list?itemsPerPage=1000');
    if (!response.ok) {
      throw new Error(`MediaMTX failed to list paths: HTTP ${response.status}`);
    }
    const data = (await response.json()) as MediaMtxPathsListResponse & { items: any[] };
    return (data.items || []).map((item: any) => ({ name: item.name, conf: item, ready: undefined }));
  }

  private async request(method: string, urlPath: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${urlPath}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = (err as Error).name === 'AbortError' ? `timed out after ${this.timeoutMs}ms` : (err as Error).message;
      throw new MediaMtxUnavailableError(`MediaMTX API at ${this.baseUrl} unreachable: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // Contains a literal '%' that is not an escape sequence
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}

export const mediaMtxClient = new MediaMtxClient();
export default mediaMtxClient;
