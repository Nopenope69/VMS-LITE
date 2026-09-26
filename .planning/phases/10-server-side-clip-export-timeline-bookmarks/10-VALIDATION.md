---
phase: 10
slug: server-side-clip-export-timeline-bookmarks
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-24
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test tests/export-bookmarks.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test tests/export-bookmarks.test.ts`
- **After every plan wave:** Run `npm test && npx tsc --noEmit && npx tsc --project client/tsconfig.json`
- **Before `/gsd-verify-work`:** Full suite must be green (0 test failures, 0 TypeScript errors)
- **Max feedback latency:** 12 seconds

---

## Threat Model Reference & Verification Behaviors

- **T-10-01 (CPU Starvation via Unthrottled Re-Encoding)**:
  - *Secure Behavior*: Default export uses stream copy (`-c copy`) with zero media decoding/re-encoding. `ExportCompatibilityValidator` verifies segments share codec, resolution, and format; returns deterministic `INCOMPATIBLE_SEGMENTS` error on mismatch (no silent transcode fallback). OSD burn-in is strictly modeled as an explicit Transcoded Derivative.
- **T-10-02 (Storage Saturation from Export Artifacts)**:
  - *Secure Behavior*: Two-tier storage hierarchy: 85% normal threshold prunes expired (>48h TTL) exports; 90% emergency threshold prunes unexpired exports FIFO. Continuous recordings are protected and never purged merely because exports exist.
- **T-10-03 (Unauthorized Evidence Export & Tampering)**:
  - *Secure Behavior*: Endpoints strictly gated by `requireCapability('extended.clip_export')`, `requireCapability('extended.bookmarks')`, and `requireCameraPermission('canExportClips')`. Export outputs compute SHA-256 integrity checksums for file verification (never described as "chain of custody").

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | EXT-04, EXT-05 | — | Prisma schema push generates Bookmark, ExportJob, ExportStatus, ExportMode | schema | `npx prisma validate` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | EXT-04 | T-10-01, T-10-02 | Stream copy export via spawn (no shell interpolation); ExportCompatibilityValidator rejects mismatches; SHA-256 integrity checksum; two-tier disk pruner (85%/90%) | unit | `npm test tests/export-bookmarks.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | EXT-04, EXT-05 | T-10-03 | Endpoints gated by capabilities and ACLs; bookmark time-range queries (`?from=...&to=...&category=...`) | integration | `npm test tests/export-bookmarks.test.ts` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 2 | EXT-04 | T-10-01, T-10-03 | React clip export modal distinguishes Original / Stream Copy vs Rendered Transcoded Derivative (OSD), shows SHA-256 integrity checksum | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 2 | EXT-05 | — | Scrubber displays recording spans, recording gaps, and bookmark pins; seeks on click | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/export-bookmarks.test.ts` — Stubs for packet-copy export, compatibility validator, OSD derivative, SHA-256 integrity checksum, two-tier storage cleanup, and bookmark range queries.
- [x] Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Media Player Clip Playback | EXT-04 | Requires opening exported MP4 in VLC / QuickTime / browser player | Export a 1-minute clip, download it, play in VLC, verify smooth playback and burned-in OSD timestamp if selected as derivative |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 12s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-24
