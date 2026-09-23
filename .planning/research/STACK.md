# Stack Research

**Domain:** Video Management System (VMS) — SMB/Residential CCTV Tier (CP Plus / Hikvision DVR equivalent)
**Researched:** 2026-09-24
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js / TypeScript | v20+ LTS / TS 5.x | Control plane runtime | Type safety, rapid integration with ecosystem, shared developer familiarity with VigilOne without sharing IP/code. |
| MediaMTX | v1.11+ | Media plane server | MIT licensed. Authoritative RTSP ingest, WebRTC (Whip/Whep), HLS live streaming, packet-preserving segment recording, and playback server with `/list` and `/get` fMP4 endpoints. No custom video encoder/decoder required. |
| PostgreSQL | 16+ | Application & metadata catalog | Robust relational storage for camera configs, recording segment catalog, events bus logs, and user auth. |
| React | 18+ / Vite | Web frontend UI | Responsive, fast desktop/mobile web UI for multi-camera live grid, 24h timeline playback scrubber, and alert stream. |
| `agsh/onvif` (or `@camstream/onvif`) | Pinned (MIT) | ONVIF client adapter | Mature, actively tested ONVIF Profile T/S client library. Wrapped strictly behind internal `CameraProvider` interface. |
| `@noble/ed25519` | 2.x (MIT) | Offline license signature verification | Cryptographically secure, dependency-free Ed25519 verification for offline node entitlement. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Fastify or Express | 4.x / 5.x | REST API & WebSockets | HTTP control plane, camera management, event notification streaming. |
| Prisma / Kysely | Latest | Database ORM / Query builder | Type-safe migrations and queries for clean-room minimal schema. |
| Zod | 3.x | Schema validation | Validating license tokens, camera network schemas, and event bus payloads. |
| Lucide React | Latest | UI icons | Lightweight, consistent UI icons for CCTV control. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Docker & Docker Compose | Containerized local & site deployment | Bundles Node control plane, MediaMTX, Postgres, and Coturn into single command. |
| Coturn | STUN/TURN server | WebRTC NAT traversal for mobile remote view outside local LAN. |
| Syft / License-Checker | Automated SBOM & License auditing in CI | Validates 100% permissive licenses (MIT/Apache) and generates release inventory. |

## Installation

```bash
# Core Dependencies
npm install fastify @noble/ed25519 zod pg
npm install @camstream/onvif # or agsh/onvif

# Dev Dependencies
npm install -D typescript @types/node tsx vite prisma
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| MediaMTX | Custom GStreamer / FFmpeg pipeline | Only if custom on-the-fly video transcoding or DSP overlays were mandatory in v1 (they are not). |
| Native ONVIF Events (Profile T) | OpenCV / Computer Vision motion detection | Package 3 AI tier; avoid in Package 1 to eliminate heavyweight C++ dependencies and CPU overhead. |
| PostgreSQL | SQLite | Only for ultra-constrained embedded flash storage (<512MB RAM); Postgres chosen for concurrent recording catalog inserts and event queries. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| VigilOne codebase / Prisma schema | Contains compliance-grade multi-tenancy, BSA chain-of-custody, and leaked credential risks. | Fresh, minimal schema and clean-room repository. |
| Custom H.264/H.265 Transcoder | High CPU usage on low-cost NVR boxes, causes dropped frames. | MediaMTX zero-decode packet-preserving segmenting. |
| Copyleft / GPL libraries (GPL-2/3) | Violates permissive licensing architecture and distribution requirements. | Permissively licensed alternatives (MIT, Apache-2.0). |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| MediaMTX v1.x | WebRTC / HLS / RTSP | Native support for fMP4 recording segments and `/list` query. |
| Node.js 20 LTS | `@noble/ed25519` v2.x | Native WebCrypto support. |

---
*Stack research for: Basic VMS*
*Researched: 2026-09-24*
