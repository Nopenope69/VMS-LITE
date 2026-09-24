---
phase: 02-media-plane-camera-onboarding
reviewed: 2026-09-24T06:05:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - prisma/schema.prisma
  - src/mediamtx/mediamtx.types.ts
  - src/mediamtx/mediamtx.client.ts
  - src/cameras/camera-provider.interface.ts
  - src/cameras/onvif.provider.ts
  - src/types/node-onvif.d.ts
  - src/cameras/camera.types.ts
  - src/cameras/camera.service.ts
  - src/cameras/camera.routes.ts
  - src/server.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: clean
---

# Phase 2: Code Review Report

**Reviewed:** 2026-09-24T06:05:00Z  
**Depth:** standard  
**Files Reviewed:** 10  
**Status:** clean  

## Summary

Code review was conducted on all source files created and updated during Phase 2: Media Plane & Camera Onboarding.
All Phase 2 requirements (CAM-01 through CAM-05) have been implemented cleanly with zero VigilOne code entanglement:
1. `CameraProvider` interface completely encapsulates ONVIF SOAP operations and prevents vendor library symbols from leaking into domain controllers (CAM-04).
2. `OnvifCameraProvider` supports WS-Discovery UDP multicast scanning (CAM-01) and sorts multi-stream profiles to identify Main Stream vs Sub Stream with Profile T priority and Profile S fallback (CAM-02).
3. `MediaMtxClient` synchronizes RTSP streams dynamically into MediaMTX via the v3 Control REST API without disruptive server reboots or file regenerations (CAM-05).
4. `CameraService` cleanly handles manual RTSP stream additions (CAM-03) and enforces the single-site offline license camera limit (`capabilities.getCameraLimit()`), throwing `LicenseLimitExceededError` and returning 403 when the limit is breached (T-02-04).
5. All mutating REST endpoints are guarded with `requireRole([Role.ADMIN])` (T-02-05), and sensitive camera passwords are stripped from all API outputs via `CameraResponseDto` (T-02-06).

All 52 tests pass, and TypeScript builds cleanly without errors.

## Critical Issues

None.

## Warnings

### WR-01: Plaintext Password Storage in Camera Model

**File:** `prisma/schema.prisma:50`, `src/cameras/camera.service.ts:95`  
**Issue:** Camera device passwords are stored in plaintext in the `cameras` database table. While passwords are never returned in API responses (DTO omits them), a database compromise would expose camera administrative passwords.  
**Fix:** In a future phase or hardening pass, encrypt camera credentials at rest using AES-256-GCM keyed by the local node secret.

## Info

### IN-01: UDP Multicast Binding on Multi-Interface Hosts

**File:** `src/cameras/onvif.provider.ts:47`  
**Issue:** `node-onvif.startProbe()` uses default UDP multicast sockets. On machines with multiple network interfaces (e.g. Docker bridges, VPNs), multicast probes may exit via the wrong interface.  
**Fix:** Manual RTSP onboarding (`CAM-03`) and manual IP/port targeting provide an immediate fallback when multicast is blocked by host networking.

---

_Reviewed: 2026-09-24T06:05:00Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
