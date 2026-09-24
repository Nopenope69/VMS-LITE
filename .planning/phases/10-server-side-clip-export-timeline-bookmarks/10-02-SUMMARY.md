---
phase: 10-server-side-clip-export-timeline-bookmarks
plan: 02
subsystem: clip-export-bookmarks-ui
tags: [react, modal, export, scrubber, bookmarks, timeline, gap-aware]

# Dependency graph
requires:
  - plan: 10-01
    provides: Export and bookmark REST API endpoints, DTOs, and RBAC ACLs
provides:
  - ClipExportModal with Stream Copy vs Transcoded Derivative selection and SHA-256 integrity checksum
  - BookmarkModal with category tagging (incident, visitor, maintenance, activity)
  - Gap-aware TimelineScrubber with color-coded bookmark pins and click-to-seek
  - Integrated PlaybackPage with hotkey B and permission-based export gating
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stream Copy vs Transcoded Derivative explicit mode selection"
    - "Automated SHA-256 integrity checksum verification badge with copy trigger"
    - "3-layer gap-aware timeline scrubber (recording spans, recording gaps, bookmark pins)"
    - "Time-window filtered range queries (?from=...&to=...)"

key-files:
  created:
    - client/src/components/ClipExportModal.tsx
    - client/src/components/BookmarkModal.tsx
  modified:
    - client/src/components/TimelineScrubber.tsx
    - client/src/pages/PlaybackPage.tsx
    - client/src/index.ts
    - client/src/context/AuthContext.tsx

key-decisions:
  - "Explicit UI differentiation between Original Stream Copy (fast, no re-encoding) and Rendered Export (Transcoded OSD Derivative)"
  - "Checksum labeled purely as SHA-256 integrity checksum, avoiding enterprise legal claims"
  - "Timeline scrubber visually highlights recording gaps using diagonal hash styling to avoid confusing operators when no footage was recorded"
  - "Permission canExportClips hides/disables export action button for unauthorized viewers and operators"

requirements-completed:
  - EXT-04
  - EXT-05

duration: 12m
completed: 2026-09-24
---

# Plan 10-02 Summary: Frontend UI for Clip Export & Gap-Aware Timeline Bookmarks

**Delivered ergonomic React modal dialogs for clip export and incident bookmarking, along with a 3-layer gap-aware 24-hour timeline scrubber in Palette 1.**

## Accomplishments

1. **Clip Export Dialog (`ClipExportModal.tsx`)**:
   - Operator selects time range with quick presets ("Last 5 Min", "Last 15 Min", "Last 1 Hour").
   - Explicit mode selection:
     - **Original / Stream Copy (Fast)**: Zero media decoding/re-encoding, instant packet concatenation.
     - **Rendered Export / Transcoded Derivative (OSD)**: Burns camera name and timestamps onto footage.
   - Progress polling with states (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`).
   - Displays **SHA-256 integrity checksum** badge with one-click copy and instant download action.
   - Graceful deterministic error handling if server returns `INCOMPATIBLE_SEGMENTS`.

2. **Bookmark Creation Dialog (`BookmarkModal.tsx`)**:
   - Pre-fills current playback timestamp.
   - Operator specifies title, description, and color-coded category (`incident`, `visitor`, `activity`, `maintenance`).
   - Hotkey `B` on playback page opens bookmark modal instantly.

3. **Gap-Aware Timeline Scrubber (`TimelineScrubber.tsx`)**:
   - 3 visual layers along the 24-hour bar:
     1. **Recorded Footage**: Continuous Ion Blue blocks (`#0284c7` / `#38bdf8`) with glow effect.
     2. **Recording Gaps**: Dark patterned space communicating unrecorded footage.
     3. **Incident Bookmarks**: Overlaid color-coded marker pins (Solar Amber, Emerald, Ion Blue, Slate).
   - Hover tooltip displays title, category, and exact timestamp.
   - Clicking a pin immediately seeks playback to the exact second.

4. **Integration in `PlaybackPage.tsx`**:
   - `canExport` check verifies user role and per-camera permission `canExportClips`.
   - Queries bookmarks for active camera filtered by day time-window.
   - Both backend and frontend TypeScript builds compile with 0 errors.
