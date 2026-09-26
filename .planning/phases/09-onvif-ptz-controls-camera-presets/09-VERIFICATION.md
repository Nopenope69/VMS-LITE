---
phase: 09-onvif-ptz-controls-camera-presets
verified: 2026-09-24T22:36:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 9: ONVIF PTZ Controls & Camera Presets Verification Report

**Phase Goal:** Implement ONVIF Profile S PTZ service in `CameraProvider`, REST endpoints gated by `extended.ptz`, virtual joystick UI overlay on live camera tiles, preset management, and a 1.5s server-side watchdog auto-stop.  
**Verified:** 2026-09-24  
**Status:** passed  

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `ICameraProvider` supports `ptzMove`, `ptzStop`, `getPresets`, `gotoPreset`, `setPreset`, `removePreset` | ✓ VERIFIED | `src/cameras/camera-provider.interface.ts` and `src/cameras/onvif.provider.ts` |
| 2 | PTZ movement commands without `extended.ptz` license capability return 403 Forbidden | ✓ VERIFIED | Tested in `tests/ptz.test.ts` (returns 403 when capability is absent) |
| 3 | Operator access to PTZ is gated by per-camera `canControlPtz` ACL permission | ✓ VERIFIED | Tested in `tests/ptz.test.ts` (200 with permission, 403 without) |
| 4 | Server-side safety watchdog halts camera movement after 1500ms timeout | ✓ VERIFIED | Tested in `tests/ptz.test.ts` using Vitest fake timers (`vi.advanceTimersByTimeAsync(1500)`) |
| 5 | Subsequent move commands reset the watchdog timer window | ✓ VERIFIED | Tested in `tests/ptz.test.ts` |
| 6 | Presets can be listed, recalled, created (Admin only), and deleted | ✓ VERIFIED | Tested in `tests/ptz.test.ts` |
| 7 | React UI renders 8-directional virtual D-Pad, zoom controls, preset picker, and keyboard shortcuts | ✓ VERIFIED | Built in `client/src/components/PtzControlsOverlay.tsx` and integrated in `LiveCameraTile.tsx` and `LiveGrid.tsx` |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/cameras/camera-provider.interface.ts` | PTZ contracts on ICameraProvider | ✓ VERIFIED | Contains `ptzMove`, `ptzStop`, `getPresets`, `gotoPreset`, `setPreset`, `removePreset` |
| `src/cameras/onvif.provider.ts` | ONVIF Profile S PTZ implementation | ✓ VERIFIED | Wraps `node-onvif`'s PTZ service with mock mode support |
| `src/ptz/ptz.service.ts` | Watchdog auto-stop & preset management | ✓ VERIFIED | 1500ms timer safety watchdog per camera (Threat T-09-01) |
| `src/ptz/ptz.routes.ts` | Capability-gated REST API endpoints | ✓ VERIFIED | `/api/cameras/:id/ptz` with `requireCapability('extended.ptz')` |
| `tests/ptz.test.ts` | Unit and integration test suite | ✓ VERIFIED | 13/13 tests passing |
| `client/src/components/PtzControlsOverlay.tsx` | Virtual D-Pad & HUD overlay | ✓ VERIFIED | Palette 1 styling, pointerdown/up bindings, preset quick-pills, tour runner |
| `client/src/components/LiveCameraTile.tsx` | Tile header PTZ trigger | ✓ VERIFIED | `<Compass>` toggle icon and overlay mounting |

### Test Verification Results

- `tests/ptz.test.ts`: **13 passed (13 total)**
- `npx tsc --project client/tsconfig.json`: **0 errors**
- `npx tsc --noEmit`: **0 errors**

---
*Verified against Phase 9 criteria and requirement EXT-03.*
