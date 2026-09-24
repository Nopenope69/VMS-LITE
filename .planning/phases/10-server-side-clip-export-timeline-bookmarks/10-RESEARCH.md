# Phase 10: Server-Side Clip Export & Timeline Bookmarks - Technical Research

**Phase:** 10-server-side-clip-export-timeline-bookmarks  
**Requirements:** EXT-04 (`extended.clip_export`), EXT-05 (`extended.bookmarks`)  
**Date:** 2026-09-24  

---

## 1. Domain Context & Requirements

In commercial CCTV installations (gated societies, factories, retail outlets):
1. **Evidence Export (`EXT-04`)**:
   - When an incident occurs (theft, vehicle collision, perimeter breach), operators and facility managers must download an MP4 video clip to hand over to police, society committees, or insurance inspectors.
   - **Zero-Transcode Stream Copy (Default)**: Default clip cutting must concatenate packet-preserving fMP4 segments using FFmpeg `-c copy`. This requires 0% CPU re-encoding, finishes in under 3 seconds, and eliminates live streaming frame drops.
   - **Burn-In Timestamp OSD & Watermark (Optional)**: If toggled, burns in camera name, site label, and millisecond-accurate timestamps using FFmpeg's `drawtext` video filter so the video is indisputable when shared via WhatsApp or mobile apps.
   - **SHA-256 Integrity Verification**: Each exported MP4 is hashed with SHA-256 upon completion for tamper-evident verification.
   - **48-Hour TTL Disk Cleanup**: Exported files are cached in a dedicated export directory (`exports/`) and automatically pruned after 48 hours or when storage approaches full capacity to prevent storage exhaustion.
2. **Timeline Incident Bookmarking (`EXT-05`)**:
   - Operators monitoring shifts need to flag notable moments (e.g., "Visitor entry blocked", "Unregistered vehicle parked at 02:15") so next-shift guards have immediate context without scrubbing 24 hours of video.
   - Bookmarks are displayed as color-coded pins directly on the 24-hour playback scrubber.
   - Clicking a pin seeks playback directly to the flagged frame.
   - Categorized by tag: `incident` (amber), `visitor` (emerald), `maintenance` (slate), `activity` (blue).

---

## 2. Architecture & Data Model (Prisma)

### 2.1 Prisma Schema Models

```prisma
model Bookmark {
  id          String   @id @default(uuid())
  cameraId    String   @map("camera_id")
  camera      Camera   @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  userId      String?  @map("user_id")
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  timestamp   DateTime
  title       String
  description String?
  category    String   @default("incident") // incident, maintenance, visitor, activity, other
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([cameraId, timestamp])
  @@index([category])
  @@map("bookmarks")
}

model ExportJob {
  id          String   @id @default(uuid())
  cameraId    String   @map("camera_id")
  camera      Camera   @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  userId      String?  @map("user_id")
  startTime   DateTime @map("start_time")
  endTime     DateTime @map("end_time")
  status      String   @default("pending") // pending, processing, completed, failed
  filePath    String?  @map("file_path")
  fileSize    BigInt?  @map("file_size")
  sha256      String?
  includeOsd  Boolean  @default(false) @map("include_osd")
  error       String?
  expiresAt   DateTime @map("expires_at") // 48h TTL
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([cameraId])
  @@index([status])
  @@index([expiresAt])
  @@map("export_jobs")
}
```

---

## 3. Video Processing & FFmpeg Engine

### 3.1 Fast Stream Copy Mode (`-c copy`)
For standard exports:
1. Identify all `Recording` records overlapping `[startTime, endTime]` in the database.
2. Generate an FFmpeg concat demuxer file (`list.txt`):
   ```
   file '/storage/recordings/camera1/2026-09-24_10-00-00.mp4'
   file '/storage/recordings/camera1/2026-09-24_10-05-00.mp4'
   ```
3. Spawn FFmpeg child process:
   ```bash
   ffmpeg -y -f concat -safe 0 -i list.txt -c copy /storage/exports/export_<id>.mp4
   ```
4. Execution takes sub-second latency with zero CPU transcoding load.

### 3.2 OSD Burn-In Mode (`includeOsd: true`)
When timestamp burn-in is selected:
```bash
ffmpeg -y -f concat -safe 0 -i list.txt \
  -vf "drawtext=text='%{pts\\:localtime\\:TIMESTAMP} | %{camera_name}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.6:boxborderw=4:x=20:y=20" \
  -c:v libx264 -preset veryfast -crf 23 -c:a aac /storage/exports/export_<id>.mp4
```
To protect low-cost hardware:
- Throttled concurrency: Only 1 transcode job runs at any time.
- Low process priority (`nice -n 10` on POSIX hosts).
- Execution watchdog: Process killed after 120 seconds if frozen.

### 3.3 SHA-256 Integrity Hash & Storage Pruning
- After export completes, `crypto.createHash('sha256')` computes the file checksum.
- `ExportPruneService`: Periodic garbage collector runs hourly and deletes all files whose `expiresAt <= now()`.
- Export directory storage is accounted for in `StorageController` disk checks.

---

## 4. API Routes & Access Control

### 4.1 Clip Export Endpoints (`/api/recordings/export`)
- `POST /api/recordings/export`:
  - Body: `{ cameraId, startTime, endTime, includeOsd }`
  - Pre-handlers: `[authenticate, requireCameraPermission('canExportClips'), requireCapability('extended.clip_export')]`
  - Returns: `{ exportJobId, status, expiresAt }`
- `GET /api/recordings/export/:id`:
  - Returns job status, download URL, file size, SHA-256 hash.
- `GET /api/recordings/export/:id/download`:
  - Serves MP4 file attachment with `X-Checksum-SHA256` header.

### 4.2 Bookmark Endpoints (`/api/cameras/:id/bookmarks`)
- `GET /api/cameras/:id/bookmarks`:
  - Query: `?category=incident&from=...&to=...`
  - Pre-handlers: `[authenticate, requireCameraPermission('canViewPlayback'), requireCapability('extended.bookmarks')]`
  - Returns: `Bookmark[]`
- `POST /api/cameras/:id/bookmarks`:
  - Body: `{ timestamp, title, description, category }`
  - Pre-handlers: `[authenticate, requireCameraPermission('canViewPlayback'), requireCapability('extended.bookmarks')]`
  - Returns: `201 Created` with new `Bookmark`.
- `DELETE /api/cameras/:id/bookmarks/:bookmarkId`:
  - Pre-handlers: `[authenticate, requireRole([Role.ADMIN, Role.OPERATOR]), requireCapability('extended.bookmarks')]`
  - Deletes bookmark.

---

## 5. Frontend UI/UX Integration (Palette 1)

1. **Clip Export Dialog Modal (`ClipExportModal.tsx`)**:
   - Opens from Playback page header or scrubber selection range.
   - Time-range pickers with quick presets: "Last 5 min", "Last 15 min", "Custom Range".
   - Checkbox: `[x] Burn-in Camera Name & Timestamp OSD` (warns: "Transcoding takes ~10-30s").
   - Live export progress spinner with SHA-256 hash badge upon completion and instant Download button.
2. **Timeline Bookmark Pins (`TimelineScrubber.tsx`)**:
   - Scrubber track renders diamond/pin icons at bookmark timestamps.
   - Color-coded:
     - Solar Amber (`#fb923c`): Incident
     - Ion Blue (`#4fc3f7`): Activity
     - Emerald (`#10b981`): Visitor
     - Slate (`#94a3b8`): Maintenance
   - Hover displays tooltip with title, author, and timestamp.
   - Click automatically jumps scrubber to that frame.
3. **Add Bookmark Modal (`BookmarkModal.tsx`)**:
   - Quick shortcut key (`B`) or button on playback toolbar.
   - Pre-fills current scrubber playback timestamp.
   - Title input, category dropdown, optional notes.
