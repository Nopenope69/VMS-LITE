# Architecture Research: Package 2 (Extended)

**Domain:** Commercial Video Management System (VMS) Extended Architecture
**Researched:** 2026-09-24
**Confidence:** HIGH

## System Overview

Milestone v2.0 builds upon the Package 1 foundation (MediaMTX media plane + Fastify control plane + React frontend + PostgreSQL), cleanly isolating all extended features behind capability guards and modular domain seams.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       React Web UI (Workstation)                            │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────────┐ │
│  │ Live Grid     │ │ PTZ Joystick  │ │ Timeline &    │ │ Motion Zone     │ │
│  │ (WHEP Player) │ │ Overlay       │ │ Bookmarks     │ │ Polygon Editor  │ │
│  └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └────────┬────────┘ │
└──────────┼─────────────────┼─────────────────┼──────────────────┼───────────┘
           │ WHEP/WebRTC     │ REST / WebSockets (Gated by capabilities.has)
           ▼                 ▼                 ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Fastify Control Plane (Node.js)                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Capability Gating Pre-Handler: requireCapability('extended.*')        │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│       ┌──────────────────┬───────────┴───────┬─────────────────┐            │
│       ▼                  ▼                   ▼                 ▼            │
│  ┌──────────┐      ┌──────────┐        ┌───────────┐     ┌───────────┐      │
│  │ Ptz      │      │ Export   │        │ Zone      │     │ Health    │      │
│  │ Service  │      │ Engine   │        │ Filter    │     │ Monitor   │      │
│  └────┬─────┘      └────┬─────┘        └─────┬─────┘     └─────┬─────┘      │
│       │ SOAP            │ FFmpeg Spawn       │                 │ HTTP Ping  │
└───────┼─────────────────┼────────────────────┼─────────────────┼────────────┘
        │                 ▼                    ▼                 │
        │           ┌───────────┐        ┌───────────┐           │
        │           │ Disk      │        │ Core      │◄──────────┘
        │           │ Cache     │        │ Event Bus │
        │           └───────────┘        └─────┬─────┘
        │                                      │
        ▼                                      ▼
┌──────────────────┐                     ┌───────────────────────────┐
│ MediaMTX /       │                     │ Outbound Dispatch Engine  │
│ Physical Cameras │                     │ ┌───────────┐ ┌─────────┐ │
│ (ONVIF PTZ)      │                     │ │ WhatsApp  │ │ Webhook │ │
│                  │                     │ └───────────┘ └─────────┘ │
└──────────────────┘                     └───────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | Implementation Details |
|-----------|----------------|------------------------|
| **`PtzService`** | Translates UI joystick vectors (X, Y, Zoom) into ONVIF Profile S SOAP requests with safety watchdog timeout. | Wraps `ContinuousMove`, `Stop`, `AbsoluteMove`, `GetPresets`, and `GotoPreset`. Uses a 1.5s auto-stop timer to avoid runaway panning. |
| **`ExportEngine`** | Asynchronously stitches recorded fMP4 segments and applies optional OSD burn-in filters. | Uses `child_process.spawn('ffmpeg')`. Default mode uses `-c copy` (zero CPU, packet copy). OSD mode applies `drawtext` with camera name and timestamps. Stores exports in `/var/lib/basic-vms/exports/` with 48h TTL cleanup. |
| **`ZoneFilter`** | Evaluates raw camera motion coordinates against configured polygon exclusion/inclusion masks. | In-memory evaluation using Ray-Casting (`point-in-polygon`). Drops motion events occurring outside active zones before publishing to the live alert bus. |
| **`HealthMonitor`** | Continuously tracks camera reachability, frame drops, and latency. | Background worker querying MediaMTX `/v3/paths/list` API + TCP ping to camera IP. Publishes `camera.offline` or `camera.degraded` events. |
| **`DispatchService`** | Dispatches real-time alerts to external channels (WhatsApp, Webhooks). | Reads verified motion/alarm events from Event Bus. Enforces token bucket rate limiting (max 1 alert per camera per 60s) to prevent spamming. Signs webhooks with HMAC-SHA256. |
| **`AccessControlManager`** | Enforces 3-tier RBAC (`Admin`, `Operator`, `Viewer`) and per-camera permission ACLs. | Decorates Fastify requests with `user.role` and checks camera ACL before servicing live, playback, or PTZ endpoints. |

---

## Recommended Project Structure

```
src/
├── extended/                     # Package 2 Extended Domain Modules
│   ├── acl/                      # 3-Tier RBAC & Camera Permissions
│   │   ├── permissions.ts        # ACL verification logic
│   │   └── routes.ts             # User role & permission assignment routes
│   ├── ptz/                      # ONVIF Profile S PTZ Module
│   │   ├── ptz-service.ts        # Pan/Tilt/Zoom controller with watchdog
│   │   ├── types.ts              # Direction vectors and preset schemas
│   │   └── routes.ts             # /api/v1/cameras/:id/ptz routes
│   ├── export/                   # Video Export & Watermark Engine
│   │   ├── export-engine.ts      # FFmpeg runner, concat & OSD filters
│   │   ├── export-queue.ts       # Async background job queue
│   │   └── routes.ts             # /api/v1/recordings/export routes
│   ├── zones/                    # Motion Zones & Masking
│   │   ├── zone-filter.ts        # Ray-casting polygon containment
│   │   └── routes.ts             # /api/v1/cameras/:id/zones routes
│   ├── bookmarks/                # Timeline Bookmarks
│   │   ├── bookmark-service.ts   # CRUD & search for timeline markers
│   │   └── routes.ts             # /api/v1/cameras/:id/bookmarks routes
│   ├── health/                   # Camera Health & Diagnostics
│   │   ├── health-monitor.ts     # MediaMTX path telemetry & TCP pings
│   │   └── routes.ts             # /api/v1/cameras/:id/health routes
│   └── dispatch/                 # External Notifications & Webhooks
│       ├── whatsapp-client.ts    # Meta Cloud API / Twilio dispatcher
│       ├── webhook-client.ts     # HMAC-SHA256 signed outbound webhooks
│       └── rate-limiter.ts       # Token-bucket alert cooldown manager
├── licensing/                    # Capability Gating Foundation
│   ├── capabilities.ts           # CapabilityRegistry
│   └── plugin.ts                 # requireCapability('extended.*')
```

---

## Architectural Patterns & Seams

### 1. Capability Gating at Route Namespace
Every extended route is registered under `/api/v1/...` and guarded by `requireCapability`:
```typescript
fastify.post(
  '/api/v1/cameras/:id/ptz/move',
  { preHandler: [fastify.authenticate, requireCapability('extended.ptz')] },
  ptzController.move
);
```
If a customer has a Core license, the request is rejected with `403 Forbidden` (`Missing required capability: 'extended.ptz'`) before touching any business logic.

### 2. PTZ Safety Watchdog Pattern
To prevent mechanical damage and runaway pan:
```typescript
// On ContinuousMove request:
this.clearWatchdog(cameraId);
await onvifPtz.continuousMove(x, y, zoom);
this.watchdogTimer = setTimeout(async () => {
  await onvifPtz.stop();
}, 1500); // Auto-stops after 1.5s unless renewed
```

### 3. Decoupled Outbound Dispatch Pipeline
The `DispatchService` does not poll or intercept camera routes. It simply subscribes to the existing Core `EventBus`:
```typescript
eventBus.on('motion.detected', async (event) => {
  if (this.zoneFilter.isWithinActiveZone(event.cameraId, event.metadata?.coordinates)) {
    if (this.rateLimiter.allow(event.cameraId)) {
      await Promise.allSettled([
        this.whatsappClient.sendAlert(event),
        this.webhookClient.broadcast(event)
      ]);
    }
  }
});
```
