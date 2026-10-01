import crypto from 'crypto';
import { EventBus, eventBus as defaultEventBus } from './event-bus.js';
import { CoreEventType } from './event.types.js';
import {
  OnvifEventSubscription,
  ParsedOnvifEvent,
  ONVIF_TOPIC_CELL_MOTION,
  ONVIF_TOPIC_VIDEO_SOURCE_MOTION,
  ONVIF_TOPIC_TAMPER,
} from './onvif-events.types.js';
import { spatialMotionFilter } from '../zones/spatial-motion-filter.js';

export interface CameraSubscriptionInput {
  id: string;
  name: string;
  ip?: string;
  port?: number;
  onvifXAddr?: string | null;
  username?: string | null;
  password?: string | null;
}

/**
 * Resolves a camera's ONVIF connection details from the database.
 * Returns undefined when the camera is unknown, null when it is not an ONVIF camera.
 */
export type OnvifCameraLookup = (cameraId: string) => Promise<CameraSubscriptionInput | null | undefined>;
export type OnvifCameraLister = () => Promise<CameraSubscriptionInput[]>;

function toSubscriptionInput(camera: any): CameraSubscriptionInput | null {
  if (!camera.onvifUrl) return null;
  return {
    id: camera.id,
    name: camera.name,
    ip: camera.ip ?? undefined,
    port: camera.port ?? undefined,
    onvifXAddr: camera.onvifUrl,
    username: camera.username,
    password: camera.password,
  };
}

const defaultCameraLookup: OnvifCameraLookup = async (cameraId) => {
  const { prisma } = await import('../db/prisma.js');
  const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
  return camera ? toSubscriptionInput(camera) : undefined;
};

const defaultCameraLister: OnvifCameraLister = async () => {
  const { prisma } = await import('../db/prisma.js');
  const cameras = await prisma.camera.findMany({ where: { onvifUrl: { not: null } } });
  return cameras.map(toSubscriptionInput).filter(Boolean) as CameraSubscriptionInput[];
};

/** Requested pull-point lifetime; renewed well before it lapses. */
const SUBSCRIPTION_LIFETIME = 'PT120S';
const SUBSCRIPTION_LIFETIME_MS = 120_000;
const RENEW_MARGIN_MS = 30_000;
const PULL_TIMEOUT = 'PT5S';
const HTTP_TIMEOUT_MS = 15_000;

export class OnvifEventListenerService {
  private subscriptions = new Map<string, OnvifEventSubscription>();
  private pollTimeouts = new Map<string, NodeJS.Timeout>();
  private mockMode = false;
  private mockEventTrigger?: (cameraId: string) => void;
  private isListening = false;
  private eventUnsubscribers: (() => void)[] = [];

  private readonly cameraLookup: OnvifCameraLookup;
  private readonly cameraLister: OnvifCameraLister;

  constructor(
    private readonly eventBus: EventBus = defaultEventBus,
    mockMode = false,
    deps: { cameraLookup?: OnvifCameraLookup; cameraLister?: OnvifCameraLister } = {}
  ) {
    this.mockMode = mockMode || process.env.NODE_ENV === 'test';
    this.cameraLookup = deps.cameraLookup || defaultCameraLookup;
    this.cameraLister = deps.cameraLister || defaultCameraLister;
  }

  /**
   * Starts listening to EventBus lifecycle events to automatically manage subscriptions.
   */
  start(): void {
    if (this.isListening) return;
    this.isListening = true;

    const unsubOnline = this.eventBus.subscribe('camera.online', async (event) => {
      if (!event.cameraId) return;
      try {
        const input = await this.resolveCamera(event.cameraId, event.metadata as any);
        if (input) {
          await this.subscribeCamera(input);
        }
      } catch (err: any) {
        console.warn(`[OnvifEventListenerService] Auto-subscribe failed for camera ${event.cameraId}:`, err.message);
      }
    });

    // Subscribe cameras that already exist: nothing re-announces them after a restart
    if (!this.mockMode) {
      this.cameraLister()
        .then(async (cameras) => {
          for (const camera of cameras) {
            if (this.isListening && !this.subscriptions.has(camera.id)) {
              await this.subscribeCamera(camera).catch(() => {});
            }
          }
        })
        .catch((err) => console.warn('[OnvifEventListenerService] Failed to load ONVIF cameras:', err.message));
    }

    const unsubOffline = this.eventBus.subscribe('camera.offline', (event) => {
      if (event.cameraId) {
        this.unsubscribeCamera(event.cameraId);
      }
    });

    const unsubDeleted = this.eventBus.subscribe('camera.deleted', (event) => {
      if (event.cameraId) {
        this.unsubscribeCamera(event.cameraId);
      }
    });

    this.eventUnsubscribers.push(unsubOnline, unsubOffline, unsubDeleted);
  }

  /**
   * Connection details come from the database (credentials are never carried in
   * events). Event metadata is only used for cameras the database does not know,
   * which happens in isolated unit tests.
   */
  private async resolveCamera(cameraId: string, meta: any): Promise<CameraSubscriptionInput | null> {
    let fromDb: CameraSubscriptionInput | null | undefined;
    try {
      fromDb = await this.cameraLookup(cameraId);
    } catch {
      fromDb = undefined;
    }
    if (fromDb !== undefined) {
      return fromDb;
    }
    if (meta && (meta.onvifXAddr || meta.ip) && !meta.manual) {
      return {
        id: cameraId,
        name: meta.name || 'Camera',
        ip: meta.ip,
        port: meta.port,
        onvifXAddr: meta.onvifXAddr,
        username: meta.username,
      };
    }
    return null;
  }

  /**
   * Stops listening to EventBus and cleans up all active camera subscriptions and polling timeouts.
   */
  stop(): void {
    this.isListening = false;
    for (const unsub of this.eventUnsubscribers) {
      unsub();
    }
    this.eventUnsubscribers = [];

    for (const timeout of this.pollTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.pollTimeouts.clear();

    for (const sub of this.subscriptions.values()) {
      sub.active = false;
    }
    this.subscriptions.clear();
  }

  /**
   * Enables or disables mock mode for unit testing.
   */
  setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }

  /**
   * Gets list of all active camera subscriptions.
   */
  getSubscriptions(): OnvifEventSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Gets active subscription by camera ID.
   */
  getSubscription(cameraId: string): OnvifEventSubscription | undefined {
    return this.subscriptions.get(cameraId);
  }

  /**
   * Subscribes to events for a specific camera and starts PullPoint polling.
   */
  async subscribeCamera(camera: CameraSubscriptionInput): Promise<OnvifEventSubscription> {
    const xaddr =
      camera.onvifXAddr ||
      `http://${camera.ip || '127.0.0.1'}:${camera.port || 80}/onvif/device_service`;

    // Stop existing subscription if any
    this.unsubscribeCamera(camera.id);

    const subscription: OnvifEventSubscription = {
      cameraId: camera.id,
      cameraName: camera.name,
      xaddr,
      username: camera.username || undefined,
      password: camera.password || undefined,
      subscriptionUrl: null,
      terminationTime: null,
      active: true,
      errorCount: 0,
      lastPoll: null,
    };

    this.subscriptions.set(camera.id, subscription);

    if (this.mockMode) {
      subscription.subscriptionUrl = `http://mock-camera:${camera.port || 80}/onvif/subscription/1`;
      subscription.terminationTime = new Date(Date.now() + 60000);
      return subscription;
    }

    // The poll loop creates the pull-point subscription and keeps it alive
    this.schedulePoll(camera.id, 100);
    return subscription;
  }

  /**
   * Unsubscribes from camera events and stops polling worker.
   */
  unsubscribeCamera(cameraId: string): void {
    const timeout = this.pollTimeouts.get(cameraId);
    if (timeout) {
      clearTimeout(timeout);
      this.pollTimeouts.delete(cameraId);
    }

    const sub = this.subscriptions.get(cameraId);
    if (sub) {
      sub.active = false;
      this.subscriptions.delete(cameraId);
      // Free the camera-side pull point (devices allow only a handful)
      if (!this.mockMode && sub.subscriptionUrl) {
        this.soapRequest(sub.subscriptionUrl, this.buildUnsubscribeEnvelope(sub)).catch(() => {});
      }
    }
  }

  /**
   * Generates SOAP XML envelope for CreatePullPointSubscription.
   */
  buildCreatePullPointEnvelope(
    sub: OnvifEventSubscription,
    terminationTime = 'PT60S'
  ): string {
    const securityHeader = this.buildWsSecurityHeader(sub.username, sub.password);
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:tev="http://www.onvif.org/ver10/events/wsdl"
               xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
  <soap:Header>
    ${securityHeader}
  </soap:Header>
  <soap:Body>
    <tev:CreatePullPointSubscription>
      <tev:InitialTerminationTime>${terminationTime}</tev:InitialTerminationTime>
    </tev:CreatePullPointSubscription>
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Generates SOAP XML envelope for PullMessages.
   */
  buildPullMessagesEnvelope(
    sub: OnvifEventSubscription,
    timeout = 'PT5S',
    messageLimit = 10
  ): string {
    const securityHeader = this.buildWsSecurityHeader(sub.username, sub.password);
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:wsa="http://www.w3.org/2005/08/addressing"
               xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  <soap:Header>
    <wsa:Action>http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest</wsa:Action>
    <wsa:To>${escapeXml(sub.subscriptionUrl || '')}</wsa:To>
    ${securityHeader}
  </soap:Header>
  <soap:Body>
    <tev:PullMessages>
      <tev:Timeout>${timeout}</tev:Timeout>
      <tev:MessageLimit>${messageLimit}</tev:MessageLimit>
    </tev:PullMessages>
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Safely parses SOAP XML response for NotificationMessage items (mitigates XXE: T-06-02).
   */
  parseSoapNotification(xml: string): ParsedOnvifEvent[] {
    const events: ParsedOnvifEvent[] = [];

    // Match all NotificationMessage chunks
    const messageRegex = /<(?:[a-zA-Z0-9_]+:)?NotificationMessage[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?NotificationMessage>/gi;
    const matches = xml.match(messageRegex);
    if (!matches) {
      return events;
    }

    for (const msgXml of matches) {
      // Extract Topic
      const topicMatch = msgXml.match(/<(?:[a-zA-Z0-9_]+:)?Topic[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_]+:)?Topic>/i);
      const topic = topicMatch ? topicMatch[1].trim() : '';

      // Extract UtcTime if present
      const timeMatch = msgXml.match(/UtcTime="([^"]+)"/i);
      const timestamp = timeMatch ? new Date(timeMatch[1]) : new Date();

      // Extract SimpleItem key-value attributes
      const simpleItemRegex = /<(?:[a-zA-Z0-9_]+:)?SimpleItem\s+Name="([^"]+)"\s+Value="([^"]+)"/gi;
      const data: Record<string, string> = {};
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = simpleItemRegex.exec(msgXml)) !== null) {
        data[itemMatch[1]] = itemMatch[2];
      }

      // Detect motion states
      const isMotionTopic =
        topic.includes('CellMotionDetector') ||
        topic.includes('MotionAlarm') ||
        topic.includes('Motion');

      const isMotionValue =
        data['IsMotion'] === 'true' ||
        data['State'] === 'true' ||
        data['Value'] === 'true' ||
        data['Active'] === 'true';

      const isMotion = isMotionTopic && isMotionValue;

      // Detect tamper state
      const isTamper =
        topic.includes('Tamper') &&
        (data['State'] === 'true' || data['Value'] === 'true');

      if (topic) {
        events.push({
          topic,
          isMotion,
          isTamper,
          timestamp,
          data,
        });
      }
    }

    return events;
  }

  /**
   * Extracts spatial coordinates, point, or grid cells from ONVIF event data.
   */
  private extractSpatialCoordinates(data: Record<string, any>): {
    point?: { x: number; y: number };
    cells?: Array<{ col: number; row: number }>;
    totalCols?: number;
    totalRows?: number;
  } | null {
    if (!data) return null;

    // Direct point object
    if (data.point && typeof data.point.x === 'number' && typeof data.point.y === 'number') {
      return { point: data.point };
    }

    // Direct normalized coordinates (case-insensitive)
    const rawX = data.x ?? data.X;
    const rawY = data.y ?? data.Y;
    if (rawX !== undefined && rawY !== undefined) {
      const x = typeof rawX === 'number' ? rawX : parseFloat(rawX);
      const y = typeof rawY === 'number' ? rawY : parseFloat(rawY);
      if (!isNaN(x) && !isNaN(y)) {
        return { point: { x, y } };
      }
    }

    // Active cells array
    const rawCells = data.cells ?? data.activeCells;
    const totalCols = parseInt(String(data.Columns ?? data.columns ?? '32'), 10);
    const totalRows = parseInt(String(data.Rows ?? data.rows ?? '24'), 10);

    if (Array.isArray(rawCells) && rawCells.length > 0) {
      return {
        cells: rawCells,
        totalCols: isNaN(totalCols) ? 32 : totalCols,
        totalRows: isNaN(totalRows) ? 24 : totalRows,
      };
    }

    // ONVIF bitmask Data string
    if (data.Data && typeof data.Data === 'string' && data.Columns && data.Rows) {
      try {
        const cols = isNaN(totalCols) ? 32 : totalCols;
        const rows = isNaN(totalRows) ? 24 : totalRows;
        const buffer = Buffer.from(data.Data, 'base64');
        const cells: Array<{ col: number; row: number }> = [];

        for (let byteIdx = 0; byteIdx < buffer.length; byteIdx++) {
          const byteVal = buffer[byteIdx];
          if (byteVal === 0) continue;
          for (let bit = 0; bit < 8; bit++) {
            if ((byteVal & (1 << bit)) !== 0) {
              const cellIdx = byteIdx * 8 + bit;
              const col = cellIdx % cols;
              const row = Math.floor(cellIdx / cols);
              if (col < cols && row < rows) {
                cells.push({ col, row });
              }
            }
          }
        }

        if (cells.length > 0) {
          return { cells, totalCols: cols, totalRows: rows };
        }
      } catch {
        // Fallback if data is not base64
      }
    }

    return null;
  }

  /**
   * Processes parsed ONVIF events and emits to Core event bus (EVT-04).
   */
  async processEvents(cameraId: string, events: ParsedOnvifEvent[]): Promise<void> {
    const sub = this.subscriptions.get(cameraId);
    if (!sub) return;

    for (const event of events) {
      if (event.isMotion) {
        // Phase 11 (EXT-02): Check spatial zones if configured
        const zones = spatialMotionFilter.getCameraZones(sub.cameraId);
        let spatialFiltered = false;
        let spatialVerified: boolean | undefined = undefined;
        let matchedInclusion: string[] | undefined = undefined;

        if (zones && zones.length > 0) {
          const spatial = this.extractSpatialCoordinates(event.data);
          if (spatial) {
            if (spatial.point) {
              const evalRes = spatialMotionFilter.evaluateMotionPoint(spatial.point, zones);
              if (!evalRes.allowed) {
                // Suppressed by spatial filter!
                continue;
              }
              spatialFiltered = true;
              spatialVerified = true;
              matchedInclusion = evalRes.matchedInclusion;
            } else if (spatial.cells && spatial.cells.length > 0) {
              const evalRes = spatialMotionFilter.evaluateCellGrid(
                spatial.cells,
                spatial.totalCols || 32,
                spatial.totalRows || 24,
                zones
              );
              if (!evalRes.allowed) {
                // Suppressed by spatial filter!
                continue;
              }
              spatialFiltered = true;
              spatialVerified = true;
              matchedInclusion = evalRes.matchedInclusion;
            }
          } else {
            // Coarse binary alarm without spatial metadata: passes with warning flag (legacy camera parity)
            spatialVerified = false;
          }
        }

        await this.eventBus.emitEvent({
          cameraId: sub.cameraId,
          timestamp: event.timestamp,
          type: CoreEventType.MOTION_DETECTED,
          source: 'onvif.motion',
          severity: 'warning',
          metadata: {
            cameraName: sub.cameraName,
            topic: event.topic,
            data: event.data,
            ...(spatialFiltered ? { spatialFiltered: true, matchedInclusion } : {}),
            ...(spatialVerified === false ? { spatialVerified: false } : {}),
          },
        });
      } else if (event.isTamper) {
        await this.eventBus.emitEvent({
          cameraId: sub.cameraId,
          timestamp: event.timestamp,
          type: 'camera.tamper',
          source: 'onvif.tamper',
          severity: 'critical',
          metadata: {
            cameraName: sub.cameraName,
            topic: event.topic,
            data: event.data,
          },
        });
      }
    }
  }

  /**
   * Mock trigger to simulate camera motion detection in tests.
   */
  async triggerMockMotion(cameraId: string, extraData: Record<string, any> = {}): Promise<void> {
    const sub = this.subscriptions.get(cameraId);
    if (!sub) return;

    await this.processEvents(cameraId, [
      {
        topic: ONVIF_TOPIC_CELL_MOTION,
        isMotion: true,
        isTamper: false,
        timestamp: new Date(),
        data: { IsMotion: 'true', ...extraData },
      },
    ]);
  }

  /**
   * Initiates SOAP CreatePullPointSubscription.
   */
  private async initiatePullPointSubscription(sub: OnvifEventSubscription): Promise<void> {
    const eventServiceUrl = sub.xaddr.replace(/device_service.*$/, 'event_service');
    const xmlText = await this.soapRequest(eventServiceUrl, this.buildCreatePullPointEnvelope(sub, SUBSCRIPTION_LIFETIME));

    const addressMatch = xmlText.match(/<(?:[a-zA-Z0-9_]+:)?Address[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_]+:)?Address>/i);
    if (!addressMatch) {
      throw new Error('No SubscriptionReference Address returned in PullPoint response');
    }

    sub.subscriptionUrl = addressMatch[1].trim();
    sub.terminationTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS);
  }

  /**
   * Extends the subscription lifetime (WS-BaseNotification Renew).
   */
  private async renewSubscription(sub: OnvifEventSubscription): Promise<void> {
    await this.soapRequest(sub.subscriptionUrl!, this.buildRenewEnvelope(sub, SUBSCRIPTION_LIFETIME));
    sub.terminationTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS);
  }

  private async soapRequest(url: string, envelope: string): Promise<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      body: envelope,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`ONVIF request to ${url} failed with HTTP ${res.status}`);
    }
    return text;
  }

  /**
   * Schedules next PullMessages poll.
   */
  private schedulePoll(cameraId: string, delayMs: number): void {
    const existing = this.pollTimeouts.get(cameraId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pollOnce(cameraId).catch(() => {});
    }, delayMs);

    this.pollTimeouts.set(cameraId, timer);
  }

  /**
   * One poll cycle: ensure a live subscription (create or renew), then PullMessages.
   * Any failure drops the subscription so the next cycle re-creates it after backoff;
   * re-polling a lapsed subscription URL would never recover.
   */
  private async pollOnce(cameraId: string): Promise<void> {
    const sub = this.subscriptions.get(cameraId);
    if (!sub || !sub.active) {
      return;
    }

    try {
      if (!sub.subscriptionUrl) {
        await this.initiatePullPointSubscription(sub);
      } else if (!sub.terminationTime || sub.terminationTime.getTime() - Date.now() < RENEW_MARGIN_MS) {
        try {
          await this.renewSubscription(sub);
        } catch {
          await this.initiatePullPointSubscription(sub);
        }
      }
      if (!sub.active) return;

      const xmlText = await this.soapRequest(
        sub.subscriptionUrl!,
        this.buildPullMessagesEnvelope(sub, PULL_TIMEOUT, 10)
      );
      sub.lastPoll = new Date();
      sub.errorCount = 0;

      const events = this.parseSoapNotification(xmlText);
      if (events.length > 0) {
        await this.processEvents(cameraId, events);
      }

      // PullMessages long-polls for up to PULL_TIMEOUT, so poll again right away
      this.schedulePoll(cameraId, 100);
    } catch (err) {
      sub.errorCount += 1;
      sub.subscriptionUrl = null;
      sub.terminationTime = null;
      if (sub.errorCount === 1 || sub.errorCount % 20 === 0) {
        console.warn(`[OnvifEventListener] Camera ${cameraId} event subscription error (#${sub.errorCount}): ${(err as Error).message}`);
      }
      this.scheduleReconnect(cameraId);
    }
  }

  /**
   * Schedules reconnection with exponential backoff and jitter (T-06-01).
   */
  private scheduleReconnect(cameraId: string): void {
    const sub = this.subscriptions.get(cameraId);
    if (!sub || !sub.active) return;

    // Backoff: 2s, 4s, 8s, up to 30s max
    const backoffMs = Math.min(30000, Math.pow(2, sub.errorCount) * 1000);
    const jitter = Math.floor(Math.random() * 500);
    this.schedulePoll(cameraId, backoffMs + jitter);
  }

  buildRenewEnvelope(sub: OnvifEventSubscription, terminationTime = SUBSCRIPTION_LIFETIME): string {
    return this.buildEnvelope(
      sub,
      'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest',
      `<wsnt:Renew><wsnt:TerminationTime>${terminationTime}</wsnt:TerminationTime></wsnt:Renew>`
    );
  }

  buildUnsubscribeEnvelope(sub: OnvifEventSubscription): string {
    return this.buildEnvelope(
      sub,
      'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest',
      '<wsnt:Unsubscribe/>'
    );
  }

  private buildEnvelope(sub: OnvifEventSubscription, action: string, body: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:wsa="http://www.w3.org/2005/08/addressing"
               xmlns:tev="http://www.onvif.org/ver10/events/wsdl"
               xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
  <soap:Header>
    <wsa:Action>${action}</wsa:Action>
    <wsa:To>${escapeXml(sub.subscriptionUrl || '')}</wsa:To>
    ${this.buildWsSecurityHeader(sub.username, sub.password)}
  </soap:Header>
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Constructs WS-Security UsernameToken header with digest or plaintext.
   */
  private buildWsSecurityHeader(username?: string, password?: string): string {
    if (!username) return '';

    const created = new Date().toISOString();
    const nonceBytes = crypto.randomBytes(16);
    const nonceBase64 = nonceBytes.toString('base64');

    if (password) {
      // Digest = Base64(SHA-1(nonce + created + password))
      const hash = crypto.createHash('sha1');
      hash.update(nonceBytes);
      hash.update(Buffer.from(created, 'utf8'));
      hash.update(Buffer.from(password, 'utf8'));
      const passwordDigest = hash.digest('base64');

      return `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
                     xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <wsse:UsernameToken>
          <wsse:Username>${escapeXml(username)}</wsse:Username>
          <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigest}</wsse:Password>
          <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceBase64}</wsse:Nonce>
          <wsu:Created>${created}</wsu:Created>
        </wsse:UsernameToken>
      </wsse:Security>`;
    }

    return `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
      </wsse:UsernameToken>
    </wsse:Security>`;
  }
}

export const onvifEventListenerService = new OnvifEventListenerService();
export default onvifEventListenerService;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
