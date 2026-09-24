# Phase 2: Media Plane & Camera Onboarding - Research

**Researched:** 2026-09-24  
**Domain:** Media server integration (MediaMTX), ONVIF WS-Discovery / Profile T/S client, RTSP stream ingestion, and camera abstraction  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from ROADMAP.md & PROJECT.md)

### Locked Decisions
- **MediaMTX as media plane**: MediaMTX (MIT license) manages RTSP ingestion, WebRTC (WHEP), and fMP4 streaming. The Node.js control plane interacts via MediaMTX's v3 Control API (`/v3/config/paths/*`). No custom transcoding in Node.js.
- **Vendor-neutral `CameraProvider` adapter**: Pinned ONVIF client (`node-onvif` or `agsh/onvif`, MIT) must be isolated behind an internal interface (`CameraProvider`). Higher-level controllers must never import ONVIF client libraries directly.
- **Profile T with Profile S fallback**: Onboarding must prioritize ONVIF Profile T (H.264/H.265, advanced stream configs) and fall back gracefully to Profile S.
- **Manual RTSP onboarding**: Support direct RTSP stream entry for non-ONVIF or isolated network cameras.
- **Capability & License Gating**: Camera additions must enforce the `capabilities.getCameraLimit()` entitlement established in Phase 1 (e.g. 2 cameras in evaluation mode).
- **Core Event Bus integration**: Camera status changes (`camera.online`, `camera.offline`) must emit through the Phase 1 `EventBus`.

### the agent's Discretion
- MediaMTX communication pattern: Use MediaMTX v3 Control API over HTTP (`http://localhost:9997`) with retry resilience and test mocking.
- Camera credential storage: Store camera credentials encrypted or direct in PostgreSQL `cameras` table for single-site NVR deployments.
- Discovery timeout: Standard 3000ms UDP multicast probe on port 3702.

### Deferred Ideas (OUT OF SCOPE)
- PTZ controls & camera presets (Package 2 Extended: EXT-03)
- Motion zones & exclusion masks (Package 2 Extended: EXT-02)
- Computer vision / AI analytics on streams (Package 3 AI: AI-01)
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ONVIF WS-Discovery probe | API/Backend | Local LAN (UDP 3702) | UDP multicast probe runs on local subnet from backend host |
| Camera Authentication & SOAP | API/Backend | Camera ONVIF service | Digest / WS-UsernameToken authentication handled securely by backend |
| RTSP Stream Ingest & Demuxing | MediaMTX (Media Plane) | Camera RTSP server | MediaMTX pulls RTSP packet streams with zero-transcode CPU overhead |
| Dynamic Path Configuration | API/Backend | MediaMTX v3 API | Backend synchronizes camera stream URLs into MediaMTX `/v3/config/paths/*` |
| Camera Metadata & State Storage| Database/Storage | API/Backend | PostgreSQL `cameras` table stores hardware metadata, RTSP URLs, and status |
| Event Notification | API/Backend | Core Event Bus | `camera.online` / `camera.offline` lifecycle events emitted via Phase 1 bus |
</architectural_responsibility_map>

<research_summary>
## Summary

Phase 2 establishes the media plane and camera ingestion subsystem for Basic VMS. 
The system architecture splits cleanly between the **Control Plane** (Node.js/Fastify) and the **Media Plane** (MediaMTX). 
The Node.js control plane handles network discovery via ONVIF WS-Discovery (UDP 3702 multicast), device authentication, stream URI discovery (Profile T/S), manual RTSP stream validation, and entitlement enforcement (`capabilities.getCameraLimit()`). Once a camera is onboarded, the control plane provisions a dynamic streaming path in MediaMTX using the MediaMTX v3 Control API (`POST /v3/config/paths/add/{name}`).

MediaMTX acts as the high-performance media proxy: it pulls the RTSP stream directly from the camera and publishes it as WebRTC (WHEP), RTSP, and fMP4 endpoints for downstream consumption without requiring any custom video decoders or Node.js CPU overhead.

**Primary recommendation:** Implement an isolated `CameraProvider` interface backed by a pinned MIT ONVIF client (`node-onvif`) and a dedicated `MediaMtxClient` interfacing with MediaMTX's v3 REST API. Ensure robust mock fixtures so unit and integration tests run reliably in CI without requiring physical IP cameras or a running MediaMTX daemon.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node-onvif` | ^0.1.7 | ONVIF WS-Discovery & Profile S/T SOAP client | MIT licensed, lightweight, zero binary dependencies, reliable UDP multicast probe and RTSP URI extraction |
| MediaMTX | v1.11+ | Media Plane server (RTSP/WebRTC/HLS/fMP4) | MIT licensed, Go binary, high performance, packet-preserving zero-transcode proxy with v3 REST Control API |
| `@prisma/client` | 5.x | Database ORM | Extends PostgreSQL schema with `cameras` model |
| `fastify` | ^4.28 / 5.x | REST API server | Endpoints for discovery (`POST /api/cameras/discover`), onboarding (`POST /api/cameras`), and list/delete |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^3.23 | Request payload validation | Validating camera onboarding schemas, manual RTSP URLs, and MediaMTX path config |
| `undici` / native `fetch` | Node 20 LTS | HTTP client for MediaMTX v3 API | REST calls to `http://localhost:9997/v3/config/paths/*` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node-onvif` | `agsh/onvif` | `agsh/onvif` has broader Profile T event support, but `node-onvif` has a cleaner discovery API for basic streaming. Both are MIT; `CameraProvider` interface ensures interchangeable adapters. |
| MediaMTX v3 API | Static `mediamtx.yml` rewriting | Static file rewriting requires server reloads, dropping active streams. The v3 API allows atomic path addition/deletion without restarting MediaMTX. |

**Installation:**
```bash
npm install node-onvif
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### System Architecture Diagram

```
       [ Local LAN Subnet ]
                │
         (UDP 3702 Probe)
                ▼
      ┌────────────────────┐
      │ WS-Discovery Probe │
      └─────────┬──────────┘
                │ Discovered Camera IP / XAddr
                ▼
   ┌───────────────────────────┐
   │  CameraProvider Adapter   │ ◄── Enforces CAM-04 Abstraction Barrier
   │   (node-onvif wrapper)    │
   └────────────┬──────────────┘
                │ Authenticate & Query Profile T / S
                │ Returns: rtsp://user:pass@camera-ip/live/main
                ▼
   ┌───────────────────────────┐
   │ Camera Onboarding Service │ ◄── Enforces License Limit: capabilities.getCameraLimit()
   └────────────┬──────────────┘
                ├─────────────────────────────────────────┐
                ▼                                         ▼
   ┌──────────────────────────┐             ┌───────────────────────────┐
   │     PostgreSQL (DB)      │             │    MediaMtxClient (API)   │
   │      `cameras` table     │             │ POST /v3/config/paths/add │
   └────────────┬─────────────┘             └─────────────┬─────────────┘
                │                                         │
                ▼                                         ▼
   ┌──────────────────────────┐             ┌───────────────────────────┐
   │     Core Event Bus       │             │   MediaMTX Media Server   │
   │  emit('camera.online')   │             │   Pulls RTSP / Exposes    │
   └──────────────────────────┘             │      WebRTC & fMP4        │
                                            └───────────────────────────┘
```

### Recommended Project Structure
```
src/
├── cameras/
│   ├── camera-provider.interface.ts   # Vendor-neutral CameraProvider & CameraSession types
│   ├── onvif.provider.ts              # Concrete ONVIF implementation using node-onvif
│   ├── camera.service.ts              # Business logic: discovery, validation, DB persistence
│   ├── camera.routes.ts               # Fastify routes: /api/cameras, /api/cameras/discover
│   └── camera.types.ts                # Zod schemas & DTOs
├── mediamtx/
│   ├── mediamtx.client.ts             # MediaMTX v3 REST API client (/v3/config/paths/*)
│   └── mediamtx.types.ts              # MediaMTX path configuration schemas
├── db/
│   └── prisma.ts                      # Shared Prisma client
└── events/
    └── event-bus.ts                   # Core Event Bus (camera.online/offline)
```

### Pattern 1: Vendor-Neutral `CameraProvider` Interface
**What:** Strict separation of ONVIF libraries from domain controllers.
```typescript
export interface DiscoveredCamera {
  urn: string;
  name?: string;
  xaddr: string;
  ip: string;
  port: number;
}

export interface CameraStreamProfile {
  name: string;
  token: string;
  encoding: 'H264' | 'H265' | 'JPEG';
  resolution: { width: number; height: number };
  fps?: number;
  rtspUri: string;
}

export interface ICameraProvider {
  discover(timeoutMs?: number): Promise<DiscoveredCamera[]>;
  probe(ip: string, port: number, timeoutMs?: number): Promise<boolean>;
  getProfiles(device: { xaddr: string; user?: string; pass?: string }): Promise<CameraStreamProfile[]>;
  getStreamUri(device: { xaddr: string; user?: string; pass?: string; profileToken?: string }): Promise<string>;
}
```

### Pattern 2: MediaMTX v3 Dynamic Path Management
**What:** Synchronizing camera streams into MediaMTX via REST API without file reloading.
```typescript
export class MediaMtxClient {
  constructor(private readonly baseUrl: string = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997') {}

  async addPath(name: string, rtspSource: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/v3/config/paths/add/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: rtspSource,
        sourceOnDemand: false, // Keep connection persistent for continuous live & recording
        maxReaders: 0,
      }),
    });
    return res.status === 200 || res.status === 201;
  }

  async deletePath(name: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/v3/config/paths/delete/${name}`, {
      method: 'DELETE',
    });
    return res.status === 200 || res.status === 404;
  }
}
```

### Anti-Patterns to Avoid
- **Leaking ONVIF SOAP Objects:** Never pass raw SOAP responses or vendor objects to API handlers or database tables.
- **Synchronous Network Blocking:** ONVIF probes and RTSP connection tests must have strict timeouts (≤3000ms) to prevent blocking the Fastify event loop.
- **Hardcoding MediaMTX Configuration in Files:** Do not regenerate `mediamtx.yml` on disk and send SIGHUP; use the Control API to avoid terminating existing active streams.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WS-Discovery XML crafting | Custom UDP multicast SOAP builder | `node-onvif` / `agsh/onvif` | WS-Discovery requires complex SOAP envelopes, UUID action matching, and multi-interface binding |
| Media Transcoding & Ingest | Custom FFmpeg process manager in Node | MediaMTX | Custom FFmpeg in Node causes runaway CPU, zombie processes, and memory leaks on low-cost NVR hardware |
| RTSP URL Parsing & Auth | Manual string concatenation | Standard URI parser with credential encoding | Passwords containing `@`, `:`, or `#` break manual string splits |

**Key insight:** CCTV video transport and camera protocols are notoriously fragmented across vendors (Hikvision vs CP Plus vs Dahua). MediaMTX handles RTSP keep-alives and packet transport, while pinned ONVIF libraries handle SOAP differences. Keep the Node layer strictly focused on orchestration.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Dual-Subnet & Virtual Network Multicast Loss
**What goes wrong:** WS-Discovery probe finds 0 cameras even though cameras are pingable on LAN.
**Why it happens:** UDP multicast (`239.255.255.250:3702`) binds to the default network interface (which might be Docker's `docker0` bridge or a VPN virtual adapter).
**How to avoid:** Allow passing or binding the specific local IP/subnet mask, and provide immediate manual IP probe (`probe(ip, port)`) and manual RTSP entry as first-class fallbacks (Requirement `CAM-03`).
**Warning signs:** Empty discovery list while cameras respond to HTTP/ping.

### Pitfall 2: MediaMTX Offline or Unreachable on Host
**What goes wrong:** Adding a camera crashes the application when MediaMTX is not running.
**Why it happens:** Backend expects MediaMTX API to be immediately available.
**How to avoid:** MediaMtxClient must implement graceful degradation: log warnings, mark camera status as `stream_unconfigured` or retry asynchronously, and allow mock mode for development and testing.

### Pitfall 3: Password Special Characters in RTSP URLs
**What goes wrong:** RTSP connection fails when installer sets a camera password containing `@` or `/` (e.g. `Admin@123`).
**Why it happens:** MediaMTX parses RTSP URIs using standard URI rules; unencoded `@` splits the userinfo incorrectly.
**How to avoid:** Always use `encodeURIComponent` on username and password when constructing internal RTSP source URIs for MediaMTX.
</common_pitfalls>

<code_examples>
## Code Examples

### ONVIF Discovery and RTSP URI Extraction (node-onvif)
```typescript
import onvif from 'node-onvif';

export async function discoverCameras(timeoutMs = 3000): Promise<any[]> {
  try {
    const devices = await onvif.startProbe({ timeout: timeoutMs });
    return devices.map((dev: any) => ({
      urn: dev.urn,
      name: dev.name,
      xaddr: dev.xaddrs[0],
      ip: new URL(dev.xaddrs[0]).hostname,
      port: parseInt(new URL(dev.xaddrs[0]).port || '80', 10),
    }));
  } catch (err) {
    return [];
  }
}
```

### Fastify Camera Routes with License Gating
```typescript
// Enforce single-site license limit before adding camera
fastify.post('/cameras', { preHandler: [requireRole([Role.ADMIN])] }, async (request, reply) => {
  const cameraLimit = request.server.capabilities.getCameraLimit();
  const currentCount = await prisma.camera.count();

  if (currentCount >= cameraLimit) {
    return reply.status(403).send({
      error: 'LicenseLimitExceeded',
      message: `Current license limits installation to ${cameraLimit} cameras.`,
      cameraLimit,
    });
  }

  // Proceed with onboarding and MediaMTX path configuration
});
```
</code_examples>

## Validation Architecture

### Test Suite Strategy
1. **Unit Tests (`tests/camera-provider.test.ts`)**:
   - Verify `CameraProvider` adapter contracts, Mock ONVIF device responses, and Profile T/S fallback.
   - Verify URL sanitization and special character encoding in RTSP credentials.
2. **Integration Tests (`tests/mediamtx-client.test.ts`)**:
   - Verify `MediaMtxClient` REST operations with HTTP mocking (Undici `MockAgent`).
   - Verify retry handling, 404 on delete, and payload formatting.
3. **API & Workflow Tests (`tests/camera-routes.test.ts`)**:
   - Test camera discovery endpoint (`POST /api/cameras/discover`).
   - Test manual RTSP onboarding (`POST /api/cameras`).
   - Test entitlement enforcement: verify that adding a 3rd camera on an evaluation license (2 camera limit) returns HTTP 403 `LicenseLimitExceeded`.
   - Test event bus emission: verify `camera.online` and `camera.offline` events are emitted and logged.

<sota_updates>
## State of the Art (2024-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom GStreamer/FFmpeg transcoding | MediaMTX zero-decode packet-preserving proxy | 2023-2024 | Dramatic drop in CPU load on budget 4-core NVR boxes |
| Static `mediamtx.yml` file restart | MediaMTX v3 Control REST API | v1.x (2023+) | Zero stream disruption when adding/removing cameras dynamically |
| Proprietary Dahua/Hikvision SDKs | Standard ONVIF Profile T / S | Ongoing standard | Complete vendor independence; single codebase for CP Plus, Hikvision, and Prama |
</sota_updates>

<open_questions>
## Open Questions

1. **Sub-stream auto-detection:**
   - What we know: Profile T/S cameras almost always expose at least 2 profiles (Main high-res, Sub low-res).
   - Recommendation: In `getProfiles()`, sort by resolution. Set the highest resolution profile as `rtspUrl` (main) and the lower resolution as `subStreamUrl` (sub) so Phase 4 grid can use sub-streams.
2. **MediaMTX standalone execution during local development:**
   - Recommendation: Allow `MediaMtxClient` to operate with an in-memory/mock fallback when MediaMTX is not actively running during local test execution.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- MediaMTX v3 API Documentation (`/v3/config/paths/*`)
- ONVIF Core Specification & Profile T / S Test Specifications
- `node-onvif` (MIT) and `@camstream/onvif` documentation

### Secondary (MEDIUM confidence)
- CCTV installer forum guidelines for CP Plus / Dahua default credentials and RTSP paths

<metadata>
## Metadata

**Research scope:**
- Core technology: MediaMTX v3 API, ONVIF Profile T/S, RTSP Ingest, Fastify
- Ecosystem: `node-onvif`, PostgreSQL/Prisma, EventBus
- Pitfalls: UDP multicast routing, RTSP URI credentials, camera license limits

**Confidence breakdown:**
- Standard stack: HIGH
- Architecture: HIGH
- Pitfalls: HIGH
- Code examples: HIGH

**Research date:** 2026-09-24  
**Valid until:** 2026-10-24  
</metadata>

---
*Phase: 02-media-plane-camera-onboarding*  
*Research completed: 2026-09-24*  
*Ready for planning: yes*
