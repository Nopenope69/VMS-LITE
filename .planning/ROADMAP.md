# Roadmap: Basic VMS

## Overview

Basic VMS delivers a reliable, lightweight video management core (Package 1) targeting CP Plus / Hikvision DVR replacement in the Indian SMB and residential market. The system is built on a clean-room Node/TypeScript control plane, PostgreSQL database, React web frontend, and MediaMTX media plane. The roadmap progresses from foundation (clean-room database, Ed25519 licensing, and unified event bus) through camera onboarding, continuous/scheduled recording, WebRTC live view, 24h timeline scrubbing, native ONVIF motion alerts, and single-command deployment.

## Phases

- [x] **Phase 1: Foundation, Licensing & Event Bus** - Clean-room control plane, schema, Ed25519 Capability Registry, 2-role RBAC, and unified event model (completed 2026-09-23)
- [x] **Phase 2: Media Plane & Camera Onboarding** - MediaMTX integration, internal `CameraProvider` adapter, ONVIF Profile T/S auto-discovery, and RTSP stream provisioning (completed 2026-09-24)
- [x] **Phase 3: Recording Engine & Storage Management** - Continuous and scheduled packet-preserving fMP4 recording, segment cataloging, and automated disk rollover (completed 2026-09-24)
- [x] **Phase 4: Live View Grid & Mobile Streaming** - React multi-camera live grid (1x1, 2x2, 3x3), WebRTC (WHEP) with HLS fallback, and Coturn NAT traversal (completed 2026-09-24)
- [ ] **Phase 5: 24-Hour Playback & Timeline Scrubbing** - Visual 24-hour timeline scrubber, MediaMTX playback server queries, and frame-accurate seeking
- [ ] **Phase 6: ONVIF Motion Alerts & Real-Time Event Feed** - Native camera motion event subscriptions via Profile T PullPoint, event bus dispatch, and WebSocket alerts
- [ ] **Phase 7: Packaging, CI/SBOM & Single-Command Deployment** - Automated Docker installer (<30 min deployment), release SBOM generator, and license compliance verification

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

- [ ] 06-01: Implement ONVIF Profile T event listener service (PullPoint / BaseNotification) dispatching to Core event bus.
- [ ] 06-02: Build WebSocket live alert broadcast service and React real-time notification drawer/badge.

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

- [ ] 07-01: Create Docker Compose production deployment stack, setup script, and systemd service unit.
- [ ] 07-02: Implement CI SBOM generator, license compliance scanner, and power-loss recovery smoke tests.

---

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation, Licensing & Event Bus | 3/3 | Complete    | 2026-09-23 |
| 2. Media Plane & Camera Onboarding | 2/2 | Complete    | 2026-09-24 |
| 3. Recording Engine & Storage Management | 2/2 | Complete    | 2026-09-24 |
| 4. Live View Grid & Mobile Streaming | 2/2 | Complete    | 2026-09-24 |
| 5. 24-Hour Playback & Timeline Scrubbing | 2/2 | Complete    | 2026-09-24 |
| 6. ONVIF Motion Alerts & Real-Time Event Feed | 0/2 | Not started | - |
| 7. Packaging, CI/SBOM & Single-Command Deployment | 0/2 | Not started | - |
