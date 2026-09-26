# Phase 19 - Plan 01 Summary: Built-in SMTP Email Alerting Engine & API

## Completed Deliverables
1. **Core Capability Realignment (`src/licensing/types.ts`)**:
   - Added `'core.email_alerts'` to `CORE_CAPABILITIES` so that basic email notifications are included in Core (Package 1) without requiring Pro/Extended licenses.
2. **In-Process RFC 5321 SMTP Client (`src/notifications/smtp-client.ts`)**:
   - Zero external third-party dependencies; implemented entirely with Node.js standard `node:net` and `node:tls`.
   - Supports direct SSL/TLS (port 465), standard TCP + STARTTLS upgrade (port 587/25), `AUTH LOGIN` (Base64 username & password), UTF-8 MIME headers, multiline response parsing, and socket timeouts.
   - Provides clean `ISmtpTransport` interface and `MockSmtpTransport` for offline testing.
3. **SMTP Alert Dispatcher Service (`src/notifications/smtp-dispatcher.service.ts`)**:
   - Subscribes to `EventBus` (`motion.detected`, `camera.offline`, `storage.warning`, `camera.degraded`).
   - Anti-flood protection with `TokenBucketRateLimiter` per `${cameraId}:${eventType}` and configurable cooldown (default: 60s).
   - Generates high-contrast HTML emails with Indian Standard Time (IST) formatting, incident severity badges, camera info, and timeline deep-links (`/playback?cameraId=...&t=...`).
   - Manages configuration persistence in `config/smtp-config.json` with masked password protection.
4. **REST API Endpoints (`src/notifications/notification.routes.ts`)**:
   - `GET /api/notifications/smtp`: Gated by `core.email_alerts`; accessible by Operator and Admin. Returns config with masked password.
   - `PUT /api/notifications/smtp`: Gated by `core.email_alerts`; Admin only. Updates settings without overriding existing password if placeholder `********` is passed.
   - `POST /api/notifications/smtp/test`: Gated by `core.email_alerts`; Admin only. Dispatches test email with immediate feedback.
5. **Lifecycle Hooks (`src/server.ts`)**:
   - `smtpDispatcherService.start()` attached on `onReady`.
   - `smtpDispatcherService.stop()` attached on `onClose`.
6. **Integration Test Suite (`tests/smtp-alerts.test.ts`)**:
   - 8 test cases verifying credentials masking, HTML IST template rendering, rate-limited EventBus dispatching, and Fastify REST RBAC.
   - 100% passing.
