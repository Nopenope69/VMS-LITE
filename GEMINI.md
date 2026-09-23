<!-- GSD:project-start source:PROJECT.md -->

## Project

**Basic VMS**

Basic VMS is a purpose-built video management system targeting the Indian SMB and residential CCTV market (the CP Plus and Hikvision DVR-equivalent tier). It provides a reliable, lightweight core feature set — live view, continuous/scheduled recording, playback, native motion alerts, and mobile remote view — deployable on-site in under 30 minutes by an installer. It is a distinct product from VigilOne, designed from day one with entitlement-gated packaging (Package 1 Core, Package 2 Extended, Package 3 AI) on a single codebase.

**Core Value:** Sub-30-minute installer deployment with reliable CP Plus parity (live view, scheduled recording, 24h timeline playback, native ONVIF motion alerts) built on permissively licensed infrastructure (MediaMTX) with zero VigilOne domain entanglement.

### Constraints

- **Tech Stack**: Node/TypeScript backend, React frontend, PostgreSQL database, MediaMTX media server.
- **Licensing Clean Boundary**: License checks resolve at boot to capabilities (`capabilities.has(...)`). Modules isolate behind route namespaces and conditional bundles. Never scatter plan checks in domain logic.
- **Dependency Licensing**: Permissively licensed components only (MIT, Apache-2.0). Every build must classify and inventory third-party licenses.
- **Performance**: Zero-transcode / packet-preserving recording to minimize CPU consumption on budget host machines.
- **Setup Time**: Installer must enable live view on customer hardware in under 30 minutes.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

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

# Core Dependencies

# Dev Dependencies

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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.agent/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
