# Roadmap: Basic VMS

## Overview

Basic VMS delivers a reliable, lightweight video management core (Package 1) targeting CP Plus / Hikvision DVR replacement in the Indian SMB and residential market. The system is built on a clean-room Node/TypeScript control plane, PostgreSQL database, React web frontend, and MediaMTX media plane. The roadmap progresses from foundation (clean-room database, Ed25519 licensing, and unified event bus) through camera onboarding, continuous/scheduled recording, WebRTC live view, 24h timeline scrubbing, native ONVIF motion alerts, and single-command deployment.

## Phases

### Milestone v1.0: Core
- [x] **Phase 1: Foundation, Licensing & Event Bus** - Clean-room control plane, schema, Ed25519 Capability Registry, 2-role RBAC, and unified event model (completed 2026-09-23)
- [x] **Phase 2: Media Plane & Camera Onboarding** - MediaMTX integration, internal `CameraProvider` adapter, ONVIF Profile T/S auto-discovery, and RTSP stream provisioning (completed 2026-09-24)
- [x] **Phase 3: Recording Engine & Storage Management** - Continuous and scheduled packet-preserving fMP4 recording, segment cataloging, and automated disk rollover (completed 2026-09-24)
- [x] **Phase 4: Live View Grid & Mobile Streaming** - React multi-camera live grid (1x1, 2x2, 3x3), WebRTC (WHEP) with HLS fallback, and Coturn NAT traversal (completed 2026-09-24)
- [x] **Phase 5: 24-Hour Playback & Timeline Scrubbing** - Visual 24-hour timeline scrubber, MediaMTX playback server queries, and frame-accurate seeking (completed 2026-09-24)
- [x] **Phase 6: ONVIF Motion Alerts & Real-Time Event Feed** - Native camera motion event subscriptions via Profile T PullPoint, event bus dispatch, and WebSocket alerts (completed 2026-09-24)
- [x] **Phase 7: Packaging, CI/SBOM & Single-Command Deployment** - Automated Docker installer (<30 min deployment), release SBOM generator, and license compliance verification (completed 2026-09-24)

### Milestone v2.0: Package 2 (Extended)
- [x] **Phase 8: Operator Role & Granular RBAC** - 3-tier user role hierarchy, camera permission ACLs, route authorization hooks, and operator workstation UI (completed 2026-09-24)
- [x] **Phase 9: ONVIF PTZ Controls & Camera Presets** - Profile S PTZ integration, virtual joystick overlay, preset tours, and 1.5s safety watchdog (completed 2026-09-24)
- [ ] **Phase 10: Server-Side Clip Export & Timeline Bookmarks** - FFmpeg packet-copy MP4 cutting, burned-in timestamp OSD/watermark, 48h TTL cleanup, and timeline incident bookmarks
- [ ] **Phase 11: Motion Zones & Spatial Exclusion Masking** - Interactive SVG polygon drawing, normalized ray-casting coordinate containment, and alert suppression
- [ ] **Phase 12: Camera Health Telemetry, WhatsApp Alerts & Webhooks** - 30s ping/stream health monitoring, rate-limited WhatsApp incident alerting, and signed integration webhooks

---

## Phase Details

### Phase 1: Foundation, Licensing & Event Bus

**Goal**: Establish clean-room Node/Fastify control plane, PostgreSQL database schema, standalone Ed25519 offline license verification with Capability Registry, 2-role RBAC (Admin, Viewer), and unified Event model.
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: [AUTH-01, AUTH-02, LIC-01, LIC-02, LIC-03, LIC-04, EVT-01, EVT-02]
**Success Criteria**:

1. Server starts with validated Ed25519 license document resolving to active capabilities via `capabilities.has(...)`.
2. Admin and Viewer users can log in, receive signed JWT tokens, and access role-permitted route namespaces.
3. System logs and queries Core lifecycle events (`camera.online/offline`, `recording.started/stopped`, `storage.warning/full`) using unified `events` schema.
4. Licensing module is completely decoupled from VigilOne domain models, tenant IDs, and evidentiary concepts.

**Plans**: 3 plans

Plans:

- [x] 01-01: Scaffold clean-room monorepo/workspace structure, TypeScript configuration, Fastify HTTP server, and PostgreSQL database schema.
- [x] 01-02: Implement standalone Ed25519 offline license verification and Capability Registry (`capabilities.has(...)`) gating route namespaces.
- [x] 01-03: Implement 2-role RBAC authentication (Admin, Viewer) and the unified Core Event Bus.

---

### Phase 2: Media Plane & Camera Onboarding

**Goal**: Integrate MediaMTX media server, implement vendor-neutral `CameraProvider` adapter, auto-discover ONVIF Profile T/S cameras, and manage RTSP streams.
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: [CAM-01, CAM-02, CAM-03, CAM-04, CAM-05]
**Success Criteria**:

1. Integrator can run network scan and discover ONVIF-compliant IP cameras on local subnet.
2. Discovered cameras (or manual RTSP entries) authenticate and onboard via internal `CameraProvider` adapter without exposing ONVIF library internals.
3. Successfully onboarded cameras automatically configure streaming paths in MediaMTX.

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 02-01: Configure MediaMTX media plane service and build internal `CameraProvider` abstraction wrapping pinned ONVIF client.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02: Implement ONVIF WS-Discovery, camera authentication, stream URI retrieval, and dynamic MediaMTX path configuration sync.

---

### Phase 3: Recording Engine & Storage Management

**Goal**: Implement continuous and scheduled segment recording via MediaMTX hooks, catalog segments in PostgreSQL, and enforce disk quota with automatic rollover.
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: [REC-01, REC-02, REC-03, REC-04, REC-05]
**Success Criteria**:

1. Video streams record in packet-preserving fMP4 chunks without re-encoding CPU overhead.
2. MediaMTX `runOnRecordSegmentComplete` hook indexes finished chunks into the `recordings` database table.
3. Cameras follow configured recording schedules (e.g., 24/7 continuous or time-windowed).
4. Oldest video segments are automatically deleted when disk capacity threshold is reached, emitting storage warning and rollover events.

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 03-01: Configure MediaMTX fMP4 segment recording, implement webhook handler for `runOnRecordSegmentComplete`, and record metadata to database.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02: Implement camera recording scheduler worker and storage disk monitor with automatic FIFO rollover.

---

### Phase 4: Live View Grid & Mobile Streaming

**Goal**: Deliver a responsive React multi-camera live grid with low-latency WebRTC (WHEP) streaming, HLS fallback, and Coturn NAT traversal for remote viewing.
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: [LIVE-01, LIVE-02, LIVE-03, LIVE-04]
**Success Criteria**:

1. User can monitor 1, 4 (2x2), or 9 (3x3) camera streams simultaneously with sub-500ms latency via WebRTC.
2. Live viewer gracefully falls back to HLS stream if WebRTC handshake fails.
3. Remote mobile client successfully connects and streams live video through configured Coturn/STUN relay.

**Plans**: 2 plans

Plans:

- [x] 04-01: Build React web client multi-camera grid UI with WebRTC (WHEP) player and HLS fallback.
- [x] 04-02: Configure Coturn STUN/TURN traversal and verify mobile remote streaming connectivity.

---

### Phase 5: 24-Hour Playback & Timeline Scrubbing

**Goal**: Provide a responsive visual 24-hour timeline scrubber in the React frontend backed by MediaMTX playback API server.
**Mode**: mvp
**Depends on**: Phase 3
**Requirements**: [PLAY-01, PLAY-02, PLAY-03, PLAY-04]
**Success Criteria**:

1. User can see 24-hour bar showing recorded footage blocks and activity markers.
2. User can scrub to any point on the timeline, instantly streaming recorded fMP4 segments from MediaMTX playback server.
3. User can pause, seek, and resume playback smoothly across segment boundaries.

**Plans**: 2 plans

Plans:

- [x] 05-01: Implement backend playback API bridging frontend requests to MediaMTX `/list` and `/get` endpoints with RBAC checks.
- [x] 05-02: Build React 24-hour visual timeline scrubber with seek, play, pause, and segment transition controls.

---

### Phase 6: ONVIF Motion Alerts & Real-Time Event Feed

**Goal**: Capture native camera motion and tampering events via ONVIF Profile T PullPoint subscriptions, emit through Core event bus, and push live alerts to the web client.
**Mode**: mvp
**Depends on**: Phase 1, Phase 2
**Requirements**: [EVT-03, EVT-04, EVT-05]
**Success Criteria**:

1. System maintains persistent ONVIF event subscriptions with connected cameras.
2. Native motion triggers generate `motion.detected` records in the unified `events` table.
3. Real-time WebSocket feed alerts user in web UI with timestamp, camera name, and visual badge.

**Plans**: 2 plans

Plans:

- [x] 06-01: Implement ONVIF Profile T event listener service (PullPoint / BaseNotification) dispatching to Core event bus.
- [x] 06-02: Build WebSocket live alert broadcast service and React real-time notification drawer/badge.

---

### Phase 7: Packaging, CI/SBOM & Single-Command Deployment

**Goal**: Package the full system for single-command installer deployment (<30 min setup) with automated SBOM generation and license compliance audits.
**Mode**: mvp
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6
**Requirements**: [DEP-01, DEP-02, DEP-03, DEP-04]
**Success Criteria**:

1. Integrator can run a single deployment command on fresh host and achieve live camera view in under 30 minutes.
2. Automated CI pipeline scans all dependencies and validates 100% permissive licensing (MIT, Apache-2.0, BSD).
3. CI automatically exports release SBOM and license notices (`third_party/licenses/`, `third_party/notices/`).
4. System automatically recovers and resumes recording and streaming following host power loss.

**Plans**: 2 plans

Plans:

- [x] 07-01: Create Docker Compose production deployment stack, setup script, and systemd service unit.
- [x] 07-02: Implement CI SBOM generator, license compliance scanner, and power-loss recovery smoke tests.

---

### Phase 8: Operator Role & Granular RBAC

**Goal**: Establish 3-tier user role hierarchy (`ADMIN`, `OPERATOR`, `VIEWER`), implement per-camera permission ACLs, enforce route-level authorization hooks, and provide an operator workstation UI.
**Mode**: mvp
**Depends on**: Phase 1, Phase 7
**Requirements**: [EXT-01]
**Success Criteria**:

1. Admin can assign `OPERATOR` role to user accounts with specific per-camera permissions (`canViewLive`, `canViewPlayback`, `canControlPtz`, `canCreateBookmarks`).
2. Operators can stream permitted live/playback video but receive HTTP 403 on camera creation, deletion, recording schedule configuration, or storage modification endpoints.
3. React UI dynamically hides configuration tabs and mutation controls when logged in as an Operator.

**Plans**: 2 plans

Plans:

- [x] 08-01: Prisma schema migration for `Role.OPERATOR` and `CameraPermission` table, ACL middleware, and permission assignment API.
- [x] 08-02: React operator mode workstation view, permission-filtered camera list, and UI mutation gating.

---

### Phase 9: ONVIF PTZ Controls & Camera Presets

**Goal**: Implement ONVIF Profile S PTZ service in `CameraProvider`, REST endpoints gated by `extended.ptz`, virtual joystick UI overlay on live camera tiles, preset management, and a 1.5s server-side watchdog auto-stop.
**Mode**: mvp
**Depends on**: Phase 2, Phase 8
**Requirements**: [EXT-03]
**Success Criteria**:

1. Operator can pan, tilt, and optically zoom PTZ-capable cameras via UI joystick and directional controls with sub-200ms command latency.
2. Server automatically stops camera movement 1500ms after last command to prevent runaway pan if client disconnects.
3. User can save, recall, and tour camera preset positions.

**Plans**: 2 plans

Plans:

- [x] 09-01: Backend ONVIF Profile S PTZ service (`ContinuousMove`, `Stop`, `AbsoluteMove`, presets) with 1.5s watchdog auto-stop and REST API.
- [x] 09-02: React virtual joystick overlay, optical zoom slider, preset quick-select buttons, and live stream keyboard shortcuts.

---

### Phase 10: Server-Side Clip Export & Timeline Bookmarks

**Goal**: Deliver zero-transcode stream-copy MP4 cutting, explicit OSD transcoded derivatives, two-tier disk cleanup hierarchy (85%/90%), and 24-hour timeline incident bookmarks with color-coded markers and range queries.
**Mode**: mvp
**Depends on**: Phase 3, Phase 5, Phase 8
**Requirements**: [EXT-04, EXT-05]
**Success Criteria**:

1. User can select a timeline range and download an exported MP4 clip stitched via FFmpeg stream copy (`-c copy`) with zero media decoding/re-encoding.
2. User can optionally export a rendered derivative with burned-in timestamp OSD and camera name watermark without crashing host CPU.
3. Exported clips include an automated SHA-256 integrity checksum and are managed by a two-tier storage pruner (85% expired, 90% emergency FIFO) that strictly protects continuous recordings.
4. Operators can create, edit, and search timeline bookmarks with category tags and visual scrubber pins aware of recording gaps.

**Plans**: 2 plans

Plans:

- [x] 10-01: FFmpeg stream-copy export engine with segment compatibility validator, Transcoded Derivative OSD pipeline, SHA-256 integrity checksum, two-tier storage pruner, and range-queryable bookmarks API.
- [x] 10-02: React clip export modal (Original Stream Copy vs Transcoded Derivative), gap-aware timeline scrubber with bookmark pins, and playback integration.

---

### Phase 11: Motion Zones & Spatial Exclusion Masking

**Goal**: Provide an interactive SVG polygon editor on camera tiles, normalize vertices (0.0 to 1.0), and filter native ONVIF motion events via ray-casting containment before dispatching alerts.
**Mode**: mvp
**Depends on**: Phase 6, Phase 8
**Requirements**: [EXT-02]
**Success Criteria**:

1. User can draw custom inclusion and exclusion polygon zones directly over the camera feed in the web UI.
2. System normalizes polygon coordinates and accurately drops motion events outside active zones using Ray-Casting.
3. Real-time alert notifications and guard chimes only trigger when motion occurs inside active zones.

**Plans**: 2 plans

Plans:

- [x] 11-01: Motion zone schema, API routes, and Ray-Casting (`point-in-polygon`) event filter intercepting ONVIF motion triggers.
- [x] 11-02: React interactive SVG polygon canvas editor for camera tiles with inclusion/exclusion zone color coding.

---

### Phase 12: Camera Health Telemetry, WhatsApp Alerts & Webhooks

**Goal**: Implement background camera health polling (ping + MediaMTX stream telemetry), token-bucket rate-limited WhatsApp incident alerting, and HMAC-SHA256 signed outbound webhooks.
**Mode**: mvp
**Depends on**: Phase 6, Phase 11
**Requirements**: [EXT-06, EXT-07, EXT-08]
**Success Criteria**:

1. System detects camera disconnection within 30 seconds and raises `camera.offline` event with visual dashboard badge.
2. System sends formatted WhatsApp incident alerts with snapshot links, enforcing a 60-second anti-spam cooldown.
3. Outbound HTTP POST webhooks deliver HMAC-SHA256 signed payloads to external access control and barrier systems asynchronously.

**Plans**: 2 plans

Plans:

- [x] 12-01: Background health monitor worker (TCP ping + MediaMTX path metrics) with `camera.degraded`/`offline` alert events and UI indicators.
- [x] 12-02: Token-bucket WhatsApp Cloud API / Twilio dispatcher, HMAC-SHA256 outbound webhook engine, and admin notification settings UI.

---

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation, Licensing & Event Bus | 3/3 | Complete    | 2026-09-23 |
| 2. Media Plane & Camera Onboarding | 2/2 | Complete    | 2026-09-24 |
| 3. Recording Engine & Storage Management | 2/2 | Complete    | 2026-09-24 |
| 4. Live View Grid & Mobile Streaming | 2/2 | Complete    | 2026-09-24 |
| 5. 24-Hour Playback & Timeline Scrubbing | 2/2 | Complete    | 2026-09-24 |
| 6. ONVIF Motion Alerts & Real-Time Event Feed | 2/2 | Complete    | 2026-09-24 |
| 7. Packaging, CI/SBOM & Single-Command Deployment | 2/2 | Complete    | 2026-09-24 |
| 8. Operator Role & Granular RBAC | 2/2 | Complete    | 2026-09-24 |
| 9. ONVIF PTZ Controls & Camera Presets | 2/2 | Complete    | 2026-09-24 |
| 10. Server-Side Clip Export & Timeline Bookmarks | 2/2 | Complete    | 2026-09-24 |
| 11. Motion Zones & Spatial Exclusion Masking | 2/2 | Complete    | 2026-09-24 |
| 12. Camera Health Telemetry, WhatsApp Alerts & Webhooks | 2/2 | Complete    | 2026-09-25 |
