# Research Summary: Basic VMS

**Domain:** Video Management System (VMS) — SMB/Residential CCTV Tier (CP Plus / Hikvision DVR equivalent)
**Synthesized:** 2026-09-24
**Confidence:** HIGH

## Executive Summary

Basic VMS is a standalone, lightweight, commercial-grade VMS engineered to replace CP Plus / Hikvision hardware DVRs in the Indian SMB and residential market. To meet the aggressive sub-30-minute deployment requirement on budget hardware, the architecture splits strictly into a permissive, high-performance media plane (MediaMTX) and a lightweight Node/TypeScript control plane backed by PostgreSQL and React. 

The product is clean-room engineered in a fresh repository (`VMS-Bare`) to eliminate any IP or secret contamination from VigilOne. Modular packaging (Package 1 Core, Package 2 Extended, Package 3 AI) is enforced via an offline Ed25519 Capability Registry rather than hardcoded tier checks.

## Key Recommendations

### Stack
- **Control Plane:** Node.js 20 LTS, TypeScript 5, Fastify, Prisma/PostgreSQL, React 18, Vite.
- **Media Plane:** MediaMTX v1.11+ (MIT) handling RTSP ingest, WebRTC (WHEP) live streaming, HLS fallback, fMP4 segment recording, and playback server.
- **Protocols & Licensing:** Pinned ONVIF library behind internal `CameraProvider` adapter; `@noble/ed25519` for offline license signature verification.

### Table Stakes Features (Package 1 Core)
- Live multi-camera WebRTC grid with HLS fallback.
- Continuous and scheduled recording via MediaMTX segment hooks into PostgreSQL catalog.
- 24-hour timeline playback with rapid scrubbing via MediaMTX playback server.
- Native ONVIF Profile T motion/tampering events dispatched through Core event bus.
- Auto-discovery and onboarding of CP Plus, Hikvision, Dahua, and generic ONVIF cameras.
- 2-role RBAC (Admin, Viewer) for single-site management.
- Disk retention policy with automated rollover.
- Single-command installer enabling complete site deployment in < 30 minutes.

### Architecture Guidelines
- **Media Separation:** Node never handles video streams or packet decoding; all video flows through MediaMTX directly.
- **Licensing Clean Boundary:** License → Entitlements → Capability Registry (`capabilities.has(...)`). Modules and route namespaces mount conditionally.
- **Event Bus:** Core event bus (`events` table) standardizes `camera.offline/online`, `recording.started/stopped`, `storage.warning/full`, and `motion.detected`. AI detections in Package 3 will publish directly into this bus as standard events.

### Critical Pitfalls to Avoid
- Never branch from or copy `Nopenope69/vms` history; keep the repo and schema clean-room.
- Never write plan/tier checks in business logic or controllers.
- Never re-encode or transcode video streams in v1; utilize packet-preserving fMP4 recording to preserve CPU on budget NVR hosts.
- Never pull in GPL/copyleft libraries. Enforce automated license audits in CI.

---
*Synthesized from: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md*
