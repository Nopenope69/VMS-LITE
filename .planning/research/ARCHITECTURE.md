# Architecture Research

**Domain:** Video Management System (VMS) — SMB/Residential CCTV Tier (CP Plus / Hikvision DVR equivalent)
**Researched:** 2026-09-24
**Confidence:** HIGH

## System Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │                 IP Cameras                   │
                  │   (CP Plus, Hikvision, Dahua, Generic ONVIF)  │
                  └──────────────┬──────────────────┬────────────┘
                                 │ RTSP Stream      │ ONVIF WS-Discovery / Events
                                 ▼                  ▼
┌──────────────────────────────────────────────┐  ┌─────────────────────────────────┐
│               Media Plane                    │  │         Control Plane           │
│               (MediaMTX)                     │  │        (Node/TypeScript)        │
│                                              │  │                                 │
│  - RTSP Ingest Engine                        │  │  - Camera Management & Onboard  │
│  - WebRTC (WHEP) / HLS Streamer              │  │    (`CameraProvider` Adapter)   │
│  - Segment Recording Engine                  │  │  - Event Bus & Motion Alerts    │
│  - Playback API Server (/list, /get)         │  │  - Storage Rollover Manager     │
│                                              │  │  - Capability Registry (Ed25519)│
│  Hooks: runOnRecordSegmentComplete           │  │  - RBAC (Admin, Viewer)         │
└───────────────────────┬──────────────────────┘  └───────────────┬─────────────────┘
                        │ Notify segment complete                 │
                        ▼                                         ▼
            ┌────────────────────────────────────────────────────────┐
            │               PostgreSQL Database                      │
            │   - cameras: configuration, RTSP URLs, ONVIF params    │
            │   - recordings: segment path, camera_id, start/end     │
            │   - events: unified event log                          │
            │   - users: credentials, role (Admin, Viewer)           │
            └────────────────────────────────────────────────────────┘
                                 │
                                 ▼
            ┌────────────────────────────────────────────────────────┐
            │                React Web Client                        │
            │   - Multi-Camera Live Grid (WebRTC / HLS)              │
            │   - 24h Playback Scrubber & Timeline Player            │
            │   - Motion Alert Feed & Event Stream                   │
            │   - Minimal Admin Console (Camera Add, Users, Storage) │
            └────────────────────────────────────────────────────────┘
```

## Component Boundaries

### 1. MediaMTX (Media Plane)
- Authoritative handler for all video frames and audio packets.
- Ingests RTSP streams from discovered cameras.
- Provides low-latency WebRTC streams to frontend clients (with HLS fallback).
- Records fMP4/MP4 segments directly to designated disk storage without decoding.
- Exposes playback endpoints (`/list` and `/get`) for temporal querying of recorded footage.
- Triggers `runOnRecordSegmentComplete` webhook/script to notify the Node control plane when a new chunk is finalized.

### 2. Node/TypeScript Control Plane
- **`src/cameras/`**: Discovers cameras via ONVIF probe, validates RTSP streams, manages camera records in DB, provisions stream paths into MediaMTX configuration.
- **`src/recording/`**: Receives segment-completion notifications from MediaMTX, indexes segment metadata into the database catalog, and tracks active recording policies (continuous vs scheduled).
- **`src/playback/`**: Bridges frontend timeline requests with MediaMTX's `/list` and `/get` endpoints, verifying user permissions before serving media links.
- **`src/events/`**: Receives native ONVIF motion events via camera subscriptions, logs them to the unified `events` table, and broadcasts live alerts over WebSockets.
- **`src/storage/`**: Monitors disk usage on the recording mount point. When storage thresholds are crossed, automatically prunes oldest footage from the catalog and filesystem.
- **`src/licensing/`**: Clean-room Ed25519 license verification. Resolves offline license tokens at boot into a capabilities set (`capabilities.has('ptz')`). Isolates route namespaces and bundle loading.
- **`src/users/`**: Manages Admin and Viewer accounts with JWT session tokens.

### 3. Capability Registry & Licensing Boundary
- The license is decrypted/verified at startup.
- Yields a capability registry: `capabilities.has("core")`, `capabilities.has("ptz")`, etc.
- **No tier checks in controllers**: Code never asks `if (license.tier === 'PRO')`. It asks `if (capabilities.has(feature))`.
- Package 1 routes and UI mount by default; Package 2 and Package 3 conditionally register their routes and chunks only if their respective capabilities are active.

## Data Flow

1. **Camera Discovery & Onboard:**
   Installer initiates scan → `CameraProvider` sends WS-Discovery probe → Discovered IP returned → Installer enters credentials → ONVIF `GetStreamUri` retrieves RTSP URL → Stored in PostgreSQL → MediaMTX path config dynamically updated.
2. **Live View:**
   Web client requests camera stream → Checks user JWT → Client establishes WebRTC peer connection directly with MediaMTX via WHEP endpoint → Video renders with sub-500ms latency.
3. **Recording & Cataloging:**
   MediaMTX ingests RTSP continuously → Writes segment (e.g. 60s fMP4) → Fires `runOnRecordSegmentComplete` → Node hook inserts segment record `{camera_id, start_time, end_time, file_path, duration}` into PostgreSQL.
4. **Timeline Playback:**
   Client requests 24h timeline for Camera X → Node queries `recordings` table for segments in window → Client scrubs to timestamp → Client requests fMP4 from MediaMTX playback server.
5. **Motion Alerting:**
   Camera detects motion → Emits ONVIF WS-BaseNotification / PullPoint event → Node event listener catches event → Emits `motion.detected` on Core event bus → Saved to `events` table → Dispatched to Web Client via WebSocket.

## Suggested Build Order

1. **Foundation & MediaMTX Configuration**: Local docker-compose environment with PostgreSQL, MediaMTX, and directory mounts.
2. **Control Plane Core & Database Schema**: Minimal schema (`cameras`, `recordings`, `events`, `users`), Fastify server, authentication.
3. **Licensing Library & Capability Registry**: Offline Ed25519 verification and capability gating.
4. **Camera Onboarding & ONVIF Adapter**: `CameraProvider` interface, discovery probe, RTSP stream ingestion in MediaMTX.
5. **Continuous/Scheduled Recording Pipeline**: MediaMTX segment hooks, database cataloging, storage rollover worker.
6. **Live View & WebRTC/HLS Integration**: Web client multi-camera grid with WHEP/WebRTC playback.
7. **Playback Server & Timeline UI**: 24h scrubbing interface queryable against catalog and MediaMTX playback server.
8. **Event Framework & ONVIF Motion Alerts**: Event bus, notification stream, live alert UI.
9. **Installer & Deployment Automation**: Single-command script / Docker deployment targeting <30 min setup.

---
*Architecture research for: Basic VMS*
*Researched: 2026-09-24*
