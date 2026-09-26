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
}

export class WebSocketFeedService {
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private path: string;
  private heartbeatIntervalMs: number;
  private maxBufferSize: number;

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

        // Upgrade socket and emit connection
        this.wss?.handleUpgrade(req, socket, head, (ws) => {
          const authSocket = ws as AuthenticatedSocket;
          authSocket.user = user;
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

    const payload = JSON.stringify({
      type: 'event',
      event,
    });

    for (const client of this.wss.clients) {
      const authClient = client as AuthenticatedSocket;
      if (authClient.readyState === WebSocket.OPEN) {
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
