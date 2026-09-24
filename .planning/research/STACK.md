# Stack Research: Package 2 (Extended)

**Domain:** Commercial Video Management System (VMS) Extended Capabilities
**Researched:** 2026-09-24
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js / TypeScript | v20+ LTS / TS 5.x | Control plane runtime | Native WebCrypto support, existing codebase foundation, high I/O concurrency for telemetry and webhooks. |
| MediaMTX | v1.11+ | Media plane server | Existing MIT-licensed server. MediaMTX `/v3/paths/list` provides stream telemetry (bitrate, frame rate, clients) without probing RTSP manually. |
| PostgreSQL / Prisma | 16+ / Latest | Extended schema & persistence | Type-safe migrations for `Role.OPERATOR`, `CameraPermission`, `Bookmark`, `MotionZone`, and `WebhookEndpoint`. |
| FFmpeg | 6.x / 7.x (CLI binary) | Server-side clip export & OSD | Standard open-source media tool. Used as an external CLI binary via `child_process.spawn` for fast fMP4 segment concatenation (`-c copy`) and burn-in timestamp OSD (`drawtext` filter). |
| React 18+ / Vite | React 18 / Vite 5 | Frontend operator workstation | Existing web client. Responsive canvas for polygon motion masks and virtual PTZ joystick pad. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@noble/ed25519` | 2.x (MIT) | Entitlement verification | Verifies `extended.*` capabilities in offline license tokens. Already integrated into `CapabilityRegistry`. |
| `point-in-polygon` | 1.1.x (MIT) | Motion zone filtering | Ultra-lightweight (pure JS, 1KB) Ray-Casting algorithm to evaluate whether ONVIF motion coordinate `(x, y)` falls within user-defined polygon masks. Zero native C++ compilation. |
| `undici` / native `fetch` | Built-in Node 20 | WhatsApp & Webhook dispatch | Zero-dependency HTTP client for WhatsApp Cloud API / Twilio REST requests and outbound webhook events. |
| `crypto` (Node native) | Built-in Node 20 | Webhook HMAC signing | Computes `sha256` HMAC signatures (`X-BasicVMS-Signature`) for secure payload delivery to third-party boom barriers / BMS. |

### Development & Operational Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Docker & Docker Compose | Containerized deployment | Extends `docker-compose.yml` to package FFmpeg binary in the Node service image. |
| Syft / License-Checker | Permissive license auditing in CI | Validates that all new packages and FFmpeg external binary invocations comply with permissive distribution rules. |

---

## Installation

### Dependencies to Add

```bash
# Vector containment for motion zone evaluation (pure MIT, zero native deps)
npm install point-in-polygon
npm install -D @types/point-in-polygon
```

*Note: WhatsApp dispatch, outgoing webhooks, and PTZ SOAP commands use Node.js built-ins (`fetch`, `crypto`, `http`/`node-fetch`), keeping production dependencies ultra-minimal.*

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| FFmpeg external CLI via `child_process.spawn` | `fluent-ffmpeg` npm package | `fluent-ffmpeg` is a thin wrapper that adds unnecessary abstraction and obscure error masking. Direct `spawn` provides explicit stream piping, process termination, and memory isolation. |
| Pure JS ray-casting (`point-in-polygon`) | OpenCV / Shapely / Turf.js | Turf.js is 500KB+ and intended for geospatial GIS; OpenCV requires heavy C++ bindings. Pure ray-casting handles 2D normalized camera coordinates (0.0 to 1.0) in sub-microsecond time. |
| Native `fetch` with WhatsApp Cloud API | Official WhatsApp SDK or Twilio SDK | Official SDKs pull heavy dependency trees with transitive vulnerabilities. WhatsApp Cloud API / Twilio require only 1 HTTP POST endpoint with Bearer auth. |
| Pinned ONVIF Profile S PTZ SOAP via `CameraProvider` | Generic RTSP backchannel / ONVIF Python wrappers | Python adds a secondary runtime; extending the internal `CameraProvider` adapter keeps all camera protocol handling strictly within the clean-room Node plane. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| In-process FFmpeg C++ bindings (`node-ffmpeg`, `prism-media`) | Memory leaks in C++ bindings crash the Node control plane process during export bursts. | Isolated FFmpeg child process with `SIGKILL` timeout watchdog. |
| Always re-encoding MP4 clips during export | Burns 100% CPU on budget 4-core NVR boxes, causing dropped live frames. | Packet-copy mode (`-c copy`) for standard exports; invoke re-encoding only when burn-in timestamp OSD or watermark is explicitly requested. |
| Direct client-to-camera PTZ communication | Exposes camera passwords and RTSP/HTTP ports directly to browser clients on LAN. | Proxy all PTZ commands through Fastify control plane with RBAC and capability checks. |
| Storing binary MP4 exports in PostgreSQL | Causes severe database bloat and memory pressure. | Store exported MP4 files in dedicated disk cache (`/var/lib/basic-vms/exports/`) with auto-cleanup after 48 hours. |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| FFmpeg 6.x / 7.x | Node.js 20+ LTS | Invoked via CLI. Must be compiled with `libx264` and `drawtext` (freetype). |
| `point-in-polygon` 1.1.x | TypeScript 5.x | Pure JS implementation of Ray-Casting algorithm. |
| PostgreSQL 16 | Prisma 5.x | Fully supports enum additions (`OPERATOR`) and relational ACL tables. |

---

## Sources

- MediaMTX v1.11 API Documentation (Path telemetry endpoints `/v3/paths/list`)
- ONVIF Profile S Specification (PTZ Service Version 2.4.1)
- Meta WhatsApp Business Cloud API Reference (Messages Endpoint)
- FFmpeg 6.1 Documentation (`drawtext` filter, concat demuxer)
