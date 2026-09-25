---
phase: 12
slug: camera-health-telemetry-whatsapp-alerts-webhooks
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-25
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Architectural Contracts

> **Camera health diagnostics operate via dual-plane evaluation (TCP socket ping + MediaMTX stream metrics) with anti-flapping hysteresis, emitting state transition events to the Core EventBus.**  
> **WhatsApp/SMS incident alerts are strictly rate-limited with a 60-second anti-spam cooldown and token bucket per camera.**  
> **All outbound webhooks include cryptographic HMAC-SHA256 signatures, replay-preventing timestamps, and non-blocking asynchronous dispatch.**

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test tests/camera-health.test.ts tests/webhooks-alerts.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test tests/camera-health.test.ts` or `tests/webhooks-alerts.test.ts`
- **After every plan wave:** Run `npm test && npx tsc --noEmit && npx tsc --project client/tsconfig.json`
- **Before completion:** Full suite must be green (0 test failures, 0 TypeScript errors)
- **Max feedback latency:** 15 seconds

---

## Threat Model Reference & Verification Behaviors

- **T-12-01 (SSRF via Webhook Endpoints)**:
  - *Secure Behavior*: Validate webhook URL protocol (`http:`, `https:`). Reject private/link-local/loopback IPs in production mode unless explicitly allowed for test harnesses.
- **T-12-02 (Secrets Leakage in REST APIs)**:
  - *Secure Behavior*: Never expose raw HMAC secrets or WhatsApp API keys in GET responses; mask secrets in serialization (`whsec_***`).
- **T-12-03 (Replay Attacks on Outbound Webhooks)**:
  - *Secure Behavior*: Include `X-VMS-Timestamp` and `X-VMS-Signature` covering body and timestamp; reject deliveries $> 300\text{s}$ old.
- **T-12-04 (Notification Flooding / API Exhaustion)**:
  - *Secure Behavior*: Token-bucket limiter and 60-second cooldown per camera enforced in memory.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | EXT-06 | — | CameraHealthMonitor polls TCP socket & MediaMTX runtime metrics; emits transition events | unit | `npm test tests/camera-health.test.ts` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | EXT-06 | T-12-02 | Health REST API returns tri-state status, latency, bitrate; gated by `extended.camera_health` | integration | `npm test tests/camera-health.test.ts` | ❌ W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | EXT-06 | — | LiveCameraTile displays real-time health indicator dot (Green/Amber/Red) and latency/bitrate tooltip | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 2 | EXT-07 | T-12-04 | Token-bucket rate limiter and 60s anti-spam cooldown prevent notification storm | unit | `npm test tests/webhooks-alerts.test.ts` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 2 | EXT-08 | T-12-01, T-12-03 | HMAC-SHA256 outbound webhook dispatcher signs payloads and handles retries | unit | `npm test tests/webhooks-alerts.test.ts` | ❌ W0 | ⬜ pending |
| 12-02-03 | 02 | 2 | EXT-07, EXT-08 | T-12-02 | Settings & Webhooks CRUD routes with secret masking; NotificationSettingsModal UI | integration/ui | `npm test tests/webhooks-alerts.test.ts && npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |

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
