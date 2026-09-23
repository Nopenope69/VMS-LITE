# Pitfalls Research

**Domain:** Video Management System (VMS) — SMB/Residential CCTV Tier (CP Plus / Hikvision DVR equivalent)
**Researched:** 2026-09-24
**Confidence:** HIGH

## Critical Pitfalls

### 1. VigilOne Repo Git History & Secret Contamination
- **Warning Signs:** Reusing or branching from the existing `Nopenope69/vms` repository.
- **Why It Happens:** Convenience of copying existing code or retaining branch history.
- **Risk:** The previous repository may contain unrotated private keys, Ed25519 signing keys, camera credentials, internal hostnames, or proprietary contracts embedded in early git commits.
- **Prevention:** Work in a completely fresh repository (`basic-vms` / `VMS-Bare`) with a fresh git commit history. The licensing library must be extracted as a standalone package (`vms-licensing`) with zero VigilOne domain references.

### 2. Tier & License Checks Polluting the Domain Model
- **Warning Signs:** `if (user.plan === 'PRO')` or `if (tier === 'PACKAGE_1')` found in controllers, services, or UI components.
- **Why It Happens:** Quick hacks to restrict features.
- **Risk:** Tightly couples business pricing logic with core functionality, making refactoring or repackaging impossible.
- **Prevention:** Strict separation: License → Entitlements → Capability Registry → Module Mounting. The domain and UI only query `capabilities.has("ptz")`.

### 3. Re-implementing Video Ingest, Transcoding, or Playback in Node
- **Warning Signs:** Writing custom FFmpeg child-processes or building an RTSP-to-WebRTC converter inside Node.
- **Why It Happens:** Engineers attempting to manage media packets directly in JavaScript.
- **Risk:** High CPU utilization, event loop starvation, memory leaks, out-of-sync audio/video, and crashing the control plane.
- **Prevention:** MediaMTX is the authoritative media plane. Node only orchestrates configuration, hooks, and metadata. Video packets never pass through Node.js memory.

### 4. Overcomplicating Storage Management & Custom Chunking
- **Warning Signs:** Writing custom file chunkers or trying to split video streams by raw byte counting.
- **Why It Happens:** Not leveraging MediaMTX's native recording hooks.
- **Risk:** Broken MP4 container headers (moov atom corruption), unplayable video clips upon power outage.
- **Prevention:** Rely on MediaMTX's fMP4 segment recording and `runOnRecordSegmentComplete` hook. Fragmented MP4 (fMP4) is resilient against sudden power cuts because each segment is self-contained.

### 5. Vendor Coupling in ONVIF Integration
- **Warning Signs:** Direct calls to specific camera XML endpoints or hardcoding CP Plus/Hikvision quirks into controller actions.
- **Why It Happens:** Dealing with camera firmware bugs as one-off workarounds.
- **Risk:** Breaking compatibility when onboarding Dahua or generic ONVIF cameras.
- **Prevention:** Wrap all ONVIF operations behind an internal `CameraProvider` interface. The core application interacts only with `CameraProvider.discover()`, `CameraProvider.getStreamUri()`, and `CameraProvider.subscribeEvents()`.

### 6. Copyleft / GPL License Infiltration
- **Warning Signs:** Importing ZoneMinder, Shinobi, or other GPL/custom-licensed VMS source code or libraries directly.
- **Why It Happens:** Copying code snippets found online during development.
- **Risk:** Tainting the commercial IP of the product and legal breach.
- **Prevention:** Permissively licensed dependencies only (MIT / Apache-2.0). Automated license audit (Syft/license-checker) in CI fails the build on non-permissive licenses.

---
*Pitfalls research for: Basic VMS*
*Researched: 2026-09-24*
