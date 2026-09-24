---
phase: 3
slug: recording-engine-storage-management
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-24
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run build` |
| **Estimated runtime** | ~6 seconds |

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
| 03-01-01 | 01 | 1 | REC-01, REC-03 | T-03-01 | Webhook ingests segment path safely, rejecting path traversal attempts | unit | `npx vitest run tests/recording-catalog.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | REC-03 | T-03-02 | Segment completion persists metadata and emits `recording.segment_created` | integration | `npx vitest run tests/recording-catalog.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | REC-01 | T-03-03 | Recording query API validates date ranges and filters by camera | integration | `npx vitest run tests/recording-catalog.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | REC-02 | T-03-04 | RecordingScheduler toggles MediaMTX recording based on schedule windows | unit | `npx vitest run tests/recording-scheduler.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | REC-04 | T-03-05 | StorageManager checks disk metrics and emits `storage.warning` and `storage.full` | unit | `npx vitest run tests/storage-manager.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | REC-05 | T-03-06 | FIFO rollover purges oldest recording files and DB records when quota is reached | integration | `npx vitest run tests/storage-manager.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `prisma/schema.prisma` migration with `Recording` and `RecordingSchedule` models
- [ ] `tests/recording-catalog.test.ts` test suite for webhook ingestion and querying
- [ ] `tests/recording-scheduler.test.ts` test suite for schedule evaluation
- [ ] `tests/storage-manager.test.ts` test suite for disk monitoring and FIFO rollover

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real MediaMTX segment generation on disk | REC-01 | Requires active RTSP stream and MediaMTX process writing fMP4 files | Start MediaMTX with camera path, wait 60s, verify segment file exists on disk |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Approved 2026-09-24
