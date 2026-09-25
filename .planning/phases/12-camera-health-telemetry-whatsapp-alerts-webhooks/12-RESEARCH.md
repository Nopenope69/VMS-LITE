# Phase 12: Camera Health Telemetry, WhatsApp Alerts & Webhooks - Technical Research

**Phase:** 12-camera-health-telemetry-whatsapp-alerts-webhooks  
**Requirements:** EXT-06 (`extended.camera_health`), EXT-07 (`extended.whatsapp_alerts`), EXT-08 (`extended.api_webhooks`)  
**Date:** 2026-09-25  

---

## 1. Domain Context & Architectural Principles (VMS-Lite)

Phase 12 represents the final feature package of **Milestone v2.0 (Package 2 Extended)**, transitioning Basic VMS from an isolated local recorder into an integrated, commercially observable video management system.

The target tier (Indian commercial SMBs, retail stores, warehouses, residential complexes) has three operational imperatives:
1. **Zero-Touch Stream Health Telemetry**: Installers need immediate visibility when a camera cable is cut, power drops, or RTSP bitrates plummet without manually scrubbing feeds.
2. **Actionable WhatsApp Incident Alerting**: Security guards and owners do not sit in front of monitors 24/7. Critical perimeter events must dispatch to WhatsApp/SMS with snapshot links, strictly governed by a 60-second anti-spam cooldown and token bucket to protect against message storms and API charges.
3. **Cryptographically Signed External Integration**: Outbound integration with barrier gates, RFID turnstiles, and sirens via HMAC-SHA256 signed HTTP webhooks.

### Clean Licensing & AI Boundaries
- All features resolve to distinct capabilities: `extended.camera_health`, `extended.whatsapp_alerts`, and `extended.api_webhooks`.
- Zero neural network dependencies; all diagnostics and dispatchers are pure Node.js asynchronous workers and cryptographic primitives.

---

## 2. Camera Health Diagnostics & Telemetry (`EXT-06`)

### Camera Source Integration
`CameraHealthService` discovers cameras by calling `CameraService.listCameras()`. It iterates only over configured cameras with active MediaMTX paths, excluding deleted or unassigned entities.

### Health Polling Mechanics & Concurrency Bounds
Camera health is evaluated across two planes with strict resource limits:
1. **Concurrency Semaphore & Overlap Guard**:
   - `MAX_CONCURRENT_CAMERA_CHECKS = 5`: mass polling runs through an async worker pool to prevent socket exhaustion on budget NVR hardware.
   - Non-overlapping execution: poller maintains `isPolling = true` during an active cycle. If a cycle exceeds 15 seconds, subsequent triggers are skipped with a warning log rather than stacking overlapping loops.
2. **Network Control Plane (TCP Socket Ping)**:
   - Measures raw network reachability and round-trip TCP handshake latency (`latencyMs`) to camera `ip` and `port` (RTSP 554 or HTTP 80) via `net.Socket`.
   - Strict 2500ms connection timeout, with guaranteed `socket.destroy()` on all completion, error, and timeout branches.
3. **Media Plane (MediaMTX Telemetry via Adapter)**:
   - Decoupled via `IMediaMtxRuntimeAdapter`:
     ```ts
     export interface MediaMtxRuntimeInfo {
       ready: boolean;
       bytesReceived: number;
     }
     export interface IMediaMtxRuntimeAdapter {
       getPathRuntime(path: string): Promise<MediaMtxRuntimeInfo | null>;
     }
     ```
   - 2000ms `AbortController` timeout prevents slow media plane responses from hanging the health worker.
4. **Bitrate Warm-up & Counter Reset Logic**:
   - Bitrate formula:
     $$\text{bitrateKbps} = \frac{(\text{bytesReceived}_t - \text{bytesReceived}_{t-1}) \times 8}{1000 \times \Delta t}$$
   - **First Observation Warm-up**: On the very first poll cycle for a camera, there is no previous byte counter. The initial sample establishes the byte baseline and reports `bitrateKbps = null`. The stream is treated as healthy if `ready: true`, preventing false DEGRADED transitions or alert storms on startup.
   - **Counter Reset**: If `currentBytes < previousBytes` (e.g. MediaMTX server restart or stream re-publish), the baseline is reset to `currentBytes` without computing negative or spiked bitrates.

### Deterministic Tri-State Health State Machine

```
               ┌────────────────────────────────────────────────────────┐
               │                                                        │
               ▼                                                        │
         ┌───────────┐         Continuous TCP failure >= 30s            │
         │  ONLINE   │ ──────────────────────────────────────────┐      │
         └───────────┘                                           │      │
               │                                                 │      │
               │ First unhealthy sample (candidate)              │      │
               ▼                                                 │      │
     [ UNHEALTHY CANDIDATE ]                                     │      │
               │                                                 │      │
               │ Second consecutive unhealthy sample             │      │
               ▼                                                 │      │
         ┌───────────┐         TCP connection lost >= 30s        ▼      │
         │ DEGRADED  │ ─────────────────────────────────> ┌───────────┐ │
         └───────────┘                                    │  OFFLINE  │ │
               │                                          └───────────┘ │
               │                                                 │      │
               └───────────────── Any fully healthy sample ──────┴──────┘
```

| State | Deterministic Criteria | Event Emitted | Severity |
|-------|------------------------|---------------|----------|
| **ONLINE** | TCP reachable ($<500\text{ms}$) AND MediaMTX `ready: true` AND bitrate $> 50\text{kbps}$ (or warm-up sample) | `camera.online` | info |
| **DEGRADED** | TCP reachable but latency $\ge 500\text{ms}$, OR MediaMTX `ready: false`, OR bitrate $\le 50\text{kbps}$ (after 2 consecutive unhealthy polls) | `camera.degraded` | warning |
| **OFFLINE** | TCP connection refused / timeout continuously for $\ge 30\text{s}$ (tracked via `unhealthySince`) OR stream disconnected $\ge 30\text{s}$ | `camera.offline` | critical |

### Anti-Flapping Hysteresis & EventBus Contract
- State transitions require 2 consecutive unhealthy samples before flipping to `DEGRADED` or `OFFLINE` (with `unhealthySince` tracking the elapsed downtime).
- Recovery to `ONLINE` requires 1 fully healthy sample.
- Events are emitted **only on state transitions** (`currentStatus !== previousStatus`).
- **Standardized Payload Contract**:
  ```ts
  export interface CameraHealthEventMetadata {
    cameraId: string;
    cameraName: string;
    status: CameraHealthStatus;
    previousStatus?: CameraHealthStatus;
    reason?: string;
    latencyMs?: number | null;
    bitrateKbps?: number | null;
    consecutiveFailures: number;
    timestamp: string; // ISO-8601
  }
  ```

### Physical Security RBAC & Relative Route Prefix
- Plugin `src/health/health.routes.ts` defines routes relative to prefix `/api/cameras`:
  - `GET /health` $\rightarrow$ `/api/cameras/health`
  - `GET /:id/health` $\rightarrow$ `/api/cameras/:id/health`
- **RBAC**: Protected by `[authenticate, requireRole([Role.ADMIN, Role.OPERATOR]), requireCapability('extended.camera_health')]`. The `VIEWER` role is rejected (403) to prevent unauthorized real-time reconnaissance of camera blackouts.
- **DTO Safety**: `CameraHealthTelemetry` strictly excludes internal camera IP addresses, passwords, and local network topology.

### Frontend Telemetry Architecture
- Centralized React hook `useCameraHealth(intervalMs = 15000)`:
  - Fetches `/api/cameras/health` once for the active grid layout, avoiding $N$ separate network requests from $N$ tiles.
  - Exposes health map and summary statistics.
- `LiveCameraTile` renders health status badge (Emerald, Amber, Rose) and telemetry tooltip with latency (ms) and bitrate (kbps).

---

## 3. WhatsApp & SMS Incident Alerting (`EXT-07`)

### Anti-Spam & Token-Bucket Rate Limiter
In CCTV environments, continuous motion (e.g. rain, headlights, branches) can generate dozens of events per minute.

**Dual-Tier Protection**:
1. **Mandatory 60-Second Cooldown**:
   - For a given `(cameraId, eventType)` pair, once an alert is dispatched, subsequent events are suppressed for 60 seconds.
2. **Token Bucket Rate Limiter**:
   - Bucket capacity: 3 tokens per camera.
   - Refill rate: 1 token every 60 seconds.
   - Prevents burst spamming across multiple event triggers.

### Event Subscription & Filtering
- Default alert events: `['motion.detected', 'camera.offline']`.
- Configurable via `NotificationConfig.events`: supports opting into `['camera.degraded', 'camera.online', 'camera.tamper']`.
- Events not present in `config.events` are safely filtered out before rate limiters or dispatchers execute.

### Snapshot Delivery Contract
In customer deployments, WhatsApp recipient phones are outside the local camera LAN. A LAN snapshot URL (`https://vms.local/...`) is unusable.
- The snapshot resolver supports:
  1. `PUBLIC_BASE_URL` or configured external URL.
  2. Signed 15-minute expiring URLs with HMAC query parameter (`?expires=...&sig=...`).
  3. Safe fallback to local relative URL if no public base URL is configured.

### Flexible Provider Credential Model
To accommodate Meta WhatsApp Cloud API and Twilio simultaneously without awkward schema mismatches:
- Model `NotificationConfig`:
  ```prisma
  model NotificationConfig {
    id              String   @id @default(uuid())
    provider        String   @default("mock") // "mock", "whatsapp_cloud", "twilio"
    credentialsJson String?  @map("credentials_json")
    sender          String?
    recipientPhones Json     @default("[]") @map("recipient_phones")
    cooldownSeconds Int      @default(60) @map("cooldown_seconds")
    events          Json     @default("[\"motion.detected\",\"camera.offline\"]")
    enabled         Boolean  @default(true)
    createdAt       DateTime @default(now()) @map("created_at")
    updatedAt       DateTime @updatedAt @map("updated_at")

    @@map("notification_configs")
  }
  ```
- **Provider-Specific Validation**:
  - `whatsapp_cloud`: requires `{ accessToken: string; phoneNumberId: string }`. Supports Meta Cloud API templates.
  - `twilio`: requires `{ accountSid: string; authToken: string; fromPhone: string }`. Supports Twilio WhatsApp messaging and pre-approved templates outside 24h customer care sessions.
  - `mock`: in-memory test dispatcher.
- **Secret Masking & Preservation**:
  - `GET /api/notifications/settings` returns masked credentials.
  - `PUT /api/notifications/settings` preserves existing credentials when masked tokens are submitted.

---

## 4. HMAC-SHA256 Signed Outbound Webhooks (`EXT-08`)

### Security & Integrity Contract
Outbound webhooks allow third-party access control (turnstiles, boom barriers, alarms) to react to VMS events in real time.

Every webhook delivery includes:
1. **Header `X-VMS-Signature`**:
   $$\text{Signature} = \text{"sha256="} + \text{HMAC-SHA256}(\text{endpoint.secret}, \text{\`${timestamp}.\${rawBody}\`})$$
   Binding the timestamp directly into the HMAC signature prevents signature stripping and ensures temporal authenticity.
2. **Header `X-VMS-Timestamp`**: ISO timestamp. Receivers reject deliveries older than 300 seconds to prevent replay attacks.
3. **Header `X-VMS-Event`**: e.g. `motion.detected`, `camera.offline`.
4. **Header `X-VMS-Delivery`**: UUID generated once upon initial enqueue and **reused identically across all retries** for receiver idempotency.

### SSRF Guard with DNS Pre-Resolution & Redirect Control
To protect against SSRF and DNS rebinding:
1. URL protocol must be `http:` or `https:`.
2. Destination hostname is resolved via `dns.promises.lookup` **at dispatch time**.
3. The resolved IP is verified against blocked CIDR blocks:
   - IPv4 loopback (`127.0.0.0/8`), link-local / cloud metadata (`169.254.0.0/16`), private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
   - IPv6 loopback (`::1`), link-local (`fe80::/10`), unique local (`fc00::/7`), and IPv4-mapped IPv6 (`::ffff:...`).
4. HTTP redirects are set to `redirect: 'manual'` to prevent redirect bypasses into private network endpoints.

### Webhook Wildcard Allowlist
Wildcard event subscriptions (`events: ["*"]`) expand strictly to `ALLOWED_WEBHOOK_EVENTS`:
`['motion.detected', 'camera.online', 'camera.degraded', 'camera.offline', 'camera.tamper']`.
Internal system events (auth, licensing, user changes) are never broadcast to third parties.

### Bounded Asynchronous Retry Queue & Failure Model
Webhook delivery runs asynchronously to protect the Node event loop and media pipeline:
- `maxQueueDepth = 500`: new delivery jobs are dropped with a warning log if queue exceeds capacity.
- `maxConcurrentDeliveries = 5`.
- Request timeout: 5000ms.
- **Terminal 4xx Failure**: HTTP 400, 401, 403, 404 client errors indicate invalid configuration or receiver rejection — they terminate immediately without retry.
- **Retry Logic (5xx, 429, timeouts, network drops)**: Retried up to 3 times with exponential backoff and jitter (e.g. 1s, 2s, 4s $\pm 20\%$).
- All retry attempts preserve the exact original `X-VMS-Delivery` UUID.
- After 3 exhausted retries: drop job and record audit log.

---

## 5. Prisma Schema & Data Modeling

```prisma
model WebhookEndpoint {
  id        String   @id @default(uuid())
  name      String
  url       String
  secret    String
  events    Json     // string[] of event types or ["*"]
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("webhook_endpoints")
}

model NotificationConfig {
  id              String   @id @default(uuid())
  provider        String   @default("mock") // "mock", "whatsapp_cloud", "twilio"
  credentialsJson String?  @map("credentials_json") // JSON-encoded API credentials
  sender          String?  // From phone / Phone Number ID / Twilio WhatsApp from
  recipientPhones Json     @default("[]") @map("recipient_phones") // string[]
  cooldownSeconds Int      @default(60) @map("cooldown_seconds")
  events          Json     @default("[\"motion.detected\",\"camera.offline\"]")
  enabled         Boolean  @default(true)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("notification_configs")
}
```

---

## 6. Threat Model (ASVS L1)

| Threat ID | Threat Description | Mitigation Strategy |
|-----------|--------------------|---------------------|
| **T-12-01** | **SSRF via Webhooks & DNS Rebinding**: Attacker configures webhook URL targeting internal loopback (`127.0.0.1:9997`), cloud metadata (`169.254.169.254`), or uses DNS rebinding / redirects. | Strict URL protocol validation (`http:`, `https:`). Dispatch-time DNS pre-resolution rejecting IPv4/IPv6 private and loopback addresses. Manual redirect handling. |
| **T-12-02** | **Secrets Leakage & Physical Security Reconnaissance**: Webhook HMAC secrets or WhatsApp API keys exposed in API responses; unprivileged users querying camera blackouts for physical break-ins. | Mask secrets in GET responses (`whsec_***`). Prevent overwrite on PUT. Restrict health endpoints to `Role.ADMIN` and `Role.OPERATOR`. Exclude IP addresses from telemetry DTO. |
| **T-12-03** | **Replay & Invalidation on Webhooks**: Intercepted webhook replayed against external barrier systems; retries lack shared idempotency key. | Sign `${timestamp}.${rawBody}` with HMAC-SHA256. Replay window bounded at 300s. Transmit identical `X-VMS-Delivery` across all retry attempts. |
| **T-12-04** | **Notification Flooding & API Exhaustion**: Bursts of motion alerts flood customer phone and exhaust quotas. | Token-bucket rate limiter with mandatory 60s cooldown per camera/event. Filter unconfigured event types. |
| **T-12-05** | **Webhook Queue Starvation / DoS**: Unresponsive customer webhook endpoints exhaust memory and block delivery threads. | Bounded queue (500 items, 5 concurrent, 5s timeout). 4xx errors terminate immediately without retries. |
