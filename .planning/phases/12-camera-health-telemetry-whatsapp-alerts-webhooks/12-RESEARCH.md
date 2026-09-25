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

### Health Polling Mechanics
Camera health is evaluated across two planes:
1. **Network Control Plane (TCP Socket Ping)**:
   - Measures raw network reachability and round-trip TCP handshake latency (`latencyMs`) to camera `ip` and `port` (RTSP 554 or HTTP 80).
   - Fast timeout (e.g. 2500ms) prevents socket exhaustion.
2. **Media Plane (MediaMTX Telemetry)**:
   - Queries MediaMTX `/v3/paths/get/{name}` to inspect:
     - `ready`: boolean (is camera actively delivering RTSP frames to the media plane?).
     - `bytesReceived`: monotonic byte counter.
     - Bitrate computation:
       $$\text{bitrateKbps} = \frac{(\text{bytesReceived}_t - \text{bytesReceived}_{t-1}) \times 8}{1000 \times \Delta t}$$

### Tri-State Camera Health Model

```
 ┌───────────┐    TCP timeout or disconnect >= 30s    ┌───────────┐
 │  ONLINE   │ ──────────────────────────────────────> │  OFFLINE  │
 └───────────┘                                         └───────────┘
   │       ▲                                             ▲       │
   │       │                                             │       │
   │ High latency (>1000ms) or                           │       │
   │ stream not ready / bitrate = 0                      │       │
   ▼       │                                             │       │
 ┌───────────┐         TCP connection lost               │       │
 │ DEGRADED  │ ──────────────────────────────────────────┘       │
 └───────────┘                                                   │
       ▲                                                         │
       └────────────────── TCP recovers ─────────────────────────┘
```

| State | Criteria | Event Emitted | Severity |
|-------|----------|---------------|----------|
| **ONLINE** | TCP reachable ($<500\text{ms}$) AND MediaMTX `ready: true` AND bitrate $> 50\text{kbps}$ | `camera.online` | info |
| **DEGRADED** | TCP reachable but latency $>1000\text{ms}$, OR MediaMTX `ready: false` (camera pingable but RTSP broken), OR bitrate $= 0$ | `camera.degraded` | warning |
| **OFFLINE** | TCP connection refused / timeout, OR stream inactive for $\ge 30\text{s}$ | `camera.offline` | critical |

### Hysteresis & Anti-Flapping
To prevent alert flapping on transient network jitter, a camera must fail 2 consecutive poll cycles before transitioning from `ONLINE` to `OFFLINE` or `DEGRADED`. Recovery to `ONLINE` requires 1 successful healthy cycle.

---

## 3. WhatsApp & SMS Incident Alerting (`EXT-07`)

### Anti-Spam & Token-Bucket Rate Limiter
In CCTV environments, continuous motion (e.g. rain, active burglary, waving banner) can generate dozens of events per minute. Sending unlimited WhatsApp messages exhausts quotas, triggers Meta spam bans, and floods the operator's phone.

**Dual-Tier Protection**:
1. **Mandatory 60-Second Cooldown**:
   - For a given `(cameraId, eventType)` pair, once an alert is dispatched, subsequent events are suppressed for 60 seconds.
2. **Token Bucket Rate Limiter**:
   - Bucket capacity: 3 tokens per camera.
   - Refill rate: 1 token every 60 seconds.
   - Prevents burst spamming across multiple event triggers.

### Message Structure & Snapshot Linking
Format optimized for WhatsApp mobile view:
```text
🚨 *VMS ALERT: Motion Detected*
• *Camera:* Main Entrance (Cam 1)
• *Time:* 25 Sep 2026, 08:15:22 IST
• *Zone:* Perimeter Driveway
• *Snapshot:* https://vms.local/api/cameras/cam-1/snapshot?t=1727232322
```

### Provider Abstraction
Interface `INotificationDispatcher`:
- `WhatsAppCloudApiDispatcher`: Meta WhatsApp Business API (`https://graph.facebook.com/v20.0/{phone_number_id}/messages`).
- `TwilioWhatsAppDispatcher`: Twilio REST API fallback (`/2010-04-01/Accounts/{AccountSid}/Messages.json`).
- `MockNotificationDispatcher`: In-memory recording dispatcher for deterministic unit/integration testing.

---

## 4. HMAC-SHA256 Signed Outbound Webhooks (`EXT-08`)

### Security & Integrity Contract
Outbound webhooks allow third-party access control (turnstiles, boom barriers, alarms) to react to VMS events in real time.

Every webhook delivery includes:
1. **Header `X-VMS-Signature`**:
   $$\text{Signature} = \text{"sha256="} + \text{HMAC-SHA256}(\text{endpoint.secret}, \text{rawJsonBody})$$
2. **Header `X-VMS-Timestamp`**: ISO timestamp or epoch timestamp. Receivers reject deliveries older than 300 seconds to prevent replay attacks.
3. **Header `X-VMS-Event`**: e.g. `motion.detected`, `camera.offline`.
4. **Header `X-VMS-Delivery`**: UUID for delivery idempotency.

### Non-Blocking Dispatch Queue
Webhook dispatching occurs asynchronously from the `EventBus` subscriber. Failures (timeouts $\ge 5000\text{ms}$ or 5xx HTTP responses) are logged with non-blocking exponential backoff retry (up to 3 attempts), ensuring the Node event loop and recording engine are never impacted.

---

## 5. Prisma Schema & Data Modeling

```prisma
model WebhookEndpoint {
  id        String   @id @default(uuid())
  name      String
  url       String
  secret    String
  events    Json     // Array of string event types, or ["*"]
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("webhook_endpoints")
}

model NotificationConfig {
  id              String   @id @default(uuid())
  provider        String   @default("mock") // mock, whatsapp_cloud, twilio
  apiKey          String?  @map("api_key")
  senderPhoneId   String?  @map("sender_phone_id")
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
| **T-12-01** | **SSRF via Webhook Endpoints**: Attacker configures webhook URL targeting internal loopback (`127.0.0.1:9997`) or cloud metadata (`169.254.169.254`). | Strict URL protocol validation (`http:`, `https:`). Reject private/link-local/loopback IPs in production mode. |
| **T-12-02** | **Secrets Leakage in REST APIs**: Webhook HMAC secrets or WhatsApp API keys exposed in API responses. | Mask secrets in GET responses (`whsec_***` or `sk_***`). Only accept secrets during creation or explicit rotation. |
| **T-12-03** | **Replay Attacks on Outbound Webhooks**: Malicious actor intercepts webhook and replays barrier gate trigger. | Include `X-VMS-Timestamp` in payload and header; signature covers entire body. |
| **T-12-04** | **Notification Flooding & API Exhaustion**: Bursts of motion alerts flood customer phone and exhaust quotas. | Token-bucket rate limiter with mandatory 60s cooldown per camera. |
