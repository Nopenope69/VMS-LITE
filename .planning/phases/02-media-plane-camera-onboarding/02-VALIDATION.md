---
phase: 2
slug: media-plane-camera-onboarding
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-24
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run build` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | CAM-05 | T-02-01 | MediaMtxClient validates URLs and adds paths via v3 API | unit | `npx vitest run tests/mediamtx-client.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | CAM-04 | T-02-02 | CameraProvider interface wraps ONVIF without leaking vendor internals | unit | `npx vitest run tests/camera-provider.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | CAM-02 | T-02-03 | Profile T extraction falls back cleanly to Profile S | unit | `npx vitest run tests/camera-provider.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | CAM-01 | T-02-04 | WS-Discovery probe returns discovered devices with network timeouts | unit | `npx vitest run tests/camera-discovery.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | CAM-03 | T-02-05 | Manual RTSP onboarding validates stream URI before saving | integration | `npx vitest run tests/camera-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 2 | CAM-05 | T-02-06 | Camera onboarding syncs to MediaMTX and emits `camera.online` event | integration | `npx vitest run tests/camera-routes.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 2 | LIC-02 | T-02-07 | Adding cameras beyond license limit returns 403 Forbidden | integration | `npx vitest run tests/camera-routes.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install node-onvif` for pinned ONVIF client
- [ ] `prisma/schema.prisma` migration with `Camera` model
- [ ] `tests/fixtures/onvif-mock.ts` mock ONVIF device response fixture
- [ ] `tests/camera-provider.test.ts` unit test suite for adapter
- [ ] `tests/mediamtx-client.test.ts` test suite for MediaMTX v3 client
- [ ] `tests/camera-routes.test.ts` integration test suite for Fastify camera routes

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Camera WS-Discovery on LAN | CAM-01 | Physical hardware required on same local subnet | Run `curl -X POST http://localhost:3000/api/cameras/discover` with physical camera powered on LAN |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Approved 2026-09-24
