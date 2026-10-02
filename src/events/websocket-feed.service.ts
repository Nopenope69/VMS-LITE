import http from 'http';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { EventBus, eventBus as defaultEventBus } from './event-bus.js';
import { EventRecord } from './event.types.js';
import { UserTokenPayload } from '../users/rbac.guard.js';

export type JwtVerifier = (token: string) => Promise<UserTokenPayload> | UserTokenPayload;

export interface WebSocketFeedOptions {
  path?: string;
  heartbeatIntervalMs?: number;
  maxBufferSize?: number; // bytes
}

interface AuthenticatedSocket extends WebSocket {
  isAlive?: boolean;
  user?: UserTokenPayload;
  /** null = all cameras; otherwise the operator's granted cameras (refreshed periodically). */
  visibleCameraIds?: Set<string> | null;
  visibleLoadedAt?: number;
}

/** Event types that are internal bookkeeping and not useful to UI clients. */
const NON_BROADCAST_EVENT_TYPES = new Set(['recording.segment_created']);
const ACCESS_REFRESH_MS = 60_000;

export type CameraAccessResolver = (user: UserTokenPayload) => Promise<string[] | null>;

export class WebSocketFeedService {
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private path: string;
  private heartbeatIntervalMs: number;
  private maxBufferSize: number;

  private accessResolver: CameraAccessResolver = async (user) => {
    const { getVisibleCameraIds } = await import('../users/camera-access.js');
    return getVisibleCameraIds(user);
  };

  constructor(
    private readonly eventBus: EventBus = defaultEventBus,
    opts: WebSocketFeedOptions = {}
  ) {
    this.path = opts.path || '/api/events/feed';
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs || 30000;
    this.maxBufferSize = opts.maxBufferSize || 1024 * 1024; // 1 MB (T-06-04)
  }

  /**
   * Attaches WebSocket server to Node HTTP server and listens for upgrade requests.
   */
  attach(server: http.Server, verifyToken: JwtVerifier): WebSocketServer {
    this.wss = new WebSocketServer({ noServer: true });

    // Handle HTTP Upgrade requests
    server.on('upgrade', async (req, socket, head) => {
      try {
        const reqUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

        // Only handle requests matching our path
        if (reqUrl.pathname !== this.path) {
          return;
        }

        // Extract token from query params or Authorization header (T-06-03)
        let token = reqUrl.searchParams.get('token');
        if (!token && req.headers['authorization']) {
          const auth = req.headers['authorization'];
          if (auth.startsWith('Bearer ')) {
            token = auth.slice(7).trim();
          }
        }
        if (!token && req.headers['sec-websocket-protocol']) {
          // Token passed as subprotocol
          token = req.headers['sec-websocket-protocol'].split(',')[0].trim();
        }

        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        let user: UserTokenPayload;
        try {
          user = await verifyToken(token);
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        let visible: string[] | null = null;
        try {
          visible = await this.accessResolver(user);
        } catch {
          visible = [];
        }

        // Upgrade socket and emit connection
        this.wss?.handleUpgrade(req, socket, head, (ws) => {
          const authSocket = ws as AuthenticatedSocket;
          authSocket.user = user;
          authSocket.visibleCameraIds = visible ? new Set(visible) : null;
          authSocket.visibleLoadedAt = Date.now();
          authSocket.isAlive = true;
          this.wss?.emit('connection', authSocket, req);
        });
      } catch (err) {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    });

    // Connection lifecycle
    this.wss.on('connection', (ws: AuthenticatedSocket) => {
      ws.isAlive = true;

      // Handle Pong from client
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle incoming messages (e.g. client-side ping or subscribe filters)
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          }
        } catch {
          // Ignore unparseable frames
        }
      });

      // Send initial welcome message
      ws.send(
        JSON.stringify({
          type: 'connected',
          user: ws.user ? { username: ws.user.username, role: ws.user.role } : undefined,
          timestamp: new Date().toISOString(),
        })
      );
    });

    // Subscribe to EventBus and broadcast to all connected clients
    this.unsubscribeBus = this.eventBus.subscribe('*', (event: EventRecord) => {
      this.broadcast(event);
    });

    // Start heartbeat ping/pong timer
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.heartbeatIntervalMs);

    return this.wss;
  }

  /**
   * Broadcasts an event record to all authenticated, active clients.
   */
  broadcast(event: EventRecord): void {
    if (!this.wss) return;
    if (NON_BROADCAST_EVENT_TYPES.has(event.type)) return;

    const payload = JSON.stringify({
      type: 'event',
      event,
    });

    for (const client of this.wss.clients) {
      const authClient = client as AuthenticatedSocket;
      if (authClient.readyState === WebSocket.OPEN) {
        if (!this.canSee(authClient, event)) {
          continue;
        }
        // Slow consumer defense (T-06-04): drop socket if buffered amount exceeds limit
        if (authClient.bufferedAmount > this.maxBufferSize) {
          console.warn('[WebSocketFeed] Dropping slow consumer exceeding send buffer limit');
          authClient.terminate();
          continue;
        }

        try {
          authClient.send(payload);
        } catch (err) {
          console.error('[WebSocketFeed] Error sending event to client:', err);
        }
      }
    }
  }

  setAccessResolver(resolver: CameraAccessResolver): void {
    this.accessResolver = resolver;
  }

  private canSee(client: AuthenticatedSocket, event: EventRecord): boolean {
    if (client.visibleCameraIds === null || client.visibleCameraIds === undefined) {
      return true;
    }
    if (client.user && Date.now() - (client.visibleLoadedAt ?? 0) > ACCESS_REFRESH_MS) {
      client.visibleLoadedAt = Date.now();
      this.accessResolver(client.user)
        .then((ids) => {
          client.visibleCameraIds = ids ? new Set(ids) : null;
        })
        .catch(() => {});
    }
    if (event.cameraId) {
      return client.visibleCameraIds.has(event.cameraId);
    }
    // Site-level events list the site's cameras: visible to whoever can see one of them
    if (event.siteId) {
      const siteCameras = (event.metadata as { cameraIds?: unknown })?.cameraIds;
      return Array.isArray(siteCameras) && siteCameras.some((id) => client.visibleCameraIds!.has(String(id)));
    }
    // System-wide events (storage, etc.) are visible to everyone
    return true;
  }

  /**
   * Pings all connected sockets and terminates dead ones.
   */
  private checkHeartbeats(): void {
    if (!this.wss) return;

    for (const client of this.wss.clients) {
      const authClient = client as AuthenticatedSocket;
      if (authClient.isAlive === false) {
        authClient.terminate();
        continue;
      }

      authClient.isAlive = false;
      try {
        authClient.ping();
      } catch {
        authClient.terminate();
      }
    }
  }

  /**
   * Gets total number of currently connected clients.
   */
  getClientCount(): number {
    return this.wss ? this.wss.clients.size : 0;
  }

  /**
   * Shuts down WebSocket server and cleans up resources.
   */
  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }

    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = null;
    }
  }
}

export const webSocketFeedService = new WebSocketFeedService();
export default webSocketFeedService;
