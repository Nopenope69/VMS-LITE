---
phase: 09
slug: onvif-ptz-controls-camera-presets
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-24
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test tests/ptz.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test tests/ptz.test.ts`
- **After every plan wave:** Run `npm test && npx tsc --noEmit && npx tsc --project client/tsconfig.json`
- **Before `/gsd-verify-work`:** Full suite must be green (0 test failures, 0 TypeScript errors)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | EXT-03 | T-09-01 | Watchdog timer automatically halts movement after 1500ms | unit | `npm test tests/ptz.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | EXT-03 | T-09-02 | Gated by `extended.ptz` and `canControlPtz` | integration | `npm test tests/ptz.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | EXT-03 | T-09-03 | Clamps move velocities between -1.0 and 1.0; manages presets | integration | `npm test tests/ptz.test.ts` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 2 | EXT-03 | T-09-01 | React overlay sends pointer events and keyboard control | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 2 | EXT-03 | T-09-02 | UI hides PTZ HUD if unpermitted or capability absent | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/ptz.test.ts` — Stubs for watchdog auto-stop, capability check, role ACL, and preset management
- [x] Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Camera Physical Pan/Tilt | EXT-03 | Requires physical ONVIF Profile S hardware connected to LAN | Connect ONVIF PTZ camera, open live view tile, press Up/Down/Left/Right and observe optical tracking |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-24
