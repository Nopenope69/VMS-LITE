export interface EventPayload {
  id: string;
  cameraId: string | null;
  timestamp: string;
  type: string;
  source: string;
  severity: 'info' | 'warning' | 'critical';
  metadata: Record<string, any>;
}

export type EventListener = (event: EventPayload) => void;
export type StatusListener = (connected: boolean) => void;

export interface EventsWsClientOptions {
  wsUrl?: string;
  token?: string;
  reconnectIntervalMs?: number;
  maxReconnectIntervalMs?: number;
}

export class EventsWsClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private token: string;
  private reconnectIntervalMs: number;
  private maxReconnectIntervalMs: number;
  private currentReconnectDelay: number;
  private reconnectTimer: any = null;
  private shouldReconnect = true;
  private isConnected = false;

  private eventListeners = new Set<EventListener>();
  private statusListeners = new Set<StatusListener>();

  constructor(opts: EventsWsClientOptions = {}) {
    let defaultWsUrl = '';
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      defaultWsUrl = `${proto}//${window.location.host}/api/events/feed`;
    }

    this.wsUrl = opts.wsUrl || defaultWsUrl;
    this.token = opts.token || '';
    this.reconnectIntervalMs = opts.reconnectIntervalMs || 1000;
    this.maxReconnectIntervalMs = opts.maxReconnectIntervalMs || 15000;
    this.currentReconnectDelay = this.reconnectIntervalMs;
  }

  /**
   * Updates authorization token for subsequent connections.
   */
  setToken(token: string): void {
    this.token = token;
    if (this.ws && this.isConnected) {
      // Reconnect with new credentials
      this.reconnect();
    }
  }

  /**
   * Connects to the WebSocket feed.
   */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.shouldReconnect = true;
    try {
      const url = new URL(this.wsUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
      if (this.token) {
        url.searchParams.set('token', this.token);
      }

      this.ws = new WebSocket(url.toString());

      this.ws.onopen = () => {
        this.isConnected = true;
        this.currentReconnectDelay = this.reconnectIntervalMs;
        this.notifyStatus(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'event' && data.event) {
            this.notifyEvent(data.event);
          }
        } catch {
          // Ignore invalid JSON frames
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.notifyStatus(false);
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // Error will trigger onclose
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  /**
   * Subscribes to incoming events.
   */
  subscribe(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Subscribes to connection status changes.
   */
  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.isConnected);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Force reconnect immediately.
   */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  /**
   * Disconnects and stops automatic reconnection.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.notifyStatus(false);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.currentReconnectDelay = Math.min(
        this.maxReconnectIntervalMs,
        this.currentReconnectDelay * 1.5
      );
      this.connect();
    }, this.currentReconnectDelay);
  }

  private notifyEvent(event: EventPayload): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[EventsWsClient] Listener error:', err);
      }
    }
  }

  private notifyStatus(connected: boolean): void {
    for (const listener of this.statusListeners) {
      try {
        listener(connected);
      } catch (err) {
        console.error('[EventsWsClient] Status listener error:', err);
      }
    }
  }
}

export default EventsWsClient;
