---
phase: 12
slug: camera-health-telemetry-whatsapp-alerts-webhooks
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-25
updated: 2026-09-25
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Architectural Contracts

> **Camera health diagnostics operate via dual-plane evaluation (TCP socket ping + MediaMTX stream metrics via IMediaMtxRuntimeAdapter) with bounded concurrency (max 5 probes), non-overlapping loop protection, first-poll bitrate warm-up, and anti-flapping hysteresis (unhealthySince tracking), emitting standardized CameraHealthEventMetadata to Core EventBus only on transition.**  
> **Health telemetry REST endpoints are relative to prefix /api/cameras (GET /health, GET /:id/health) and restricted to ADMIN and OPERATOR roles under extended.camera_health to prevent physical security reconnaissance.**  
> **WhatsApp/SMS incident alerts are strictly rate-limited with a 60-second anti-spam cooldown and token bucket (3 tokens, 1/min refill), supporting Meta WhatsApp Cloud and Twilio with template/freeform dispatch and public/signed snapshot URLs.**  
> **All outbound webhooks include cryptographic HMAC-SHA256 signatures covering `${timestamp}.${rawBody}`, delivery ID idempotency preserved across retries, dispatch-time DNS pre-resolution SSRF protection with redirect blocking, and an asynchronous bounded retry queue terminating on 4xx errors.**  
> **Webhook and notification REST routes are relative to registration prefixes (/api/notifications and /api/webhooks), enforce secret masking on GET, prevent overwrite on PUT, and require Role.ADMIN.**

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test tests/camera-health.test.ts tests/webhooks-alerts.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test tests/camera-health.test.ts` or `tests/webhooks-alerts.test.ts`
- **After every plan wave:** Run `npm test && npx tsc --noEmit && npx tsc --project client/tsconfig.json`
- **Before completion:** Full suite must be green (0 test failures, 0 TypeScript errors)
- **Max feedback latency:** 15 seconds

---

## Threat Model Reference & Verification Behaviors

- **T-12-01 (SSRF via Webhook Endpoints & DNS Rebinding)**:
  - *Secure Behavior*: Validate webhook URL protocol (`http:`, `https:`). Pre-resolve DNS at dispatch time; reject IPv4 private/link-local/loopback IPs (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16), IPv6 loopback (`::1`), link-local (`fe80::/10`), unique-local (`fc00::/7`), and IPv4-mapped IPv6 (`::ffff:...`). Set `redirect: 'manual'` to prevent redirect bypasses.
- **T-12-02 (Secrets Leakage & Physical Security Reconnaissance)**:
  - *Secure Behavior*: Never expose raw HMAC secrets or WhatsApp credentials in GET responses; mask secrets in serialization (`whsec_***`). Prevent masked tokens from overwriting credentials on PUT. Restrict health endpoints to `Role.ADMIN` and `Role.OPERATOR`; exclude camera IP and network topology from health DTOs.
- **T-12-03 (Replay & Invalidation Attacks on Outbound Webhooks)**:
  - *Secure Behavior*: Sign `${timestamp}.${rawBody}` with HMAC-SHA256; transmit `X-VMS-Signature: sha256=...`, `X-VMS-Timestamp`, and `X-VMS-Delivery`. Generate `deliveryId` once and reuse it across all retries for receiver idempotency. Reject deliveries $> 300\text{s}$ old.
- **T-12-04 (Notification Flooding / API Exhaustion)**:
  - *Secure Behavior*: Token-bucket limiter (3 tokens, 1/min refill) and 60-second cooldown per `(cameraId, eventType)` enforced in memory. Filter events against configured `events` list (defaulting to `motion.detected` and `camera.offline`).
- **T-12-05 (Webhook Queue Starvation / DoS)**:
  - *Secure Behavior*: Bounded queue (`maxQueueDepth = 500`, `maxConcurrent = 5`, 5000ms timeout). Terminate immediately on 4xx client errors without retrying; retry 5xx/429/timeouts up to 3 times with exponential backoff and jitter.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | EXT-06 | — | Health types, IMediaMtxRuntimeAdapter, and CameraHealthEventMetadata defined | typecheck | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | EXT-06 | T-12-01 | CameraHealthService polls CameraService active cameras, bounded concurrency (5), bitrate warm-up, anti-flapping hysteresis with unhealthySince | unit | `npm test tests/camera-health.test.ts` | ❌ W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | EXT-06 | T-12-02 | Health REST API relative to /api/cameras (GET /health, GET /:id/health); ADMIN/OPERATOR RBAC; useCameraHealth hook and LiveCameraTile status badge | integration/ui | `npm test tests/camera-health.test.ts && npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 2 | EXT-07 | T-12-04 | Prisma schema with credentialsJson/sender; token-bucket limiter and 60s anti-spam cooldown | unit | `npm test tests/webhooks-alerts.test.ts` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 2 | EXT-08 | T-12-01, T-12-03, T-12-05 | Webhook dispatcher: `${timestamp}.${rawBody}` HMAC, delivery ID reuse, DNS pre-resolution SSRF guard, bounded queue (4xx terminal, 5xx retry) | unit | `npm test tests/webhooks-alerts.test.ts` | ❌ W0 | ⬜ pending |
| 12-02-03 | 02 | 2 | EXT-07, EXT-08 | T-12-02 | Relative routes (/api/notifications/settings, /api/webhooks), secret masking/overwrite protection; NotificationSettingsModal UI | integration/ui | `npm test tests/webhooks-alerts.test.ts && npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-25
