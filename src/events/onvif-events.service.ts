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

export interface CameraSubscriptionInput {
  id: string;
  name: string;
  ip?: string;
  port?: number;
  onvifXAddr?: string | null;
  username?: string | null;
  password?: string | null;
}

export class OnvifEventListenerService {
  private subscriptions = new Map<string, OnvifEventSubscription>();
  private pollTimeouts = new Map<string, NodeJS.Timeout>();
  private mockMode = false;
  private mockEventTrigger?: (cameraId: string) => void;
  private isListening = false;
  private eventUnsubscribers: (() => void)[] = [];

  constructor(
    private readonly eventBus: EventBus = defaultEventBus,
    mockMode = false
  ) {
    this.mockMode = mockMode || process.env.NODE_ENV === 'test';
  }

  /**
   * Starts listening to EventBus lifecycle events to automatically manage subscriptions.
   */
  start(): void {
    if (this.isListening) return;
    this.isListening = true;

    const unsubOnline = this.eventBus.subscribe('camera.online', async (event) => {
      const meta = event.metadata as any;
      if (!event.cameraId || !meta) return;
      // Only auto-subscribe if camera has ONVIF endpoint/IP and is not explicitly manual-only
      if ((meta.onvifXAddr || meta.ip) && !meta.manual) {
        try {
          await this.subscribeCamera({
            id: event.cameraId,
            name: meta.name || 'Camera',
            ip: meta.ip,
            port: meta.port,
            onvifXAddr: meta.onvifXAddr,
            username: meta.username,
            password: meta.password,
          });
        } catch (err: any) {
          console.warn(`[OnvifEventListenerService] Auto-subscribe failed for camera ${event.cameraId}:`, err.message);
        }
      }
    });

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

    try {
      await this.initiatePullPointSubscription(subscription);
      this.schedulePoll(camera.id, 100);
    } catch (err) {
      console.warn(`[OnvifEventListener] Failed to initiate subscription for camera ${camera.id}:`, (err as Error).message);
      // Schedule reconnect with backoff
      this.scheduleReconnect(camera.id);
    }

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
               xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  <soap:Header>
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
   * Processes parsed ONVIF events and emits to Core event bus (EVT-04).
   */
  async processEvents(cameraId: string, events: ParsedOnvifEvent[]): Promise<void> {
    const sub = this.subscriptions.get(cameraId);
    if (!sub) return;

    for (const event of events) {
      if (event.isMotion) {
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
  async triggerMockMotion(cameraId: string): Promise<void> {
    const sub = this.subscriptions.get(cameraId);
    if (!sub) return;

    await this.processEvents(cameraId, [
      {
        topic: ONVIF_TOPIC_CELL_MOTION,
        isMotion: true,
        isTamper: false,
        timestamp: new Date(),
        data: { IsMotion: 'true' },
      },
    ]);
  }

  /**
   * Initiates SOAP CreatePullPointSubscription.
   */
  private async initiatePullPointSubscription(sub: OnvifEventSubscription): Promise<void> {
    const eventServiceUrl = sub.xaddr.replace(/device_service.*$/, 'event_service');
    const envelope = this.buildCreatePullPointEnvelope(sub, 'PT60S');

    const res = await fetch(eventServiceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
      },
      body: envelope,
    });

    if (!res.ok) {
      throw new Error(`CreatePullPointSubscription failed with HTTP ${res.status}`);
    }

    const xmlText = await res.text();
    const addressMatch = xmlText.match(/<(?:[a-zA-Z0-9_]+:)?Address[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_]+:)?Address>/i);
    if (!addressMatch) {
      throw new Error('No SubscriptionReference Address returned in PullPoint response');
    }

    sub.subscriptionUrl = addressMatch[1].trim();
    sub.terminationTime = new Date(Date.now() + 60000);
    sub.errorCount = 0;
  }

  /**
   * Schedules next PullMessages poll with error backoff (T-06-01).
   */
  private schedulePoll(cameraId: string, delayMs: number): void {
    const existing = this.pollTimeouts.get(cameraId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      await this.pollOnce(cameraId);
    }, delayMs);

    this.pollTimeouts.set(cameraId, timer);
  }

  /**
   * Executes a single PullMessages poll cycle.
   */
  private async pollOnce(cameraId: string): Promise<void> {
    const sub = this.subscriptions.get(cameraId);
    if (!sub || !sub.active || !sub.subscriptionUrl) {
      return;
    }

    try {
      const envelope = this.buildPullMessagesEnvelope(sub, 'PT5S', 10);
      const res = await fetch(sub.subscriptionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
        },
        body: envelope,
      });

      if (!res.ok) {
        throw new Error(`PullMessages returned HTTP ${res.status}`);
      }

      const xmlText = await res.text();
      sub.lastPoll = new Date();
      sub.errorCount = 0;

      const events = this.parseSoapNotification(xmlText);
      if (events.length > 0) {
        await this.processEvents(cameraId, events);
      }

      // Schedule next poll immediately on success
      this.schedulePoll(cameraId, 100);
    } catch (err) {
      sub.errorCount += 1;
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
    const delay = backoffMs + jitter;

    this.schedulePoll(cameraId, delay);
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
          <wsse:Username>${username}</wsse:Username>
          <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigest}</wsse:Password>
          <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceBase64}</wsse:Nonce>
          <wsu:Created>${created}</wsu:Created>
        </wsse:UsernameToken>
      </wsse:Security>`;
    }

    return `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${username}</wsse:Username>
      </wsse:UsernameToken>
    </wsse:Security>`;
  }
}

export const onvifEventListenerService = new OnvifEventListenerService();
export default onvifEventListenerService;
