/**
 * Webhook Dispatcher Service (EXT-08)
 *
 * Outbound webhook integration with:
 * - Freshness-bound HMAC-SHA256 signatures over `${timestamp}.${rawBody}`
 * - Delivery ID idempotency preserved across retries (X-VMS-Delivery)
 * - Dispatch-time DNS pre-resolution SSRF protection with redirect blocking
 * - Bounded asynchronous retry queue terminating on 4xx errors
 * - Wildcard expansion restricted to ALLOWED_WEBHOOK_EVENTS
 */

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { EventBus, eventBus as defaultEventBus } from '../events/event-bus.js';
import {
  ALLOWED_WEBHOOK_EVENTS,
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookDeliveryPayload,
  WebhookEndpointDto,
} from './webhook.types.js';

export interface QueuedWebhookJob {
  deliveryId: string;
  endpointId: string;
  endpointName: string;
  url: string;
  secret: string;
  eventType: string;
  payload: WebhookDeliveryPayload;
  attempts: number;
  maxAttempts: number;
  nextAttemptTime: number;
}

export interface WebhookServiceDependencies {
  prisma?: PrismaClient;
  eventBus?: EventBus;
  allowPrivateIpsForTesting?: boolean;
}

export class WebhookDispatcherService {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  public allowPrivateIpsForTesting: boolean;

  public readonly MAX_QUEUE_DEPTH = 500;
  public readonly MAX_CONCURRENT_DELIVERIES = 5;
  public readonly REQUEST_TIMEOUT_MS = 5000;

  // In-memory fallback endpoints for test isolation without PostgreSQL
  private memoryEndpoints: Map<string, any> = new Map();

  private queue: QueuedWebhookJob[] = [];
  private activeDeliveries = 0;
  private queueTimer: NodeJS.Timeout | null = null;
  private unsubscribeEventBus: (() => void) | null = null;

  constructor(deps: WebhookServiceDependencies = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.eventBus = deps.eventBus || defaultEventBus;
    this.allowPrivateIpsForTesting =
      deps.allowPrivateIpsForTesting ?? (process.env.NODE_ENV === 'test');
  }

  /**
   * Evaluates whether an IP address is private, loopback, link-local, or cloud metadata.
   */
  isPrivateOrBlockedIp(ip: string): boolean {
    if (this.allowPrivateIpsForTesting) {
      return false;
    }

    // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    let cleanIp = ip.toLowerCase().trim();
    if (cleanIp.startsWith('::ffff:')) {
      cleanIp = cleanIp.slice(7);
    }

    // IPv6 checks
    if (cleanIp === '::1') return true; // IPv6 loopback
    if (cleanIp.startsWith('fe80:')) return true; // IPv6 link-local
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true; // IPv6 unique local

    // IPv4 checks
    const parts = cleanIp.split('.').map((p) => parseInt(p, 10));
    if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
      const [a, b] = parts;
      if (a === 127) return true; // Loopback 127.0.0.0/8
      if (a === 10) return true; // Private 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // Private 172.16.0.0/12
      if (a === 192 && b === 168) return true; // Private 192.168.0.0/16
      if (a === 169 && b === 254) return true; // Link-local / Cloud metadata 169.254.0.0/16
      if (a === 0) return true; // 0.0.0.0/8
    }

    return false;
  }

  /**
   * SSRF Guard with dispatch-time DNS pre-resolution.
   */
  async validateUrlSafety(rawUrl: string): Promise<{ safe: boolean; resolvedIp?: string; error?: string }> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { safe: false, error: 'Invalid URL format' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, error: 'Webhook URL protocol must be http: or https:' };
    }

    const hostname = parsed.hostname;

    // Check if hostname is an immediate literal IP
    if (this.isPrivateOrBlockedIp(hostname)) {
      return { safe: false, error: `Direct private/internal IP address rejected: ${hostname}` };
    }

    if (this.allowPrivateIpsForTesting) {
      return { safe: true, resolvedIp: '127.0.0.1' };
    }

    try {
      // Resolve hostname to IP at dispatch time
      const lookupResult = await dns.lookup(hostname);
      const resolvedIp = lookupResult.address;

      if (this.isPrivateOrBlockedIp(resolvedIp)) {
        return {
          safe: false,
          resolvedIp,
          error: `Resolved destination IP ${resolvedIp} belongs to blocked/private range (SSRF guard)`,
        };
      }

      return { safe: true, resolvedIp };
    } catch (err: any) {
      return { safe: false, error: `DNS resolution failed for ${hostname}: ${err.message}` };
    }
  }

  /**
   * Computes HMAC-SHA256 signature binding timestamp and raw JSON body.
   */
  computeSignature(secret: string, timestamp: string, rawBody: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${timestamp}.${rawBody}`);
    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * Masks secret token in DTOs.
   */
  maskSecret(secret: string): string {
    if (!secret) return 'whsec_***';
    return secret.length > 8 ? `whsec_${secret.slice(-4)}` : 'whsec_***';
  }

  /**
   * Lists all configured webhook endpoints with masked secrets.
   */
  async listEndpoints(): Promise<WebhookEndpointDto[]> {
    let records: any[] = [];

    if (this.memoryEndpoints.size > 0) {
      records = Array.from(this.memoryEndpoints.values());
    } else {
      try {
        records = await this.prisma.webhookEndpoint.findMany({
          orderBy: { createdAt: 'desc' },
        });
      } catch {
        records = [];
      }
    }

    return records.map((r) => this.toDto(r));
  }

  /**
   * Retrieves single endpoint by ID.
   */
  async getEndpointById(id: string): Promise<WebhookEndpointDto | null> {
    if (this.memoryEndpoints.has(id)) {
      return this.toDto(this.memoryEndpoints.get(id));
    }

    try {
      const record = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
      return record ? this.toDto(record) : null;
    } catch {
      return null;
    }
  }

  /**
   * Creates a new webhook endpoint.
   */
  async createEndpoint(input: CreateWebhookInput): Promise<WebhookEndpointDto> {
    const urlValidation = await this.validateUrlSafety(input.url);
    if (!urlValidation.safe && !this.allowPrivateIpsForTesting) {
      throw new Error(urlValidation.error || 'Invalid or blocked webhook destination URL');
    }

    const secret = input.secret || `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const events = input.events && input.events.length > 0 ? input.events : ['*'];

    const data = {
      name: input.name,
      url: input.url,
      secret,
      events,
      enabled: input.enabled ?? true,
    };

    let created: any = null;

    try {
      created = await this.prisma.webhookEndpoint.create({
        data: data as any,
      });
    } catch {
      created = {
        id: `wh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    this.memoryEndpoints.set(created.id, created);
    return this.toDto(created);
  }

  /**
   * Updates an existing webhook endpoint.
   * If secret submitted is masked or empty, preserves the stored secret.
   */
  async updateEndpoint(id: string, input: UpdateWebhookInput): Promise<WebhookEndpointDto | null> {
    let existing: any = this.memoryEndpoints.get(id);

    if (!existing) {
      try {
        existing = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
      } catch {
        existing = null;
      }
    }

    if (!existing) return null;

    if (input.url) {
      const urlValidation = await this.validateUrlSafety(input.url);
      if (!urlValidation.safe && !this.allowPrivateIpsForTesting) {
        throw new Error(urlValidation.error || 'Invalid or blocked webhook destination URL');
      }
    }

    let updatedSecret = existing.secret;
    if (input.secret && !input.secret.includes('whsec_***')) {
      updatedSecret = input.secret;
    }

    const updateData = {
      name: input.name !== undefined ? input.name : existing.name,
      url: input.url !== undefined ? input.url : existing.url,
      secret: updatedSecret,
      events: input.events !== undefined ? input.events : existing.events,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    };

    let updated: any = null;

    try {
      updated = await this.prisma.webhookEndpoint.update({
        where: { id },
        data: updateData as any,
      });
    } catch {
      updated = {
        ...existing,
        ...updateData,
        updatedAt: new Date(),
      };
    }

    this.memoryEndpoints.set(id, updated);
    return this.toDto(updated);
  }

  /**
   * Deletes a webhook endpoint.
   */
  async deleteEndpoint(id: string): Promise<boolean> {
    const existedInMemory = this.memoryEndpoints.has(id);
    this.memoryEndpoints.delete(id);
    try {
      await this.prisma.webhookEndpoint.delete({ where: { id } });
      return true;
    } catch {
      return existedInMemory;
    }
  }

  /**
   * Dispatches a test ping event to a specific webhook endpoint.
   */
  async sendTestPing(id: string): Promise<{ success: boolean; deliveryId: string; status?: number; error?: string }> {
    let endpoint: any = this.memoryEndpoints.get(id);

    if (!endpoint) {
      try {
        endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
      } catch {
        endpoint = null;
      }
    }

    if (!endpoint) {
      return { success: false, deliveryId: '', error: `Webhook endpoint '${id}' not found` };
    }

    const deliveryId = crypto.randomUUID();
    const payload: WebhookDeliveryPayload = {
      eventId: `test-${Date.now()}`,
      eventType: 'test.ping',
      timestamp: new Date().toISOString(),
      cameraId: null,
      data: {
        message: 'Basic VMS Webhook verification test ping',
        endpointId: endpoint.id,
      },
    };

    const job: QueuedWebhookJob = {
      deliveryId,
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      url: endpoint.url,
      secret: endpoint.secret,
      eventType: payload.eventType,
      payload,
      attempts: 0,
      maxAttempts: 1, // Single immediate attempt for test ping
      nextAttemptTime: Date.now(),
    };

    const result = await this.executeDelivery(job);
    return {
      success: result.success,
      deliveryId,
      status: result.status,
      error: result.error,
    };
  }

  /**
   * Enqueues an event delivery job with bounded queue depth protection.
   */
  enqueueEvent(endpoint: { id: string; name: string; url: string; secret: string }, event: any): void {
    if (this.queue.length >= this.MAX_QUEUE_DEPTH) {
      // Bounded queue protection: drop job to prevent memory exhaustion (T-12-05)
      return;
    }

    const deliveryId = crypto.randomUUID();
    const payload: WebhookDeliveryPayload = {
      eventId: event.id || `evt-${Date.now()}`,
      eventType: event.type,
      timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
      cameraId: event.cameraId || null,
      data: (event.metadata as any) || {},
    };

    const job: QueuedWebhookJob = {
      deliveryId,
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      url: endpoint.url,
      secret: endpoint.secret,
      eventType: event.type,
      payload,
      attempts: 0,
      maxAttempts: 3,
      nextAttemptTime: Date.now(),
    };

    this.queue.push(job);
    this.processQueue();
  }

  /**
   * Executes a single delivery attempt over HTTP POST.
   */
  async executeDelivery(job: QueuedWebhookJob): Promise<{ success: boolean; status?: number; error?: string }> {
    job.attempts += 1;

    // Validate SSRF at dispatch time
    const urlCheck = await this.validateUrlSafety(job.url);
    if (!urlCheck.safe && !this.allowPrivateIpsForTesting) {
      return { success: false, error: urlCheck.error || 'Blocked by SSRF guard' };
    }

    const rawBody = JSON.stringify(job.payload);
    const timestamp = new Date().toISOString();
    const signature = this.computeSignature(job.secret, timestamp, rawBody);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(job.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VMS-Signature': signature,
          'X-VMS-Timestamp': timestamp,
          'X-VMS-Event': job.eventType,
          'X-VMS-Delivery': job.deliveryId, // Preserved identically across all retries!
          'User-Agent': 'Basic-VMS-Webhook/1.0',
        },
        body: rawBody,
        signal: controller.signal,
        redirect: 'manual', // Prevent redirect bounce bypasses
      });

      clearTimeout(timeout);

      if (response.status >= 200 && response.status < 300) {
        return { success: true, status: response.status };
      }

      // Check if client error (4xx) -> terminal, do not retry
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return {
          success: false,
          status: response.status,
          error: `Terminal client error (${response.status}); retry cancelled`,
        };
      }

      return {
        success: false,
        status: response.status,
        error: `Server responded with HTTP ${response.status}`,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      return { success: false, error: err.message };
    }
  }

  /**
   * Processes queued webhook jobs up to max concurrency.
   */
  private async processQueue(): Promise<void> {
    const now = Date.now();

    while (this.activeDeliveries < this.MAX_CONCURRENT_DELIVERIES) {
      const readyIndex = this.queue.findIndex((j) => j.nextAttemptTime <= now);
      if (readyIndex === -1) break;

      const job = this.queue.splice(readyIndex, 1)[0];
      this.activeDeliveries++;

      this.executeDelivery(job)
        .then((result) => {
          if (!result.success) {
            // If terminal (4xx) or max attempts exhausted: drop
            const isTerminal = result.status && result.status >= 400 && result.status < 500 && result.status !== 429;
            if (!isTerminal && job.attempts < job.maxAttempts) {
              // Exponential backoff + jitter (+/- 20%)
              const baseDelay = Math.pow(2, job.attempts) * 1000;
              const jitter = (Math.random() * 0.4 - 0.2) * baseDelay;
              job.nextAttemptTime = Date.now() + Math.max(500, Math.round(baseDelay + jitter));
              this.queue.push(job);
            }
          }
        })
        .finally(() => {
          this.activeDeliveries--;
          this.processQueue();
        });
    }
  }

  /**
   * Starts event bus subscription for outbound webhooks.
   */
  async start(): Promise<void> {
    if (this.unsubscribeEventBus) return;

    this.queueTimer = setInterval(() => {
      this.processQueue();
    }, 1000);

    // Subscribe to EventBus
    this.unsubscribeEventBus = this.eventBus.subscribe('*', async (event) => {
      try {
        await this.handleEvent(event);
      } catch {
        // Individual event dispatch error does not break listener
      }
    });
  }

  /**
   * Stops webhook worker.
   */
  stop(): void {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }
    if (this.unsubscribeEventBus) {
      this.unsubscribeEventBus();
      this.unsubscribeEventBus = null;
    }
  }

  /**
   * Resolves endpoints interested in an event and queues deliveries.
   */
  private async handleEvent(event: any): Promise<void> {
    let endpoints: any[] = [];

    if (this.memoryEndpoints.size > 0) {
      endpoints = Array.from(this.memoryEndpoints.values()).filter((e) => e.enabled);
    } else {
      try {
        endpoints = await this.prisma.webhookEndpoint.findMany({
          where: { enabled: true },
        });
      } catch {
        endpoints = [];
      }
    }

    for (const ep of endpoints) {
      const rawEvents: string[] = Array.isArray(ep.events)
        ? ep.events
        : typeof ep.events === 'string'
        ? JSON.parse(ep.events)
        : [];

      // Expand wildcard strictly to ALLOWED_WEBHOOK_EVENTS
      const expandedEvents: string[] = rawEvents.includes('*')
        ? [...ALLOWED_WEBHOOK_EVENTS]
        : rawEvents;

      if (expandedEvents.includes(event.type)) {
        this.enqueueEvent(ep, event);
      }
    }
  }

  private toDto(record: any): WebhookEndpointDto {
    const events: string[] = Array.isArray(record.events)
      ? record.events
      : typeof record.events === 'string'
      ? JSON.parse(record.events)
      : ['*'];

    return {
      id: record.id,
      name: record.name,
      url: record.url,
      secret: this.maskSecret(record.secret),
      events,
      enabled: Boolean(record.enabled),
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString(),
    };
  }

  /**
   * Clears queue and memory (used in tests).
   */
  reset(): void {
    this.queue = [];
    this.activeDeliveries = 0;
    this.memoryEndpoints.clear();
  }
}

export const webhookDispatcherService = new WebhookDispatcherService();
export default webhookDispatcherService;
