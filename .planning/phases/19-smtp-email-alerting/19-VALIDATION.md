# Phase 19 Validation Strategy: Built-in SMTP Email Alerting

## Verification Goals
1. **Protocol Correctness**:
   - RFC 5321 command sequence (`EHLO` → `STARTTLS` → `AUTH LOGIN` → `MAIL FROM` → `RCPT TO` → `DATA` → `QUIT`) executes reliably without unhandled promise rejections or socket leakages.
   - Socket error handling (connection refused, bad credentials `535`, invalid recipient `550`) fails loudly with descriptive error messages instead of silent hangs.
2. **Core Capability Entitlement**:
   - Verify that `core.email_alerts` is part of `CORE_CAPABILITIES`.
   - Accessible by Core (Package 1) installations as well as Extended (Package 2) and AI (Package 3).
3. **Rate Limiting & Cooldown**:
   - Multiple rapid motion alerts on the same camera trigger only one email dispatch within the cooldown window (e.g. 60 seconds).
4. **Rich HTML & Deep-Link Rendering**:
   - Generated email body contains correct IST timestamp (`Asia/Kolkata`), event type badge, camera details, and valid timeline deep-link URL.
5. **REST API & RBAC**:
   - `GET /api/notifications/smtp`: Authenticated Operator & Admin can read config with masked password.
   - `PUT /api/notifications/smtp`: Admin can update SMTP host, port, security, recipients, cooldown, and credentials.
   - `POST /api/notifications/smtp/test`: Dispatches a test email and returns success/error diagnostic.
6. **Frontend UI Integration**:
   - `NotificationSettingsModal` renders the Email tab with field validations, recipient list management, and an interactive "Send Test Email" action with status alerts.
