# Feature Research

**Domain:** Video Management System (VMS) — SMB/Residential CCTV Tier (CP Plus / Hikvision DVR equivalent)
**Researched:** 2026-09-24
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in budget DVR/NVR hardware (CP Plus, Hikvision, Dahua). Missing these = installer rejection.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-Camera Live View | Monitor premises live in 1x1, 2x2, 3x3 grids | MEDIUM | Low-latency WebRTC primary, HLS fallback via MediaMTX. |
| Continuous & Scheduled Recording | 24/7 or time-based footage retention | MEDIUM | MediaMTX segment recording with metadata catalog in Postgres. |
| 24h Playback Timeline & Scrubbing | Review past events and footage instantly | MEDIUM | MediaMTX playback server (`/list`, `/get`), synced to visual timeline. |
| Motion Alerts | Notification when movement occurs | LOW | ONVIF Profile T native motion events emitted through Core event bus. |
| ONVIF Auto-Discovery & Onboarding | Plug-and-play detection of IP cameras | MEDIUM | Profile T with S fallback via `CameraProvider` adapter. |
| 2-Role RBAC (Admin, Viewer) | Owner vs family/staff permissions | LOW | Admin full access; Viewer restricted to live/playback without settings. |
| Local Disk Retention & Rollover | Never fail when hard drive fills up | MEDIUM | Automatic deletion of oldest recorded segments when threshold reached. |
| Single-Command Deployment | Fast setup by integrators on customer hardware | MEDIUM | Complete install in under 30 minutes via automated script/container. |
| Mobile Remote View | Access cameras outside local LAN | MEDIUM | WebRTC through STUN/relay/Coturn. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Entitlement-Gated Modular Core | Single codebase allows instant upsell (P1 → P2/P3) via offline license key without re-install | MEDIUM | Capability registry (`capabilities.has(...)`) gates modules cleanly. |
| Generic Extensible Event Bus | Unified event schema handles system events in P1 and seamless AI detections in P3 | LOW | Event schema: id, camera_id, timestamp, type, source, severity, metadata. |
| 100% Permissive Open Source Stack | Clean IP, no GPL contamination, no proprietary vendor cloud lock-in | LOW | MediaMTX (MIT), permissive ONVIF, strict SBOM in CI. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Multi-tenant organization hierarchy | "What if an installer manages 50 clients?" | Multi-tenancy introduces massive schema complexity and auth friction unneeded for standalone NVRs. | Single-site deployment; scope federation separately if required. |
| Computer Vision motion detection in base install | "Software motion detection from RTSP" | Consumes massive CPU decoding video streams; blows hardware specs for cheap NVRs. | Use camera-native ONVIF Profile T motion events in Package 1; defer AI to Package 3. |
| Evidentiary Export / BSA Certification | "Legal proof of footage" | VigilOne compliance differentiator; requires complex hash chains and legal certificates. | Basic MP4 clip export in Package 2. |
| Custom Media Transcoding Pipeline | "Re-encode to save bandwidth" | Burning CPU transcoding video drops frames on budget hosts. | MediaMTX zero-transcode packet-preserving storage. |

## Feature Dependencies

```
[MediaMTX Setup]
    └──requires──> [Local Storage & Directory Layout]
[Recording Catalog]
    └──requires──> [MediaMTX Record Hooks]
[Playback Timeline]
    └──requires──> [Recording Catalog] & [MediaMTX Playback Server]
[Motion Alerts]
    └──requires──> [Core Event Bus] & [ONVIF Event Subscription]
[Live View Grid]
    └──requires──> [MediaMTX WebRTC Stream Engine]
[Role RBAC]
    └──requires──> [User Auth & Session Management]
[Package Gating]
    └──requires──> [Ed25519 Capability Registry]
```

## MVP Definition (Package 1: Core)

### Launch With (Package 1)

- [ ] **CORE-LIVE**: Live multi-camera WebRTC view with HLS fallback
- [ ] **CORE-REC**: Continuous & scheduled recording via MediaMTX segment hooks
- [ ] **CORE-PLAY**: 24h playback timeline scrubbing
- [ ] **CORE-ALERT**: Native ONVIF motion alerts via Core event bus
- [ ] **CORE-ONVIF**: ONVIF discovery & onboarding (Profile T / S)
- [ ] **CORE-RBAC**: 2-role RBAC (Admin, Viewer)
- [ ] **CORE-STOR**: Local retention policy with automatic rollover
- [ ] **CORE-INST**: Single-command installer (<30 min setup)
- [ ] **CORE-REMOTE**: Mobile remote viewing with WebRTC relay
- [ ] **CORE-EVT**: Unified Core event bus
- [ ] **CORE-LIC**: Standalone Ed25519 capability registry

### Add in Package 2 (Extended - Fast Follow)

- Operator role with per-camera permissions
- Motion zones and exclusion masks
- PTZ control and presets
- Basic MP4 clip export
- Bookmarks
- Camera health monitoring
- WhatsApp / SMS alerts
- Basic REST API & webhooks

### Future Consideration (Package 3 - AI)

- Object/person detection (ONNX Runtime / OpenVINO)
- Smart search by object type
- ANPR (Automatic Number Plate Recognition)
- Face / watchlist matching

---
*Feature research for: Basic VMS*
*Researched: 2026-09-24*
