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

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | EXT-04, EXT-05 | — | Prisma schema push generates Bookmark and ExportJob tables | schema | `npx prisma validate` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | EXT-04 | T-10-01, T-10-02 | Stream copy export takes <3s with SHA-256; 48h TTL prunes old exports | unit | `npm test tests/export-bookmarks.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | EXT-04, EXT-05 | T-10-03 | Endpoints gated by `extended.clip_export`, `extended.bookmarks`, and ACLs | integration | `npm test tests/export-bookmarks.test.ts` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 2 | EXT-04 | T-10-03 | React clip export modal allows range selection and download | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 2 | EXT-05 | — | Scrubber displays color-coded pins and click-to-seek navigation | typecheck | `npx tsc --project client/tsconfig.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/export-bookmarks.test.ts` — Stubs for packet-copy export, OSD flag, SHA-256 calculation, 48h TTL cleanup, and bookmark CRUD.
- [x] Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Media Player Clip Playback | EXT-04 | Requires opening exported MP4 in VLC / QuickTime / browser player | Export a 1-minute clip, download it, play in VLC, verify smooth playback and burned-in OSD timestamp if selected |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 12s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-24
