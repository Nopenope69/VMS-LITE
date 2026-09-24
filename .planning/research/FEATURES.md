# Feature Research: Package 2 (Extended)

**Domain:** Commercial Video Management System (VMS) Extended Capabilities
**Researched:** 2026-09-24
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Commercial SMB & Society Expectations)

Features customers and security installers assume exist when moving up from basic standalone DVRs to a managed VMS.

| Feature | Why Expected | Complexity | Implementation Notes |
|---------|--------------|------------|----------------------|
| **Operator / Guard Role (EXT-01)** | Gated societies and commercial facilities employ guards who monitor live screens 24/7. Admins cannot let guards alter IP settings, delete cameras, or modify recording retention. | MEDIUM | 3-tier RBAC (`Admin`, `Operator`, `Viewer`) + `CameraPermission` ACL. Operators can view live feeds, scrub playback, control PTZ, and create bookmarks, but have zero configuration mutation rights. |
| **Motion Zones & Exclusion Masks (EXT-02)** | False positives from blowing tree branches, ceiling fans, or public highway traffic outside the boundary gate make alerts useless in Indian guard rooms. | MEDIUM | Interactive SVG/Canvas polygon editor in UI. Polygon vertices stored as normalized coordinates (0.0 to 1.0). Ingested motion coordinates filtered via Ray-Casting before raising alerts. |
| **PTZ Controls & Presets (EXT-03)** | Dome PTZ cameras on boundary walls or main gates require pan/tilt/zoom directional control and quick jump buttons to preset angles (e.g., "Visitor Gate", "Back Alley"). | MEDIUM | ONVIF Profile S PTZ service via `CameraProvider`. Directional pad (8 directions), zoom in/out, home position, preset list, and automated patrol cycle. |
| **Server-Side Clip Export (EXT-04)** | When an incident occurs (theft, vehicle damage), the facility manager must download an MP4 video clip to submit to police or society committees. | MEDIUM | Time-range scrubber selector, asynchronous background export job queue, and direct download endpoint with SHA-256 hash. |
| **Timeline Bookmarks (EXT-05)** | Operators need to flag significant incidents during their shift (e.g., "Suspicious vehicle parked at 02:15") so night/day shifts can hand over context. | LOW | Timeline visual bookmark pins, category tagging (Incident, Maintenance, Visitor), operator notes, and fast search. |

### Differentiators (Competitive Advantage over CP Plus / Hikvision DVRs)

Features that give Basic VMS Extended a decisive edge over traditional hardware NVRs.

| Feature | Value Proposition | Complexity | Implementation Notes |
|---------|-------------------|------------|----------------------|
| **Clip Burn-in Timestamp & Watermark (EXT-04b)** | Standard DVR exports often lack visible timestamps or camera names once shared on WhatsApp, causing dispute over authenticity. | MEDIUM | FFmpeg OSD filter burn-in: camera name, site identifier, and millisecond-accurate timestamp overlaid on exported MP4 without third-party proprietary video players. |
| **WhatsApp / SMS Incident Dispatch (EXT-07)** | Indian society management and factory owners do not monitor desktop VMS dashboards at night. Instant WhatsApp messages with snapshot links bridge this gap. | MEDIUM | Webhook dispatcher to Meta WhatsApp Cloud API or Twilio. Rate-limited (token bucket) to prevent spamming during continuous motion events. |
| **Camera Health & Ping Diagnostics (EXT-06)** | In large sites (16-32 cameras), camera power supply or PoE cable failures go unnoticed for days until an incident occurs and footage is missing. | LOW | Automated 30s heartbeat monitor combining TCP ping, RTSP OPTIONS checks, and MediaMTX path telemetry. Emits `camera.offline` / `camera.degraded` alerts immediately. |
| **External REST API & Outbound Webhooks (EXT-08)** | Enables integration with RFID barrier gates, biometric access control turnstiles, and fire alarm systems. | LOW | Standard HMAC-SHA256 signed HTTP webhooks (`X-BasicVMS-Signature`) fired on motion, camera state, or operator bookmark events. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Continuous Unbounded PTZ Movement Without Timeout** | Operators hold the directional arrow and expect the camera to move. | If browser network disconnects while holding the arrow, the camera keeps panning infinitely until mechanical limit or cable wrap. | Mandatory command watchdog timeout: Every `ContinuousMove` command auto-stops on the camera after 1500ms unless refreshed by keepalive. |
| **Full Transcoding on All Clip Exports** | Clean uniform framerates and resolutions across diverse camera brands. | Overheats low-cost 4-core NVR boxes and causes CPU starvation for live WebRTC streams. | "Fast Export" (packet copy `-c copy`, 0% CPU, 1-second completion) as default; re-encoding used only when timestamp OSD burn-in is explicitly toggled. |
| **Direct Browser-to-WhatsApp Pushes** | Avoid server-side queue implementation. | Exposes Meta/Twilio API keys to any browser client and bypasses security audit logs. | Centralized server-side rate-limited dispatch queue with audit trail in `events` catalog. |
| **Unbounded Clip Retention on Disk** | Users want exported clips preserved indefinitely. | Rapidly fills local NVMe/SATA storage disks, crashing recording engines. | Dedicated export cache directory with automatic FIFO pruning after 48 hours or when storage reaches 95%. |

---

## Feature Dependencies

```
[extended.operator_role]
    └──requires──> [core.rbac (Admin/Viewer)]
    └──governs───> [extended.ptz, extended.clip_export, extended.bookmarks]

[extended.ptz]
    └──requires──> [core.onvif (Profile S)]
    └──enhances──> [core.live]

[extended.motion_zones]
    └──requires──> [core.events (motion.detected)]
    └──filters───> [extended.whatsapp_alerts, extended.api_webhooks]

[extended.clip_export]
    └──requires──> [core.record (fMP4 segments), core.playback]
    └──enhances──> [extended.bookmarks]

[extended.camera_health]
    └──requires──> [core.events, MediaMTX /v3/paths/list]

[extended.whatsapp_alerts]
    └──requires──> [core.events, extended.motion_zones]

[extended.api_webhooks]
    └──requires──> [core.events]
```

---

## MVP Definition (Milestone v2.0 Scope)

### Launch With (v2.0 Extended)

- [ ] **EXT-01: Operator Role & Granular RBAC** — 3 roles (`ADMIN`, `OPERATOR`, `VIEWER`), per-camera view/control ACLs.
- [ ] **EXT-02: Motion Zones & Exclusion Masks** — Interactive SVG polygon drawing on camera tiles, coordinate filtering.
- [ ] **EXT-03: PTZ Control & Presets** — Virtual joystick pad, optical zoom, preset buttons, auto-stop watchdog.
- [ ] **EXT-04: Server-Side MP4 Clip Export** — Fast packet-copy export + optional timestamp/watermark OSD burn-in.
- [ ] **EXT-05: Timeline Bookmarks** — Operator incident notes, color-coded timeline pins, search and filtering.
- [ ] **EXT-06: Camera Health Diagnostics** — Automated ping and bitrate telemetry, offline/degraded alerts.
- [ ] **EXT-07: WhatsApp / SMS Alerts** — Cloud API webhook alerts for motion events with cooldown rate limiting.
- [ ] **EXT-08: REST API & Outbound Webhooks** — HMAC-SHA256 event notification webhooks for access control systems.

---

## Competitor Feature Analysis

| Capability | CP Plus Cosmic / Orange NVR | Hikvision iVMS-4200 | Basic VMS (Package 2 Extended) |
|---|---|---|---|
| **User Roles** | Basic Admin / User | Complex 100+ permission tree | Pragmatic 3-tier: Admin (all), Operator (monitor, PTZ, bookmarks, export), Viewer (monitor only). |
| **PTZ Controls** | Sluggish hardware jog-dial | Desktop client software PTZ | Low-latency WebRTC live stream with synchronized overlay joystick and 1.5s safety watchdog. |
| **Motion Masking** | 16x16 grid on camera NVR UI | Client-side grid mask | Smooth interactive vector polygon drawing (inclusion & exclusion zones). |
| **Clip Export** | Proprietary `.dav` / `.h264` player required | MP4 with proprietary watermark utility | Universal MP4 playable in any browser or phone with burned-in OSD timestamp. |
| **Incident Dispatch** | Email / Buzzer only | Push notifications to Hik-Connect app | Direct WhatsApp messages to security/society groups with zero app download needed. |
