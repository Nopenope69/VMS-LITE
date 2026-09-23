# Basic VMS

## What This Is

Basic VMS is a purpose-built video management system targeting the Indian SMB and residential CCTV market (the CP Plus and Hikvision DVR-equivalent tier). It provides a reliable, lightweight core feature set — live view, continuous/scheduled recording, playback, native motion alerts, and mobile remote view — deployable on-site in under 30 minutes by an installer. It is a distinct product from VigilOne, designed from day one with entitlement-gated packaging (Package 1 Core, Package 2 Extended, Package 3 AI) on a single codebase.

## Core Value

Sub-30-minute installer deployment with reliable CP Plus parity (live view, scheduled recording, 24h timeline playback, native ONVIF motion alerts) built on permissively licensed infrastructure (MediaMTX) with zero VigilOne domain entanglement.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **CORE-LIVE**: Live multi-camera view via WebRTC with HLS fallback served by MediaMTX
- [ ] **CORE-REC**: Continuous and scheduled recording via MediaMTX segment recording and record-complete hooks populating the catalog
- [ ] **CORE-PLAY**: Playback with 24h timeline scrubbing using MediaMTX's playback server (`/list`, `/get` fMP4/MP4)
- [ ] **CORE-ALERT**: Motion alerts sourced from ONVIF Profile T native motion/tampering events emitted through the Core event bus
- [ ] **CORE-ONVIF**: ONVIF discovery and onboarding (Profile T primary with Profile S fallback) via an internal `CameraProvider` adapter over a pinned ONVIF client library
- [ ] **CORE-RBAC**: 2-role RBAC (Admin, Viewer) for single-site installation
- [ ] **CORE-STOR**: Local disk retention policy with automatic rollover and storage warning/full events
- [ ] **CORE-INST**: Single-command installer achieving <30-minute deployment on customer hardware
- [ ] **CORE-REMOTE**: Mobile remote view support (WebRTC via STUN/relay/coturn for NAT traversal)
- [ ] **CORE-EVT**: Extensible Core event bus and unified Event schema (`camera.offline/online`, `recording.started/stopped`, `storage.warning/full`, `motion.detected`)
- [ ] **CORE-LIC**: Ed25519 offline license verification and capability registry (`capabilities.has(...)`) gating route namespaces and modules
- [ ] **CORE-COMP**: Automated SBOM and license inventory generation (`third_party/licenses/`, `third_party/notices/`) in CI

### Out of Scope

- **Multi-tenant hierarchy** — Two roles (Admin, Viewer) cover this market; multi-tenancy adds unnecessary operational and schema complexity.
- **Evidentiary export (Section 63 BSA chain-of-custody)** — Differentiator for VigilOne enterprise compliance tier; basic MP4 clip export is deferred to Package 2.
- **Computer vision / AI detection in Package 1** — Deferred to Package 3; Package 1 ships with zero AI dependencies to keep the base install lightweight and OSS licenses clean.
- **Multi-site federation** — Real distributed-systems overhead (WAN auth, sync, clock skew) not suited for budget standalone NVR/DVR tier; scope separately if demanded.
- **Cloud/offsite archiving** — Local disk storage only for v1, matching standard CP Plus/Hikvision DVR expectations.
- **Operator role, motion zones, masks, PTZ, bookmarks, WhatsApp/SMS alerts** — Scoped as Package 2 (Extended).

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
| MediaMTX as media plane | MIT licensed, provides RTSP ingest, WebRTC, segment recording, and playback server out-of-the-box | — Pending |
| Clean-room repo & schema | Avoids inheriting VigilOne complexity, git history secrets risk, and multi-tenant overhead | — Pending |
| ONVIF Profile T + S via `CameraProvider` adapter | Broad compatibility across Hikvision, Dahua, CP Plus, Prama without vendor lock-in | — Pending |
| Capability registry over plan checks | Prevents tier checks from polluting controllers and UI; enables clean Package 1/2/3 modularity | — Pending |
| Generic event framework in Core | Allows future Package 3 AI detections to act as regular bus producers without schema rewrites | — Pending |
| Native ONVIF motion events in v1 | Delivers motion detection without heavy computer vision runtimes or CPU overhead | — Pending |

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
*Last updated: 2026-09-24 after initialization*
