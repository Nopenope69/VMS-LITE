# Phase 3: Recording Engine & Storage Management - Research

**Researched:** 2026-09-24  
**Domain:** MediaMTX fMP4 segment recording, webhook/hook indexing, recording scheduling, and disk quota monitoring with FIFO rollover  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from ROADMAP.md & REQUIREMENTS.md)

### Locked Decisions
- **Zero-Transcode / Packet-Preserving Recording (REC-01)**: MediaMTX records RTSP streams directly to fMP4 chunks on disk without decoding or re-encoding. No custom FFmpeg transcoding processes in Node.js.
- **MediaMTX Segment Completion Hook (REC-03)**: MediaMTX's `runOnRecordSegmentComplete` hook triggers segment ingestion into the PostgreSQL recording catalog.
- **Configurable Recording Schedules (REC-02)**: Cameras support 24/7 continuous or time-windowed scheduled recording (e.g., day-of-week, start/end time windows).
- **Storage Warning & Full Alerts (REC-04)**: System monitors disk mount capacity and emits `storage.warning` and `storage.full` events on the Phase 1 Core Event Bus.
- **Automatic FIFO Rollover (REC-05)**: When storage capacity reaches threshold (e.g. 90% or configured bytes), the oldest segments are deleted first until safe capacity is restored.
- **Licensing Clean Boundary**: Recording engine features integrate seamlessly with Package 1 Core, using `capabilities.has(...)` where applicable and maintaining clean separation.

### the agent's Discretion
- Segment duration: Default to 60-second fMP4 segments for optimal timeline scrubbing granularity and fast completion hook execution.
- Disk capacity check: Use native Node.js `fs.statfs` (`node:fs/promises`) for zero-dependency, cross-platform storage monitoring.
- Rollover thresholds: Default warning at 80% capacity, critical rollover trigger at 90% capacity, purging down to 80% target.

### Deferred Ideas (OUT OF SCOPE)
- Cloud/offsite backup upload (e.g. S3 sync) — Local disk only in v1
- Section 63 BSA chain-of-custody evidentiary hashing — VigilOne differentiator
- AI-triggered motion-only recording clips — Package 3 AI
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| fMP4 Stream Ingest & Chunking | MediaMTX (Media Plane) | Host Filesystem | MediaMTX writes packet-preserving fMP4 chunks with zero CPU transcode |
| Segment Completion Hook | MediaMTX | Fastify API (`/api/recordings/segments`) | MediaMTX executes hook script or HTTP webhook upon segment finalization |
| Recording Cataloging | API/Backend | PostgreSQL (`recordings` table) | Fastify backend verifies file on disk, parses duration/timestamps, and indexes record |
| Recording Schedule Evaluator | API/Backend | MediaMTX v3 Control API | Background scheduler evaluates active windows and patches MediaMTX `record: true/false` |
| Storage Monitor & FIFO Rollover | API/Backend | Host Filesystem & Database | Scheduled job checks `fs.statfs`, emits warning/full events, and purges oldest segments |
</architectural_responsibility_map>

<research_summary>
## Summary

Phase 3 builds the recording engine, metadata catalog, recording scheduler, and storage management subsystem for Basic VMS.
MediaMTX serves as the authoritative recording agent. When `record: true` is configured for a camera path, MediaMTX demuxes the RTSP packets directly into fragmented MP4 (`fmp4`) files in a configured directory (e.g. `recordings/%path/%Y-%m-%d_%H-%M-%S.mp4`) without any CPU-intensive re-encoding. 

Upon completing each segment, MediaMTX triggers the `runOnRecordSegmentComplete` command, supplying `$MTX_PATH`, `$MTX_SEGMENT_PATH`, and `$MTX_SEGMENT_DURATION`. A dedicated backend webhook endpoint (`POST /api/recordings/segments`) receives this notification, parses the start/end timestamps, confirms file size, saves the record to the PostgreSQL `recordings` catalog, and emits a `recording.segment_created` event on the Event Bus.

To support scheduled recording (REC-02), a `RecordingScheduler` periodically evaluates camera schedule rules against the current system time, toggling `record: true/false` dynamically via `MediaMtxClient.patchPath()`. 

To prevent disk saturation (REC-04, REC-05), a `StorageManager` checks disk metrics via native `fs.statfs()`. When usage exceeds warning thresholds, it emits `storage.warning`; when it exceeds the retention threshold, it unlinks the oldest segments from disk and database in FIFO order, emitting `storage.full` and `storage.rollover` events.

**Primary recommendation:** Use MediaMTX's native fMP4 recording with a webhook-driven ingestion endpoint, native Node.js `fs.statfs` for storage metrics, and atomic FIFO deletion with comprehensive unit/integration test coverage with mock storage files.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| MediaMTX | v1.11+ | Media Plane segment recorder | Zero-transcode fMP4 chunking with native `runOnRecordSegmentComplete` hook |
| Node.js `fs.statfs` | Node 20 LTS (`node:fs/promises`) | Storage disk capacity inspection | Native, cross-platform, zero native C++ or external dependencies |
| `@prisma/client` | 5.x | Database ORM | Schema extension with `Recording` and `RecordingSchedule` models |
| `fastify` | ^4.28 / 5.x | HTTP REST API | Webhook receiver and recording query API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^3.23 | Schema validation | Validating segment hook payloads and schedule window DTOs |
| `date-fns` or native `Date` | ES2022 | Time window parsing | Checking current hour/minute against camera schedules |

**Installation:**
No new external third-party dependencies required; uses existing Fastify, Prisma, Zod, and native Node.js APIs.
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### System Architecture Diagram

```
         [ IP Camera RTSP Stream ]
                     │
                     ▼
         ┌───────────────────────┐
         │ MediaMTX Media Server │ ◄── [ RecordingScheduler Worker ]
         │ (record: true, fmp4)  │      Patches record: true/false based
         └───────────┬───────────┘      on camera schedule windows
                     │
        Writes chunk │ 60s segment
                     ▼
         ┌───────────────────────┐
         │ Disk Storage Mount    │
         │ (/var/recordings/...) │
         └───────────┬───────────┘
                     │ Triggers runOnRecordSegmentComplete
                     ▼
         ┌───────────────────────┐
         │ Ingestion Endpoint    │
         │ POST /recordings/segs │
         └───────────┬───────────┘
                     │ Inserts metadata
                     ▼
         ┌───────────────────────┐
         │  PostgreSQL Database  │ ◄── [ StorageManager Worker ]
         │   `recordings` table  │      Checks fs.statfs, purges oldest
         └───────────────────────┘      records & unlinks files on rollover
```

### Recommended Project Structure
```
src/
├── recordings/
│   ├── recording.types.ts            # Zod schemas, segment hook payloads, schedule DTOs
│   ├── recording.service.ts          # Catalog indexing, querying, segment retrieval
│   ├── recording.routes.ts           # REST endpoints: /api/recordings, /api/recordings/segments
│   ├── recording-scheduler.service.ts# Time-window evaluation, toggles MediaMTX recording
│   └── storage-manager.service.ts    # fs.statfs monitor, threshold evaluation, FIFO purge
```

### Pattern 1: Dynamic Recording Path Ingestion Hook
**What:** MediaMTX executes a webhook upon segment completion passing environment variables `$MTX_PATH`, `$MTX_SEGMENT_PATH`, and `$MTX_SEGMENT_DURATION`.
```yaml
# mediamtx.yml excerpt
pathDefaults:
  record: no
  recordPath: ./recordings/%path/%Y-%m-%d_%H-%M-%S-%f.mp4
  recordFormat: fmp4
  recordPartDuration: 1s
  recordSegmentDuration: 60s
  runOnRecordSegmentComplete: curl -s -X POST http://127.0.0.1:3000/api/recordings/segments -H "Content-Type: application/json" -d "{\"mediaMtxPath\":\"$MTX_PATH\",\"segmentPath\":\"$MTX_SEGMENT_PATH\",\"duration\":$MTX_SEGMENT_DURATION}"
```

### Pattern 2: Native Zero-Dependency Storage Monitoring & FIFO Rollover
**What:** Native `fs.statfs` checks disk space and triggers FIFO deletion when disk limit is breached.
```typescript
import fs from 'node:fs/promises';

export async function checkStorageSpace(mountPath: string): Promise<StorageMetrics> {
  const stats = await fs.statfs(mountPath);
  const totalBytes = Number(stats.blocks * BigInt(stats.bsize));
  const freeBytes = Number(stats.bfree * BigInt(stats.bsize));
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = (usedBytes / totalBytes) * 100;

  return { totalBytes, freeBytes, usedBytes, usedPercent };
}
```

### Anti-Patterns to Avoid
- **Re-encoding during recording**: Never pipe camera streams through `ffmpeg -c:v libx264` to record; always preserve existing camera packets using MediaMTX zero-decode streaming.
- **Synchronous disk purging**: Avoid bulk unlinking thousands of files in a single synchronous loop that could freeze the I/O bus; purge in batches (e.g. 50 files) and re-check space.
- **Orphaned database records**: Always ensure disk unlinking and database deletion happen in coordination. If a file is missing on disk, clear the database record; if database deletion fails, log warning.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MP4 Segment Packaging | Custom MP4 container muxer | MediaMTX fMP4 recording | Handling H.264/H.265 SPS/PPS parameter sets, moov/mdat atom chunking, and sync samples is complex and prone to corruption |
| Disk Usage Check | Parsing `df -k` shell command | Native `fs.statfs()` in Node 20 | Parsing `df` output across Linux/macOS fails due to locale and column differences |
| Cron / Scheduling | Heavy cron daemon | Pure TypeScript schedule matcher | Camera recording schedules only require simple `dayOfWeek` and minute range checks |
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Clock Drift Between Camera, MediaMTX, and Node Backend
**What goes wrong:** Recording timestamps in filename don't match database records or playback scrubbers.
**Why it happens:** MediaMTX uses host machine time for filenames (`%Y-%m-%d_%H-%M-%S`), while cameras might have unsynchronized RTCs.
**How to avoid:** Always use host timestamp recorded at segment completion or parsed from MediaMTX's generated filename as the authoritative timeline timestamp.

### Pitfall 2: High File Descriptor Usage During Bulk Rollover
**What goes wrong:** EMFILE or EBUSY errors when purging expired video chunks.
**Why it happens:** Concurrent `Promise.all` across thousands of `fs.unlink` calls exhausts file descriptors.
**How to avoid:** Process file unlinking sequentially or in bounded chunks (e.g., 20 files per batch).

### Pitfall 3: Webhook Missed During Backend Restart
**What goes wrong:** If the Node backend restarts while MediaMTX finishes a chunk, the curl webhook fails and the chunk is uncataloged.
**How to avoid:** Provide a background reconciliation scanner that scans the recordings folder on startup to index any uncataloged `.mp4` files.
</common_pitfalls>

<code_examples>
## Code Examples

### Recording Segment Webhook Handler
```typescript
fastify.post('/api/recordings/segments', async (request, reply) => {
  const payload = SegmentCompleteSchema.parse(request.body);
  const camera = await prisma.camera.findUnique({
    where: { mediaMtxPath: payload.mediaMtxPath },
  });

  if (!camera) {
    return reply.status(404).send({ error: 'CameraNotFound' });
  }

  const stat = await fs.stat(payload.segmentPath).catch(() => null);
  const sizeBytes = stat ? stat.size : 0;
  const now = new Date();
  const startTime = new Date(now.getTime() - payload.duration * 1000);

  const recording = await prisma.recording.create({
    data: {
      cameraId: camera.id,
      mediaMtxPath: payload.mediaMtxPath,
      filePath: payload.segmentPath,
      fileName: path.basename(payload.segmentPath),
      startTime,
      endTime: now,
      duration: payload.duration,
      sizeBytes: BigInt(sizeBytes),
    },
  });

  await eventBus.emitEvent({
    type: 'recording.segment_created',
    source: 'recording.service',
    cameraId: camera.id,
    metadata: { recordingId: recording.id, duration: payload.duration },
  });

  return reply.status(201).send({ success: true, recordingId: recording.id });
});
```

### Storage Check and FIFO Rollover
```typescript
export async function enforceDiskQuota(recordingsDir: string, maxUsedPercent = 90, targetUsedPercent = 80) {
  const metrics = await checkStorageSpace(recordingsDir);
  if (metrics.usedPercent > 85) {
    await eventBus.emitEvent({ type: 'storage.warning', source: 'storage.manager', metadata: metrics });
  }

  if (metrics.usedPercent >= maxUsedPercent) {
    await eventBus.emitEvent({ type: 'storage.full', source: 'storage.manager', metadata: metrics });
    
    // Purge oldest recordings in FIFO order
    let currentMetrics = metrics;
    while (currentMetrics.usedPercent > targetUsedPercent) {
      const oldest = await prisma.recording.findMany({
        orderBy: { startTime: 'asc' },
        take: 10,
      });

      if (oldest.length === 0) break;

      for (const rec of oldest) {
        await fs.unlink(rec.filePath).catch(() => {});
        await prisma.recording.delete({ where: { id: rec.id } });
      }

      currentMetrics = await checkStorageSpace(recordingsDir);
    }

    await eventBus.emitEvent({ type: 'storage.rollover', source: 'storage.manager', metadata: currentMetrics });
  }
}
```
</code_examples>

## Validation Architecture

### Test Suite Strategy
1. **Unit Tests (`tests/recording-catalog.test.ts`)**:
   - Verify webhook parsing and catalog creation in database.
   - Verify timeline query filters (by camera, start/end time ranges).
   - Verify BigInt serialization and DTO responses.
2. **Unit Tests (`tests/recording-scheduler.test.ts`)**:
   - Verify schedule evaluation for 24/7 continuous vs scheduled windows.
   - Verify day-of-week and time boundary matching (inside window vs outside window).
   - Verify calls to MediaMTX patch path to toggle recording.
3. **Integration Tests (`tests/storage-manager.test.ts`)**:
   - Verify `fs.statfs` space calculation.
   - Verify threshold triggers: `storage.warning` at 85%, `storage.full` at 90%.
   - Verify FIFO deletion: creates 5 mock recording files, triggers rollover, confirms oldest files are unlinked first and removed from DB.

<sota_updates>
## State of the Art (2024-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom FFmpeg HLS/segmenter scripts | MediaMTX native fMP4 recording | 2023+ | Completely eliminates FFmpeg CPU usage on budget host boxes |
| Running `df -h` shell sub-processes | Native `node:fs/promises` `statfs()` | Node 18.15+ / 20 LTS | Portable, synchronous-safe, zero spawn overhead for storage checks |
| Re-encoding MP4 headers after write | Fragmented MP4 (`fmp4`) streaming | Standard VMS | Segments are playable immediately without waiting for `moov` atom finalization |
</sota_updates>

<open_questions>
## Open Questions

1. **MediaMTX `recordPath` location**:
   - Recommendation: Default to `./recordings` or configurable via `RECORDINGS_DIR` environment variable.
2. **Missing recording file on disk**:
   - Recommendation: If a user or external process deletes an MP4 file on disk, `StorageManager` should gracefully catch `ENOENT` during rollover without throwing.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- MediaMTX v1.11+ Documentation (`record`, `recordPath`, `runOnRecordSegmentComplete`)
- Node.js Documentation (`node:fs/promises` `statfs`)
- PostgreSQL & Prisma Client Documentation for BigInt and DateTime indexes

<metadata>
## Metadata

**Research scope:**
- Core technology: MediaMTX recording hooks, PostgreSQL catalog, Node.js `fs.statfs`, Fastify
- Ecosystem: EventBus, MediaMtxClient
- Pitfalls: Clock drift, file descriptor exhaustion, un-re-encoded fMP4 chunking

**Confidence breakdown:**
- Standard stack: HIGH
- Architecture: HIGH
- Pitfalls: HIGH
- Code examples: HIGH

**Research date:** 2026-09-24  
**Valid until:** 2026-10-24  
</metadata>

---
*Phase: 03-recording-engine-storage-management*  
*Research completed: 2026-09-24*  
*Ready for planning: yes*
