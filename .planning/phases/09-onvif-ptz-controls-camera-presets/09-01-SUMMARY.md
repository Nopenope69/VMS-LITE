---
phase: 09-onvif-ptz-controls-camera-presets
plan: 01
subsystem: ptz-control
tags: [ptz, onvif, watchdog, presets, capability-gating, rbac]

# Dependency graph
requires:
  - phase: 02-media-plane-camera-onboarding
    provides: ICameraProvider interface and OnvifCameraProvider adapter
  - phase: 08-operator-role-granular-rbac
    provides: requireCameraPermission('canControlPtz') hook
provides:
  - ICameraProvider PTZ contracts (ptzMove, ptzStop, getPresets, gotoPreset, setPreset, removePreset)
  - PtzService with 1500ms safety watchdog auto-stop (Threat T-09-01)
  - /api/cameras/:id/ptz routes gated by extended.ptz and canControlPtz
  - Unit and integration test suite in tests/ptz.test.ts (13/13 passing)
affects: [09-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-side PTZ watchdog auto-stop (1500ms timer clearing and resetting on keepalive moves)"
    - "CameraProvider hardware decoupling with mock-mode in-memory preset state"
    - "Multi-layer route pre-handler pipeline: JWT auth -> Camera ACL -> Ed25519 capability"

key-files:
  created:
    - src/ptz/ptz.service.ts
    - src/ptz/ptz.routes.ts
    - tests/ptz.test.ts
  modified:
    - src/cameras/camera-provider.interface.ts
    - src/cameras/onvif.provider.ts
    - src/server.ts

key-decisions:
  - "1500ms server-side watchdog guarantees physical camera safety against runaway pan if client disconnects or drops packets"
  - "Clamped velocity vectors between -1.0 and 1.0 using Zod schema to prevent malformed floats from crashing ONVIF SOAP services"
  - "Viewers barred completely from PTZ; Operators checked against canControlPtz; Admins retain full bypass"

requirements-completed:
  - EXT-03

duration: 10m
completed: 2026-09-24
---

# Plan 09-01 Summary: Backend ONVIF PTZ Service & Safety Watchdog

**ONVIF Profile S PTZ service implemented with mandatory 1.5-second server-side watchdog auto-stop, preset position management, and capability-gated REST endpoints.**

## Accomplishments

1. **Camera Provider PTZ Abstraction**:
   - Extended `ICameraProvider` with `ptzMove`, `ptzStop`, `getPresets`, `gotoPreset`, `setPreset`, and `removePreset`.
   - Updated `OnvifCameraProvider` to wrap `node-onvif`'s PTZ service while supporting in-memory mock presets for deterministic testing.

2. **1500ms Safety Watchdog (`PtzService`)**:
   - Implemented `PtzService` maintaining an active per-camera watchdog map.
   - On every continuous move command, schedules a 1500ms timeout that automatically calls `ptzStop()` if no subsequent command or manual stop is received.
   - Prevents motor burnout and mechanical cable entanglement if client closes tab or disconnects.

3. **REST API & Capability Gating**:
   - Implemented Fastify plugin `ptzRoutes` mounted under `/api/cameras/:id/ptz`.
   - Gated all PTZ endpoints with `authenticate`, `requireCameraPermission('canControlPtz')`, and `requireCapability('extended.ptz')`.
   - Reserved preset persistence (`POST /presets`) and deletion (`DELETE /presets/:token`) to `ADMIN`.

4. **Testing & Verification**:
   - Created `tests/ptz.test.ts` covering capability check (403 without `extended.ptz`), role ACLs (Viewer 403, Operator check, Admin bypass), fake-timer watchdog auto-stop verification at 1500ms, watchdog reset on subsequent move, and preset management.
   - 13/13 tests passing.
