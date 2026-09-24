# Basic VMS

## What This Is

Basic VMS is a purpose-built video management system targeting the Indian SMB and residential CCTV market (the CP Plus and Hikvision DVR-equivalent tier). It provides a reliable, lightweight core feature set — live view, continuous/scheduled recording, playback, native motion alerts, and mobile remote view — deployable on-site in under 30 minutes by an installer. It is a distinct product from VigilOne, designed from day one with entitlement-gated packaging (Package 1 Core, Package 2 Extended, Package 3 AI) on a single codebase.

## Core Value

Sub-30-minute installer deployment with reliable CP Plus parity (live view, scheduled recording, 24h timeline playback, native ONVIF motion alerts) built on permissively licensed infrastructure (MediaMTX) with zero VigilOne domain entanglement.

## Current Milestone: v2.0 Package 2 (Extended)

**Goal:** Expand Basic VMS with commercial operator controls, camera PTZ, motion zone masking, clip export with OSD watermark, timeline bookmarks, stream health telemetry, WhatsApp alerts, and external integration webhooks under an entitlement-gated Extended license.

**Target features:**
- Operator Role & Granular RBAC (`extended.operator_role`, EXT-01)
- Motion Zones & Exclusion Masks (`extended.motion_zones`, EXT-02)
- PTZ Controls & Camera Presets (`extended.ptz`, EXT-03)
- Server-side MP4 Clip Export with OSD Watermark (`extended.clip_export`, EXT-04)
- Timeline Bookmarks & Audit Annotations (`extended.bookmarks`, EXT-05)
- Camera Health Diagnostics & Telemetry (`extended.camera_health`, EXT-06)
- WhatsApp / SMS Incident Alerting (`extended.whatsapp_alerts`, EXT-07)
- Outgoing REST API & Webhooks (`extended.api_webhooks`, EXT-08)

## Requirements

### Validated

- [x] **CORE-RBAC**: 2-role RBAC (Admin, Viewer) for single-site installation (Validated in Phase 1)
- [x] **CORE-EVT**: Extensible Core event bus and unified Event schema (`camera.offline/online`, `recording.started/stopped`, `storage.warning/full`, `motion.detected`) (Validated in Phase 1)
- [x] **CORE-LIC**: Ed25519 offline license verification and capability registry (`capabilities.has(...)`) gating route namespaces and modules (Validated in Phase 1)
- [x] **CORE-ONVIF**: ONVIF discovery and onboarding (Profile T primary with Profile S fallback) via an internal `CameraProvider` adapter over a pinned ONVIF client library (Validated in Phase 2)
- [x] **CORE-LIVE**: Live multi-camera view via WebRTC with HLS fallback served by MediaMTX (Validated in Phase 4)
- [x] **CORE-REC**: Continuous and scheduled recording via MediaMTX segment recording and record-complete hooks populating the catalog (Validated in Phase 3)
- [x] **CORE-PLAY**: Playback with 24h timeline scrubbing using MediaMTX's playback server (`/list`, `/get` fMP4/MP4) (Validated in Phase 5)
- [x] **CORE-ALERT**: Motion alerts sourced from ONVIF Profile T native motion/tampering events emitted through the Core event bus (Validated in Phase 6)
- [x] **CORE-STOR**: Local disk retention policy with automatic rollover and storage warning/full events (Validated in Phase 3)
- [x] **CORE-INST**: Single-command installer achieving <30-minute deployment on customer hardware (Validated in Phase 7)
- [x] **CORE-REMOTE**: Mobile remote view support (WebRTC via STUN/relay/coturn for NAT traversal) (Validated in Phase 4)
- [x] **CORE-COMP**: Automated SBOM and license inventory generation (`third_party/licenses/`, `third_party/notices/`) in CI (Validated in Phase 7)

### Active (Package 2: Extended)

- [ ] **EXT-01**: Operator role with granular per-camera permissions
- [ ] **EXT-02**: Motion zones and exclusion masks
- [ ] **EXT-03**: PTZ control and camera presets via ONVIF Profile S
- [ ] **EXT-04**: Server-side MP4 clip export with timestamp OSD & watermark
- [ ] **EXT-05**: Timeline bookmarks and annotations
- [ ] **EXT-06**: Camera health monitoring and latency diagnostics
- [ ] **EXT-07**: WhatsApp and SMS alert dispatch channels
- [ ] **EXT-08**: Basic external REST API and outgoing webhooks

### Out of Scope

- **Multi-tenant hierarchy** — Two/three roles cover single-site SMBs; multi-tenancy adds unnecessary operational and schema complexity.
- **Evidentiary export (Section 63 BSA chain-of-custody)** — Differentiator for VigilOne enterprise compliance tier; basic MP4 clip export with OSD watermark is provided in Package 2.
- **Computer vision / AI detection in Package 2** — Deferred to Package 3; Package 2 retains lightweight CPU footprint.
- **Multi-site federation** — Standalone site deployment focus; cloud sync deferred.
- **Cloud/offsite archiving** — Local disk storage matches CP Plus baseline; cloud sync deferred.

## Context

- **Target Market**: Indian SMB and residential CCTV tier dominated by CP Plus and budget DVR/NVR vendors.
- **Positioning**: Separate product from VigilOne, not a stripped-down fork. Fresh repository, fresh schema, fresh API, and fresh UI.
- **Media Plane**: MediaMTX (MIT) handles RTSP ingest, WebRTC/HLS live streaming, segment recording, and playback queries. The Node control plane manages metadata, policies, and auth without custom video encoding/decoding.
- **Camera Protocol**: Pinned ONVIF client library (e.g., `agsh/onvif`, MIT) behind a `CameraProvider` interface for vendor decoupling.
- **Licensing Model**: Reuses VigilOne's Ed25519 offline signature verification and license schema, isolated into a standalone clean-room library without tenant or BSA baggage.
- **Security Prerequisite**: Git history audit of prior repos (`Nopenope69/vms`) to ensure no leaked keys, secrets, or proprietary SOPs before publication.

## Constraints

- **Tech Stack**: Node/TypeScript backend, React frontend, PostgreSQL database, MediaMTX media server.
- **Licensing Clean Boundary**: License checks resolve at boot to capabilities (`capabilities.has(...)`). Modules isolate behind route namespaces and conditional bundles. Never scatter plan checks in domain logic.
- **Dependency Licensing**: Permissively licensed components only (MIT, Apache-2.0). Every build must classify and inventory third-party licenses.
- **Performance**: Zero-transcode / packet-preserving recording to minimize CPU consumption on budget host machines.
- **Setup Time**: Installer must enable live view on customer hardware in under 30 minutes.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| MediaMTX as media plane | MIT licensed, provides RTSP ingest, WebRTC, segment recording, and playback server out-of-the-box | ✓ Validated in Phase 2 |
| Clean-room repo & schema | Avoids inheriting VigilOne complexity, git history secrets risk, and multi-tenant overhead | ✓ Validated in Phase 1 |
| ONVIF Profile T + S via `CameraProvider` adapter | Broad compatibility across Hikvision, Dahua, CP Plus, Prama without vendor lock-in | ✓ Validated in Phase 2 |
| Capability registry over plan checks | Prevents tier checks from polluting controllers and UI; enables clean Package 1/2/3 modularity | ✓ Validated in Phase 1 |
| Generic event framework in Core | Allows future Package 3 AI detections to act as regular bus producers without schema rewrites | ✓ Validated in Phase 1 |
| Native ONVIF motion events in v1 | Delivers motion detection without heavy computer vision runtimes or CPU overhead | ✓ Validated in Phase 6 |
| Packaging & single-command deployment | Docker Compose bundle with Coturn and MediaMTX under 30-min setup constraint | ✓ Validated in Phase 7 |
| Deep `RecordingEngine` module | Collapsed 3 shallow singletons into single public seam with injected `IClock` and deterministic FIFO | ✓ Validated in Arch Review |
| Playback catalog absorption | Absorbed timeline spans and fMP4 URL generation directly into catalog, retiring `PlaybackService` | ✓ Validated in Arch Review |
| Unified camera device & event lifecycle | Bridged `cameraService` and `OnvifEventListenerService` via `EventBus` (`camera.online`/`offline`/`deleted`) | ✓ Validated in Arch Review |
| Inlined ephemeral ICE generation | Eliminated shallow wrapper `IceServerService` by inlining RFC 5766 HMAC in routes | ✓ Validated in Arch Review |
| Headless frontend playback session | Encapsulated 11 state variables and scrubber arithmetic into `usePlaybackSession` hook | ✓ Validated in Arch Review |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-24 after Milestone v1.0 completion & Architecture Deepening*
