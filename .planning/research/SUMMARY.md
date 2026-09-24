# Milestone v2.0 Research Summary: Package 2 (Extended)

**Project:** Basic VMS
**Domain:** Commercial Video Management System (VMS) Extended Capabilities
**Researched:** 2026-09-24
**Confidence:** HIGH

## Executive Summary

Milestone v2.0 (Package 2: Extended) expands the validated Basic VMS core into a full-featured commercial solution for Indian gated societies, warehouses, factories, and commercial SMBs. While Package 1 delivered reliable live view, scheduled recording, 24h timeline scrubbing, native motion alerts, and Docker installation, Package 2 introduces supervisor and operational workflows: 3-tier guard access control, dome PTZ control, false-positive motion zone masking, watermarked MP4 clip export, shift handover bookmarks, camera health diagnostics, WhatsApp incident dispatch, and external integration webhooks.

All extended features are entitlement-gated using the existing standalone Ed25519 offline license verification engine (`capabilities.has('extended.*')`). There is zero codebase fragmentation: a single clean-room binary runs both Package 1 and Package 2 installations depending on the cryptographically signed token installed on site.

The research establishes clear operational safeguards to maintain system reliability on budget 4-core hardware: PTZ runaway is prevented via server-side watchdog auto-stops; clip export defaults to 0% CPU packet copy with selective OSD burn-in; WhatsApp alerts are regulated by token-bucket rate limiters; and all external webhooks run asynchronously with circuit breakers to prevent blocking the Core event loop.

---

## Key Findings

### Recommended Stack Additions

The existing core stack (Node.js 20, Fastify, MediaMTX, PostgreSQL/Prisma, React 18) remains the authoritative foundation. Minimal, surgically chosen additions support Package 2:

- **FFmpeg (CLI via `child_process.spawn`)**: Invoked for fast fMP4 segment concatenation (`-c copy`) and optional OSD burn-in (`drawtext`). Packaged cleanly in the Docker container with strict permissive licensing verification.
- **`point-in-polygon` (1.1.x, MIT)**: Pure JS Ray-Casting algorithm for evaluating motion coordinate hits against polygon masks. Zero native C++ compilation dependencies.
- **Native `fetch` & `crypto` (Built-in Node 20)**: Handles Meta WhatsApp Cloud API / Twilio REST requests and HMAC-SHA256 signature calculations (`X-BasicVMS-Signature`) for outgoing webhooks without heavyweight third-party SDKs.

### Feature Scope & Priorities

**Table Stakes (Operator & Commercial Baselines):**
- **EXT-01: Operator Role & Granular RBAC**: 3 roles (`ADMIN`, `OPERATOR`, `VIEWER`) with camera-level view/control ACLs.
- **EXT-02: Motion Zones & Exclusion Masks**: Interactive SVG polygon editor with coordinate normalization to suppress false alarms.
- **EXT-03: PTZ Control & Presets**: ONVIF Profile S Pan/Tilt/Zoom joystick, optical zoom, preset buttons, and 1.5s watchdog auto-stop.
- **EXT-04: Server-Side Clip Export**: Fast packet-copy MP4 cutting + optional burned-in timestamp OSD and watermark.
- **EXT-05: Timeline Bookmarks**: Incident tagging, operator shift notes, color-coded timeline markers, and search.

**Differentiators (Indian SMB / Society Advantage):**
- **EXT-06: Camera Health Diagnostics**: Automated 30s ping, RTSP health, and MediaMTX path telemetry with proactive offline alerts.
- **EXT-07: WhatsApp / SMS Incident Dispatch**: Direct WhatsApp alert dispatch to security committees with rate-limiting cooldowns.
- **EXT-08: REST API & Outbound Webhooks**: Standardized event webhooks for barrier gates, RFID turnstiles, and BMS.

### Architecture Approach

- **Pre-Handler Capability Guards**: Every extended endpoint is protected by `requireCapability('extended.*')`. Sites without an Extended license receive `403 Forbidden` and the frontend UI disables or hides those controls gracefully.
- **PTZ Safety Watchdog**: Server enforces a 1500ms auto-stop timer on all continuous motion vectors, preventing physical motor strain or runaway spinning if client connectivity drops.
- **Decoupled Outbound Dispatch Pipeline**: The `DispatchService` subscribes to the Core `EventBus` without polluting camera streaming routes, isolating WhatsApp and Webhook latency from the main control plane.
- **48-Hour Export TTL**: All exported MP4 clips are stored in a dedicated cache directory with automated FIFO garbage collection to prevent disk exhaustion.

---

## Critical Pitfalls & Mitigations

1. **PTZ Runaway on Network Drop**: Mitigated with a mandatory 1.5s server-side watchdog auto-stop on `ContinuousMove`.
2. **CPU Exhaustion During Clip Export**: Mitigated by defaulting to zero-transcode packet copy (`-c copy`), capping concurrent transcode jobs to 1, and running at low CPU priority (`nice -n 10`).
3. **WhatsApp Anti-Spam Bans**: Mitigated by a token-bucket rate limiter (max 1 alert per camera per 60s) with trigger aggregation during active cooldowns.
4. **Export Disk Space Bloat**: Mitigated by a strict 48h TTL auto-pruning cycle linked into storage rollover monitoring.
5. **Slow External Webhooks Blocking Event Bus**: Mitigated by an asynchronous in-memory dispatch queue with 3000ms timeouts and circuit breaker retries.

---

## Roadmap Implications & Suggested Phase Sequence

Package 2 naturally sequences into 5 focused execution phases (continuing from Phase 7):

1. **Phase 8: Operator RBAC & PTZ Camera Controls** (`EXT-01`, `EXT-03`) — 3-tier role model, camera ACLs, and ONVIF Profile S PTZ with watchdog.
2. **Phase 9: Server-Side Clip Export & Timeline Bookmarks** (`EXT-04`, `EXT-05`) — FFmpeg packet-copy export, timestamp OSD burn-in, and timeline incident bookmarks.
3. **Phase 10: Motion Zones & Spatial Masking** (`EXT-02`) — SVG polygon editor in live view, normalized ray-casting filter over native motion coordinates.
4. **Phase 11: Camera Health Diagnostics & Telemetry** (`EXT-06`) — MediaMTX stream metrics, TCP ping heartbeat, and camera degraded/offline events.
5. **Phase 12: External Notifications & Outbound Webhooks** (`EXT-07`, `EXT-08`) — WhatsApp dispatch with rate limiting, and HMAC-SHA256 signed integration webhooks.
