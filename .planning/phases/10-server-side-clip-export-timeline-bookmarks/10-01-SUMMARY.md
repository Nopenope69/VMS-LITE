---
phase: 10-server-side-clip-export-timeline-bookmarks
plan: 01
subsystem: clip-export-bookmarks
tags: [ffmpeg, stream-copy, bookmarks, timeline, export, prisma, rbac, licensing]

# Dependency graph
requires:
  - phase: 01-foundation-licensing-event-bus
    provides: Licensing capability verifier and JWT authentication
  - phase: 08-operator-role-granular-rbac
    provides: 3-tier RBAC and requireCameraPermission ACL hook
provides:
  - ExportJob and Bookmark Prisma models with composite indexes
  - ExportCompatibilityValidator pre-flight segment verification
  - FFmpeg stream copy (-c copy) and Transcoded Derivative (OSD) pipelines
  - SHA-256 integrity checksum calculation on exported MP4 files
  - Two-tier storage cleanup hierarchy (85% expired, 90% emergency FIFO)
  - Time-window range-queryable bookmarks REST API
affects: [10-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Segment compatibility pre-flight validation preventing silent transcode fallback"
    - "Spawn-based safe array FFmpeg process execution"
    - "Automated SHA-256 checksum generation for file tamper-evidence"
    - "Two-tier storage cleanup hierarchy protecting continuous recordings"
    - "Composite indexed time-window range queries"

key-files:
  created:
    - src/export/export.types.ts
    - src/export/export-compatibility.validator.ts
    - src/export/export.service.ts
    - src/export/export-prune.service.ts
    - src/export/export.routes.ts
    - src/bookmarks/bookmark.types.ts
    - src/bookmarks/bookmark.service.ts
    - src/bookmarks/bookmark.routes.ts
    - tests/export-bookmarks.test.ts
  modified:
    - prisma/schema.prisma
    - src/server.ts
    - src/users/rbac.guard.ts
    - .gitignore

key-decisions:
  - "Default export uses stream copy (-c copy) with zero media decoding/re-encoding"
  - "ExportCompatibilityValidator deterministically rejects mismatched segments with INCOMPATIBLE_SEGMENTS without silently falling back to transcoding"
  - "OSD burn-in is strictly modeled and labeled as an explicit Transcoded Derivative"
  - "Two-tier disk cleanup hierarchy: 85% normal threshold prunes expired (>48h TTL) exports; 90% emergency threshold purges unexpired exports FIFO; continuous recordings are strictly protected"
  - "Checksum labeled purely as SHA-256 integrity checksum, avoiding enterprise legal claims"

requirements-completed:
  - EXT-04
  - EXT-05

duration: 15m
completed: 2026-09-24
---

# Plan 10-01 Summary: Backend Video Clip Export Engine & Timeline Bookmarks

**Delivered zero-transcode stream copy MP4 stitching, pre-flight segment compatibility validation, explicit Transcoded Derivative OSD rendering, automated SHA-256 integrity checksums, two-tier storage cleanup hierarchy, and time-range queryable bookmarks API.**

## Accomplishments

1. **Prisma Schema & Model Extensions**:
   - Added `ExportStatus` and `ExportMode` enums.
   - Created `ExportJob` model with lifecycle timestamps (`createdAt`, `startedAt`, `completedAt`, `expiresAt`) and error tracking.
   - Created `Bookmark` model with composite indexes `@@index([cameraId, timestamp])` and `@@index([cameraId, category, timestamp])`.

2. **Stream-Copy Compatibility Gate (`ExportCompatibilityValidator`)**:
   - Validates candidate recording segments exist on disk and share identical container formats, codecs, and resolutions.
   - Returns deterministic `INCOMPATIBLE_SEGMENTS` rejection on mismatch without triggering silent high-CPU transcoding.

3. **FFmpeg Export Engine (`ExportService`)**:
   - Spawns FFmpeg safely using process argument arrays (zero shell interpolation).
   - Generates server-side concat manifest from sanitized file paths.
   - Defaults to zero-transcode stream copy (`-c copy`).
   - Supports explicit `TRANSCODED_OSD` derivative rendering with `drawtext` filter.
   - Computes automated 64-character SHA-256 integrity checksum on finished MP4 files.

4. **Two-Tier Storage Cleanup (`ExportPruneService`)**:
   - 85% normal threshold prunes expired exports (>48h TTL).
   - 90% emergency threshold purges unexpired exports FIFO.
   - Continuous recordings are strictly protected and never purged merely because exports exist.

5. **API Routes & Security Controls**:
   - `POST /api/recordings/export` (gated by `canExportClips` and `extended.clip_export`).
   - `GET /api/recordings/export/:id` & `GET /api/recordings/export/:id/download` (with `X-Checksum-SHA256` header).
   - `GET /api/cameras/:id/bookmarks?from=...&to=...&category=...` (gated by `canViewPlayback` and `extended.bookmarks`).
   - `POST /api/cameras/:id/bookmarks` and `DELETE /api/cameras/:id/bookmarks/:id`.

6. **Automated Verification**:
   - 15/15 unit and integration tests passing in `tests/export-bookmarks.test.ts`.
