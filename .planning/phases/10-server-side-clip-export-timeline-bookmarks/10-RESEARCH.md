# Phase 10: Server-Side Clip Export & Timeline Bookmarks - Technical Research

**Phase:** 10-server-side-clip-export-timeline-bookmarks  
**Requirements:** EXT-04 (`extended.clip_export`), EXT-05 (`extended.bookmarks`)  
**Date:** 2026-09-24 (Revised)  

---

## 1. Domain Context & Architectural Principles (VMS-Lite)

Basic VMS aims to deliver commercial CCTV parity for Indian SMBs, residential societies, and factories without the heavyweight enterprise baggage of compliance-grade evidence systems (e.g. Section 63 BSA legal certificates, multi-party cryptographic witness vaults).

Requirement **EXT-04** and **EXT-05** establish practical incident workflow capabilities:
1. **Evidence Clip Export (`EXT-04`)**:
   - **Stream-Copy Mode (`-c copy`) as Default**: Default export path concatenates recorded fMP4 segments using packet copy without decoding or re-encoding media. Eliminates CPU exhaustion on budget 4-core NVRs and prevents live WebRTC stream degradation.
   - **No Hard Wall-Clock Guarantee**: The architectural guarantee is zero media decoding/re-encoding, not a hard "<1 second" claim, as wall-clock duration depends on segment count, disk I/O, container operations, and timestamp remuxing.
   - **Segment Compatibility Gate (`ExportCompatibilityValidator`)**: Validates that all candidate recording segments share matching codec, resolution, and timebase before attempting `-c copy`. If segments are incompatible (e.g. resolution switch midway), returns a deterministic error rather than silently triggering high-CPU transcoding.
   - **OSD Burn-In as Explicit Derivative**: Rendered exports with burned-in camera names and timestamps are categorized explicitly as **"Transcoded Derivatives"**, cleanly separated from master stream-copy exports.
   - **SHA-256 Integrity Verification**: Generates an automated SHA-256 checksum of the exported file for tamper-evident file verification (not misrepresented as a legal chain of custody).
   - **Two-Tier Disk Cleanup Hierarchy**:
     - Normal Threshold (85%): Prunes expired exports (>48h TTL).
     - Emergency Threshold (90%): Aggressively purges unexpired exports before recording retention rules are evaluated. Continuous recordings are never deleted merely because exports exist.
2. **Timeline Incident Bookmarking (`EXT-05`)**:
   - Deliberately lightweight: Flags specific moments on the playback timeline (`incident`, `visitor`, `activity`, `maintenance`).
   - Queryable by time window (`?from=...&to=...&category=...`) to support large historical archives efficiently.
   - Scrubber track distinguishes between available recording spans, recording gaps, and bookmark pins.

---

## 2. Architecture & Data Model (Prisma)

### 2.1 Prisma Models & Indexes

```prisma
enum ExportStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
  EXPIRED
}

enum ExportMode {
  STREAM_COPY
  TRANSCODED_OSD
}

model ExportJob {
  id          String       @id @default(uuid())
  cameraId    String       @map("camera_id")
  camera      Camera       @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  userId      String?      @map("user_id")
  user        User?        @relation(fields: [userId], references: [id], onDelete: SetNull)
  startTime   DateTime     @map("start_time")
  endTime     DateTime     @map("end_time")
  exportMode  ExportMode   @default(STREAM_COPY) @map("export_mode")
  status      ExportStatus @default(QUEUED)
  filePath    String?      @map("file_path")
  fileSize    BigInt?      @map("file_size")
  sha256      String?      // Integrity verification checksum
  includeOsd  Boolean      @default(false) @map("include_osd")
  errorCode   String?      @map("error_code")
  errorMessage String?     @map("error_message")
  createdAt   DateTime     @default(now()) @map("created_at")
  startedAt   DateTime?    @map("started_at")
  completedAt DateTime?    @map("completed_at")
  expiresAt   DateTime     @map("expires_at") // 48h TTL

  @@index([cameraId])
  @@index([status])
  @@index([expiresAt])
  @@map("export_jobs")
}

model Bookmark {
  id          String   @id @default(uuid())
  cameraId    String   @map("camera_id")
  camera      Camera   @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  userId      String?  @map("user_id")
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  timestamp   DateTime
  title       String
  description String?
  category    String   @default("incident") // incident, visitor, maintenance, activity
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([cameraId, timestamp])
  @@index([cameraId, category, timestamp])
  @@map("bookmarks")
}
```

---

## 3. Video Processing & FFmpeg Engine

### 3.1 Stream-Copy Compatibility Gate
Before invoking FFmpeg concat, `ExportCompatibilityValidator` inspects the candidate recording segments:
1. Verify all segments exist on local disk.
2. Check metadata consistency:
   - Identical video encoding/codec (e.g. `H264` vs `H265`).
   - Matching video format and container layout.
3. If incompatible (e.g., camera switched resolution from 1080p to 4K midway through the range):
   - Reject job with `status: FAILED` and `errorCode: 'INCOMPATIBLE_SEGMENTS'`.
   - Explain incompatibility in `errorMessage` without silently triggering high-CPU transcode.

### 3.2 Secure FFmpeg Invocation
FFmpeg is spawned using `child_process.spawn` with an **argument array** (never shell string interpolation):

```typescript
// Fast Stream-Copy Export
const args = [
  '-y',
  '-f', 'concat',
  '-safe', '0',
  '-i', concatManifestPath,
  '-c', 'copy',
  '-movflags', '+faststart',
  outputFilePath,
];

// Transcoded Derivative (OSD Burn-In)
const osdArgs = [
  '-y',
  '-f', 'concat',
  '-safe', '0',
  '-i', concatManifestPath,
  '-vf', `drawtext=text='${sanitizedLabel}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.6:boxborderw=4:x=20:y=20`,
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '23',
  '-c:a', 'aac',
  '-movflags', '+faststart',
  outputFilePath,
];
```

The concat manifest (`list.txt`) is generated server-side using validated segment file paths.

### 3.3 Two-Tier Disk Protection Hierarchy
To protect both continuous recordings and system database operations:

```
[ Disk Pressure Monitor ]
          │
          ├── > 85% capacity (EXPORT_PRUNE_THRESHOLD)
          │     └── Delete EXPIRED exports (older than 48h)
          │
          ├── > 90% capacity (EMERGENCY_THRESHOLD)
          │     └── Delete UNEXPIRED exports (FIFO oldest first)
          │
          └── > 90% sustained after exports purged
                └── ONLY THEN evaluate Recording Retention FIFO
```

Continuous recordings are never deleted merely because exports exist.

---

## 4. API Specification & Range Queries

### 4.1 Clip Export (`/api/recordings/export`)
- `POST /api/recordings/export`:
  - Body: `{ cameraId: string, startTime: string, endTime: string, exportMode?: 'STREAM_COPY' | 'TRANSCODED_OSD' }`
  - Pre-handlers: `[authenticate, requireCameraPermission('canExportClips'), requireCapability('extended.clip_export')]`
  - Returns `202 Accepted` with `{ jobId, status: 'QUEUED', exportMode, expiresAt }`.
- `GET /api/recordings/export/:id`:
  - Returns `{ id, status, exportMode, fileSize, sha256, startedAt, completedAt, expiresAt, errorCode }`.
- `GET /api/recordings/export/:id/download`:
  - Streams finished MP4 file with headers:
    - `Content-Disposition: attachment; filename="export_camera_DATE.mp4"`
    - `X-Checksum-SHA256: <hash>`

### 4.2 Timeline Bookmarks (`/api/cameras/:id/bookmarks`)
- `GET /api/cameras/:id/bookmarks`:
  - Query params: `from` (ISO string), `to` (ISO string), `category` (optional).
  - Pre-handlers: `[authenticate, requireCameraPermission('canViewPlayback'), requireCapability('extended.bookmarks')]`
  - Indexed range query on `(cameraId, timestamp)`.
- `POST /api/cameras/:id/bookmarks`:
  - Body: `{ timestamp: string, title: string, description?: string, category?: string }`
  - Pre-handlers: `[authenticate, requireCameraPermission('canViewPlayback'), requireCapability('extended.bookmarks')]`
  - Returns `201 Created` with new bookmark.
- `DELETE /api/cameras/:id/bookmarks/:bookmarkId`:
  - Pre-handlers: `[authenticate, requireRole([Role.ADMIN, Role.OPERATOR]), requireCapability('extended.bookmarks')]`
  - Deletes bookmark.

---

## 5. Frontend UI/UX (Palette 1)

1. **Clip Export Modal (`ClipExportModal.tsx`)**:
   - Mode Toggle: **Original / Stream Copy (Fast)** vs **Rendered Export (Transcoded OSD)**.
   - Clarifies that OSD output is a derived rendering.
   - Shows progress state (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`).
   - Displays SHA-256 integrity checksum with copy button and instant download trigger.
2. **Timeline Scrubber Integration (`TimelineScrubber.tsx`)**:
   - 3-layer visual representation:
     1. Available recording blocks (Ion Blue / Cyan filled segments).
     2. Recording gaps (dark empty space indicating no footage recorded).
     3. Color-coded bookmark pins (Amber for incident, Emerald for visitor, Blue for activity, Slate for maintenance).
   - Clicking a pin seeks playback directly to the exact frame.
3. **Add Bookmark Modal (`BookmarkModal.tsx`)**:
   - Shortcut `B` or button on playback controls.
   - Pre-fills current playback position.
