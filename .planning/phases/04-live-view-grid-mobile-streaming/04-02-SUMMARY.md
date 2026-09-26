---
phase: 04-live-view-grid-mobile-streaming
plan: 02
status: completed
date: 2026-09-24
requirements_covered:
  - LIVE-04
threats_mitigated:
  - T-04-02
---

# Plan 04-02 Summary: Coturn STUN/TURN Traversal & Mobile Remote View

Plan 02 of Phase 4 configured Coturn STUN/TURN traversal and dynamic ephemeral TURN credential generation to enable remote mobile browser streaming outside local networks (`LIVE-04`).

## Key Deliverables

1. **IceServerService (`src/streaming/ice-servers.service.ts`)**:
   - Generates active ICE servers including ephemeral TURN credentials following the RFC 5766 REST API specification.
   - Computes time-limited HMAC-SHA1 signatures using shared `TURN_SECRET`, preventing unauthorized TURN relay abuse (`T-04-02`).
   - Automatically supports UDP and TCP relay transports (`turn:<host>:<port>?transport=udp`, `turn:<host>:<port>?transport=tcp`).
   - Gracefully defaults to public STUN (`stun:stun.l.google.com:19302`) when TURN relay is unconfigured.

2. **Coturn Server Configuration Template (`coturn/turnserver.conf`)**:
   - Pre-configured Coturn turnserver specification for single-site and Docker deployment.
   - Enables standard STUN listener on port 3478, TLS on port 5349.
   - Configures relay port range 49152–65535, `use-auth-secret`, `fingerprint`, and `realm=vms.local`.

3. **Fastify Route Integration (`src/streaming/streaming.routes.ts`)**:
   - Exposes `GET /api/streaming/ice-servers` returning active STUN and ephemeral TURN configurations for authenticated mobile and desktop clients.
   - Dynamically injects fresh ICE server configurations into `GET /api/streaming/config`.

4. **Verification**:
   - `tests/ice-servers.test.ts`: 2/2 tests verifying default STUN resolution, ephemeral TURN token expiration calculation, and HMAC-SHA1 signature correctness.
   - `tests/streaming-routes.test.ts`: 6/6 tests covering `/config`, `/cameras/:id`, and `/ice-servers` with JWT authentication enforcement.
   - Full test suite: 87/87 tests passing across all 13 test files.
