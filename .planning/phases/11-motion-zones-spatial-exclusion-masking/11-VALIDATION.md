---
phase: 11
slug: motion-zones-spatial-exclusion-masking
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-24
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Architectural Contracts

> **Grid-based ONVIF motion is evaluated using the normalized centroid of each active cell. Zone filtering therefore operates at ONVIF event-grid resolution, not pixel/object resolution.**

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test tests/motion-zones.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test tests/motion-zones.test.ts`
- **After every plan wave:** Run `npm test && npx tsc --noEmit && npx tsc --project client/tsconfig.json`
- **Before `/gsd-verify-work`:** Full suite must be green (0 test failures, 0 TypeScript errors)
- **Max feedback latency:** 12 seconds

---

## Threat Model Reference & Verification Behaviors

- **T-11-01 (DoS via Degenerate or Complex Polygons)**:
  - *Secure Behavior*: Coordinate validator limits polygons to between 3 and 32 vertices. Rejects out-of-bounds coordinates with HTTP 400 Bad Request (no silent clamping). Ray-casting completes in sub-millisecond time.
- **T-11-02 (Unauthorized Motion Zone Manipulation)**:
  - *Secure Behavior*: Zone creation, updates, and deletion require `Role.ADMIN` and `extended.motion_zones` capability. Operators and Viewers cannot mutate zones.
- **T-11-03 (Spatial Masking Leak / False Alert Leak)**:
  - *Secure Behavior*: `SpatialMotionFilter` strictly adheres to the multi-zone truth table (Exclusion wins unconditionally; Inclusion requires at least one match if configured). Dynamic cache invalidation ensures geometry changes take effect immediately without listener restarts.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | EXT-02 | — | Prisma schema push generates ZoneType enum and MotionZone model | schema | `npx prisma validate` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | EXT-02 | T-11-01, T-11-03 | Ray-casting Point-in-Polygon evaluates multi-zone truth table; rejects invalid vertex bounds with 400 | unit | `npm test tests/motion-zones.test.ts` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | EXT-02 | T-11-02, T-11-03 | Endpoints gated by `extended.motion_zones` and Role.ADMIN; ONVIF event filter drops excluded motion without listener restarts | integration | `npm test tests/motion-zones.test.ts` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 2 | EXT-02 | T-11-01 | SVG polygon editor allows drawing, editing, and deleting inclusion/exclusion zones with vertex boundary constraints | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 2 | EXT-02 | — | LiveCameraTile integration with interactive click-test mode for zone verification | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/motion-zones.test.ts` — Stubs for Ray-Casting algorithm, multi-zone truth table, vertex bounds rejection, API routes, dynamic cache invalidation, and capability checks.
- [x] Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SVG Polygon Drag & Drop | EXT-02 | Requires interactive canvas pointer dragging in browser | Open Motion Zone editor on camera tile, click 4 vertices to create exclusion zone, drag vertex to resize, save, verify SVG matches |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 12s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-24
