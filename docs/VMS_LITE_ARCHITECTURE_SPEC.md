# VMS-Lite: Core Industrial Architecture Specification

**Version:** 2.0  
**Target:** Industrial Edge Video Appliance (1–32 Cameras per Edge Node)  
**Core Mission:** Deterministic, reliable capture, organization, retrieval, and export of video and operational events from heterogeneous camera networks with zero-frame-decoding in the control plane.  
**Guiding Principle:** *VMS-Lite must remain 100% useful with AI switched off.*

---

## 1. Architectural Philosophy & 5 Corrections Applied

1. **Decoupled Segment Lifecycle vs. References**: `EXPORTED` is not a lifecycle state of a recording segment. A segment remains `AVAILABLE`. Operational entities (Events, Incidents, Bookmarks, Evidence Bundles) attach references and protection flags to `AVAILABLE` segments.
2. **Segment Validation Separated from Storage Health**: MediaMTX writes fMP4 segments; VMS-Lite inspects them. Validation checks container structure, atom headers, duration, and file stability—**not** `fsync`. Storage health is verified independently via an active write canary probe.
3. **Simplified Stream Roles**: Cameras negotiate strictly `PRIMARY` (recording, single live view) and `SUB` (grid live view, remote bandwidth saving), with `AUDIO` as an optional orthogonal capability. `MOBILE` is a delivery policy (WebRTC/WHEP proxying), not a camera stream property.
4. **Capability-Oriented Camera Interfaces**: Avoid monolithic camera adapters. Discrete interfaces (`ICameraStreamProvider`, `ICameraDeviceInfo`, `ICameraDiscovery`, `ICameraEventProvider`, `ICameraPtzController`) allow generic RTSP cameras to participate cleanly without stubbing PTZ or ONVIF event methods.
5. **Storage Pressure Safeguards for Protected Evidence**: Protected footage (bookmarks, incidents) is exempt from normal FIFO rollover, but its consumption is capped and monitored. If protected footage crosses the safety watermark, the system raises an emergency `storage.protected_overflow` alert before recording stalls.

---

## 2. Segment Lifecycle State Machine

```
                   [ MediaMTX writes fMP4 to disk ]
                                  │
                                  ▼
                            DISCOVERED
                     (Identified by fast-path
                      event or indexer scan)
                                  │
                                  ▼
                            VALIDATING
                   (Header parsing, duration > 0,
                    size > min, quiet period ok)
                                  │
                   ┌──────────────┴──────────────┐
                   │ Valid                       │ Invalid / Corrupt
                   ▼                             ▼
              CATALOGUED                    QUARANTINED
         (PostgreSQL record created)     (Excluded from catalog,
                   │                      operator flagged)
                   ▼
               AVAILABLE
         (Visible on timeline,
          streamable via /api/media)
                   │
                   ├── Attached to EVENT
                   ├── Locked by INCIDENT (retention bump)
                   ├── Marked by BOOKMARK (exempt from standard FIFO)
                   └── Exported in EVIDENCE BUNDLE (SHA-256 seal)
                   │
                   ▼ (Retention tier expires & no active protections)
                EXPIRED
                   │
                   ▼
                DELETED
           (Unlinked from disk,
            catalog record finalized)
```

### Segment States Definition

| State | Invariants | Transition Trigger |
| :--- | :--- | :--- |
| **`DISCOVERED`** | File exists on filesystem; path is within `RECORDINGS_ROOT`. DB row may not exist yet. | Detected via MediaMTX `runOnRecordSegmentComplete` webhook OR periodic [`SegmentIndexer`](../src/recordings/segment-indexer.ts) scan. |
| **`VALIDATING`** | In-flight check: Container header parseable (`ftyp`/`moov`), `sizeBytes >= 1024`, `duration > 0`, start/end timestamps match filename and clock sanity, file mtime has exceeded quiet period (file is no longer changing). | Discovered file picked up by `SegmentValidator`. |
| **`AVAILABLE`** | Validated, committed to PostgreSQL `recordings` table. Servable via `/api/media/playback/get`. Emits immutable `recording.segment_created` platform event. | Validation succeeds. |
| **`QUARANTINED`** | Segment failed container parsing, 0-byte size, or truncated beyond recovery. Logged and excluded from catalog. | Validation fails after retry. |
| **`EXPIRED`** | Segment age exceeds its effective `retentionTier` (Continuous: 7d, Event: 15d, Incident: 60d) AND `isProtected === false`. | Retention scheduler sweep. |
| **`DELETED`** | File unlinked from storage (`fs.unlink`), record removed from catalog or marked deleted. | Storage FIFO rollover or retention purge. |

---

## 3. Dual-Path Reconciliation Architecture

Capture reliability requires both low event latency and crash-proof consistency:

```
  MediaMTX Process
         │
         ├─── (Fast Path: ~50ms latency)
         │    POST /api/recordings/segments/complete
         │    └─► Fast-path Ingestion Queue ──┐
         │                                    │
         └─── (Zero-transcode writes to disk) │
              /recordings/{path}/{file}.mp4   │
                     │                        ▼
                     │              SegmentValidator.validate()
                     │                        │
  Appliance Reboot   │                        ▼
  or Crash Recovery  │              RecordingCatalog.commit()
                     │                        │
  SegmentIndexer ────┘                        ▼
  (Reconciliation Path: every 30s)    recording.segment_created
  - Watermark sweep                   (Immutable Platform Event)
  - Detects uncatalogued files                │
  - Cleans orphaned DB rows                   ▼
                                      Downstream Consumers
                                 (Timeline, Audit, Incident, AI)
```

1. **Fast Path**: MediaMTX executes HTTP webhook upon finishing an fMP4 segment. Ingestion happens within milliseconds, making video immediately scrubbable on the live timeline.
2. **Reconciliation Path**: Every 30 seconds, [`SegmentIndexer`](../src/recordings/segment-indexer.ts) scans directory trees per camera starting from the recorded watermark (`latestStartTime`). If Node crashed or restarted while MediaMTX kept recording, missed segments are seamlessly discovered, validated, and catalogued.

---

## 4. Storage Health & Pressure State Machine

### A. Health States

```
HEALTHY ──► WARNING ──► CRITICAL ──► WRITE_DEGRADED ──► WRITE_FAILED ──► MOUNT_MISSING
   ▲                                        │
   └────────────────────────────────────────┴──► RECONCILIATION_ERROR
```

- **`HEALTHY`**: Free space above warning threshold, write canary probe passes with latency $< 200\text{ ms}$.
- **`WARNING`**: Disk usage $\ge 80\%$. Operators notified; normal recording continues.
- **`CRITICAL`**: Disk usage $\ge 90\%$. Immediate FIFO rollover triggered to delete unprotected `CONTINUOUS` segments down to target threshold ($80\%$).
- **`WRITE_DEGRADED`**: Write canary latency $> 1000\text{ ms}$ or I/O bottleneck detected. Alerts raised for drive degradation / SMR stall.
- **`WRITE_FAILED`**: Write canary throws `EROFS`, `EACCES`, or `EIO`. Recording engine alerts that captures cannot be committed.
- **`MOUNT_MISSING`**: Recordings mount directory does not exist or statfs fails completely.
- **`RECONCILIATION_ERROR`**: Physical disk files diverge systematically from DB records ($> 5\%$ missing files or catalog mismatches).

### B. Independent Write Canary Probe
Run every 60 seconds (or immediately when storage transitions to `CRITICAL`):
```text
1. Open temp file: /recordings/.probe_{applianceId}_{timestamp}.tmp
2. Write 64 KB pseudo-random pattern.
3. Call fsync() to force flush to physical platter / flash NAND.
4. Measure duration: latencyMs.
5. Close and unlink file.
6. If latency > 1000ms => transition WRITE_DEGRADED.
7. If error thrown => transition WRITE_FAILED.
```

### C. Protected Evidence Storage Quota
To prevent operator bookmarks or long-duration incident locks from starving the 24/7 continuous recording engine:
- **`MAX_PROTECTED_STORAGE_PERCENT`**: Default $25\%$ of total disk capacity.
- **Calculation**:
  $$\text{protectedBytes} = \sum \text{sizeBytes of segments protected by Bookmarks, Incidents, or Exports}$$
- **Protection Pressure Policy**:
  - If $\text{protectedBytes} \ge 25\%$ of disk: Raise `storage.protected_overflow` alert.
  - If disk reaches `CRITICAL` ($90\%$) and unprotected continuous segments are exhausted:
    - **Never silently freeze recording.**
    - System enters `STORAGE_EXHAUSTION_PROTECTION`: Oldest continuous segments are pruned first. If only protected segments remain, system refuses new bookmarks/incident locks and alerts operator with highest severity alarm.

---

## 5. Exact Prisma Schema Additions & Modifications

```prisma
// ============================================================================
// ENUMS
// ============================================================================

enum SegmentStatus {
  DISCOVERED
  VALIDATING
  AVAILABLE
  QUARANTINED
  EXPIRED
  DELETED
}

enum RetentionTier {
  CONTINUOUS   // Base 24/7 footage (default 7 days)
  EVENT        // Motion/sensor triggered (default 15-30 days)
  INCIDENT     // Manually flagged or correlated incident (default 60-90 days)
  PROTECTED    // Bookmarked/legal hold (exempt from FIFO until quota breached)
}

enum StreamRole {
  PRIMARY      // Main high-res recording & single view
  SUB          // Low-res grid view & bandwidth-saving remote
}

enum IncidentSeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum IncidentStatus {
  OPEN
  INVESTIGATING
  RESOLVED
  ARCHIVED
}

// ============================================================================
// RECORDINGS (ENRICHED)
// ============================================================================

model Recording {
  id               String          @id @default(uuid())
  cameraId         String          @map("camera_id")
  camera           Camera          @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  siteId           String?         @map("site_id")
  mediaMtxPath     String          @map("mediamtx_path")
  streamRole       StreamRole      @default(PRIMARY) @map("stream_role")
  filePath         String          @unique @map("file_path")
  fileName         String          @map("file_name")
  startTime        DateTime        @map("start_time")
  endTime          DateTime        @map("end_time")
  duration         Float
  sizeBytes        BigInt          @map("size_bytes")
  format           String          @default("fmp4")
  videoCodec       String          @default("h264") @map("video_codec")
  hasAudio         Boolean         @default(false) @map("has_audio")
  width            Int?
  height           Int?
  fps              Float?
  
  // Lifecycle & Integrity
  status           SegmentStatus   @default(AVAILABLE)
  retentionTier    RetentionTier   @default(CONTINUOUS) @map("retention_tier")
  isProtected      Boolean         @default(false) @map("is_protected")
  protectionReason String?         @map("protection_reason")
  sha256           String?
  validatedAt      DateTime?       @map("validated_at")
  
  // Storage Provider
  storageProvider  String          @default("local") @map("storage_provider")
  storageKey       String?         @map("storage_key")
  
  createdAt        DateTime        @default(now()) @map("created_at")

  // Relationships
  incidentSegments IncidentRecording[]
  processingJobs   ProcessingJob[]
  detections       Detection[]

  @@index([cameraId, startTime])
  @@index([siteId, startTime])
  @@index([status, retentionTier, isProtected])
  @@index([startTime])
  @@map("recordings")
}

// ============================================================================
// INCIDENTS & EVIDENCE CORRELATION
// ============================================================================

model Incident {
  id              String             @id @default(uuid())
  incidentNumber  Int                @default(autoincrement()) @map("incident_number")
  title           String
  description     String?
  severity        IncidentSeverity   @default(MEDIUM)
  status          IncidentStatus     @default(OPEN)
  siteId          String?            @map("site_id")
  primaryCameraId String?            @map("primary_camera_id")
  startTime       DateTime           @map("start_time")
  endTime         DateTime           @map("end_time")
  
  // Audit & Attribution
  createdById     String?            @map("created_by_id")
  createdSource   String             @default("manual") @map("created_source") // "manual", "rule_correlation", "external_api"
  auditSignature  String?            @map("audit_signature") // HMAC of incident core facts
  
  createdAt       DateTime           @default(now()) @map("created_at")
  updatedAt       DateTime           @updatedAt @map("updated_at")

  // Relationships
  recordings      IncidentRecording[]
  events          IncidentEvent[]
  bookmarks       Bookmark[]

  @@index([siteId, startTime])
  @@index([status, severity])
  @@map("incidents")
}

model IncidentRecording {
  id          String    @id @default(uuid())
  incidentId  String    @map("incident_id")
  incident    Incident  @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  recordingId String    @map("recording_id")
  recording   Recording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  lockedAt    DateTime  @default(now()) @map("locked_at")

  @@unique([incidentId, recordingId])
  @@map("incident_recordings")
}

model IncidentEvent {
  id         String   @id @default(uuid())
  incidentId String   @map("incident_id")
  incident   Incident @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  eventId    String   @map("event_id")
  event      Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  addedAt    DateTime @default(now()) @map("added_at")

  @@unique([incidentId, eventId])
  @@map("incident_events")
}
```

---

## 6. Versioned Platform Event Schemas (Zod Contracts)

### A. Immutable `SegmentCreatedEventV1`
This is a general-purpose platform contract declaring that **a valid media segment exists**. It contains no AI-mandating directives.

```typescript
import { z } from 'zod';
import crypto from 'node:crypto';

export const SegmentCreatedEventV1Schema = z.object({
  schemaVersion: z.literal(1).default(1),
  eventType: z.literal('recording.segment_created').default('recording.segment_created'),
  eventId: z.string().default(() => crypto.randomUUID()),
  occurredAt: z.string().datetime().default(() => new Date().toISOString()),

  // Identity & Location
  source: z.object({
    applianceId: z.string().optional(),
    siteId: z.string().nullable().optional(),
    cameraId: z.string().min(1),
  }),

  // Temporal & Identification
  recording: z.object({
    id: z.string().min(1),
    streamRole: z.enum(['PRIMARY', 'SUB']).default('PRIMARY'),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
  }),

  // Media Properties
  media: z.object({
    format: z.literal('fmp4').default('fmp4'),
    videoCodec: z.enum(['h264', 'h265', 'vp8', 'vp9', 'av1']).default('h264'),
    hasAudio: z.boolean().default(false),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
  }),

  // Canonical Storage Location (No hardcoded paths)
  artifact: z.object({
    storageProvider: z.enum(['local', 's3', 'nas']).default('local'),
    storageKey: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().optional(),
  }),

  // Policy & Operational State
  lifecycle: z.object({
    status: z.enum(['AVAILABLE']).default('AVAILABLE'),
    retentionTier: z.enum(['CONTINUOUS', 'EVENT', 'INCIDENT', 'PROTECTED']).default('CONTINUOUS'),
    isProtected: z.boolean().default(false),
  }),

  // Optional Downstream Processing Hints (Advisory only)
  downstreamHints: z.object({
    motionDetected: z.boolean().default(false),
    incidentId: z.string().nullable().optional(),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }).optional(),
});

export type SegmentCreatedEventV1 = z.infer<typeof SegmentCreatedEventV1Schema>;
```

### B. `StorageHealthChangedEventV1`

```typescript
export const StorageHealthChangedEventV1Schema = z.object({
  eventType: z.literal('storage.health_changed').default('storage.health_changed'),
  eventId: z.string().default(() => crypto.randomUUID()),
  timestamp: z.string().datetime(),
  status: z.enum([
    'HEALTHY',
    'WARNING',
    'CRITICAL',
    'WRITE_DEGRADED',
    'WRITE_FAILED',
    'MOUNT_MISSING',
    'RECONCILIATION_ERROR',
  ]),
  previousStatus: z.string().optional(),
  metrics: z.object({
    totalBytes: z.number(),
    freeBytes: z.number(),
    usedBytes: z.number(),
    usedPercent: z.number(),
    protectedBytes: z.number(),
    protectedPercent: z.number(),
    canaryLatencyMs: z.number().nullable(),
  }),
  reason: z.string().optional(),
});
```

---

## 7. Capability-Oriented Camera Adapter Architecture

```
                    ┌─────────────────────────┐
                    │      CameraService      │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ICameraStreamProv.│    │ ICameraDeviceInfo│    │ ICameraPtzContr. │
│- getStreams()    │    │ - getInfo()      │    │ - ptzMove()      │
│  (PRIMARY, SUB)  │    │ - probe()        │    │ - ptzStop()      │
│- hasAudio()      │    └──────────────────┘    │ - presets()      │
└────────┬─────────┘             ▲              └────────┬─────────┘
         │                       │                       │
         ├───────────────────────┴───────────────────────┤
         │                                               │
┌────────┴─────────────┐                       ┌─────────┴────────────┐
│   OnvifCameraAdapter │                       │   RtspCameraAdapter  │
│ (Implements all 5    │                       │ (Implements Stream & │
│   capabilities)      │                       │  DeviceInfo only)    │
└──────────────────────┘                       └──────────────────────┘
```

### Discrete Interface Definitions

```typescript
export interface StreamDescriptor {
  role: 'PRIMARY' | 'SUB';
  rtspUrl: string;
  encoding: 'H264' | 'H265' | 'JPEG';
  resolution?: { width: number; height: number };
  fps?: number;
  hasAudio: boolean;
}

export interface ICameraStreamProvider {
  getStreams(params: CameraConnectionParams): Promise<StreamDescriptor[]>;
}

export interface ICameraDeviceInfo {
  probe(ip: string, port: number, timeoutMs?: number): Promise<boolean>;
  getDeviceInformation(params: CameraConnectionParams): Promise<{
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
    serialNumber?: string;
  }>;
}

export interface ICameraDiscovery {
  discover(timeoutMs?: number): Promise<DiscoveredCamera[]>;
}

export interface ICameraEventProvider {
  subscribeEvents(params: CameraConnectionParams, onEvent: (evt: unknown) => void): Promise<() => Promise<void>>;
}

export interface ICameraPtzController {
  ptzMove(params: CameraConnectionParams, move: PtzMoveParams): Promise<void>;
  ptzStop(params: CameraConnectionParams): Promise<void>;
  getPresets(params: CameraConnectionParams): Promise<CameraPreset[]>;
  gotoPreset(params: CameraConnectionParams, presetToken: string): Promise<void>;
}
```

---

## 8. Refined 5-Phase Roadmap

### Phase 1 — Recording Correctness
- **Goal**: Deterministic, self-healing segment lifecycle and contract.
- **Deliverables**:
  1. Add `SegmentStatus`, `RetentionTier`, and `StreamRole` to Prisma schema + migration.
  2. Implement `SegmentValidator` (container parsing, duration validation, quiet period; strictly no `fsync`).
  3. Upgrade `RecordingCatalog.ingestSegment()` to validate segments and emit updated `SegmentCreatedEventV1`.
  4. Strengthen [`SegmentIndexer`](../src/recordings/segment-indexer.ts) dual-path reconciliation (fast webhook + periodic watermark scan).

### Phase 2 — Storage Reliability
- **Goal**: Resilience against physical disk failure, I/O stalls, and evidence overflow.
- **Deliverables**:
  1. Implement active write canary probe in [`StorageController`](../src/recordings/storage-controller.ts) (64KB write + fsync + latency timer).
  2. Implement storage health state machine (`HEALTHY` $\rightarrow$ `WRITE_DEGRADED` $\rightarrow$ `WRITE_FAILED` $\rightarrow$ `MOUNT_MISSING`).
  3. Implement multi-tier retention policy (`CONTINUOUS`, `EVENT`, `INCIDENT`, `PROTECTED`).
  4. Implement `MAX_PROTECTED_STORAGE_PERCENT` quota ($25\%$) and emergency overflow alerting.

### Phase 3 — Camera / Device Abstraction
- **Goal**: Clean separation of device capabilities and stream profiles.
- **Deliverables**:
  1. Deconstruct `ICameraProvider` into discrete interfaces (`ICameraStreamProvider`, `ICameraDeviceInfo`, etc.).
  2. Formalize `PRIMARY` and `SUB` stream roles across UI, database, and MediaMTX synchronizer.
  3. Decouple `OnvifCameraAdapter` and introduce barebones `RtspCameraAdapter` for generic DVRs/NVRs.

### Phase 4 — Industrial Operations
- **Goal**: Operational multi-sensor event correlation, incident management, and tamper-proof evidence.
- **Deliverables**:
  1. Implement `Incident` domain model in Prisma (`incidents`, `incident_recordings`, `incident_events`).
  2. Build event correlation engine (links `camera.offline`, door contacts, motion, manual operator bookmarks).
  3. Integrate incident timeline directly with [`EvidenceBundleService`](../src/export/evidence-bundle.service.ts) to produce signed SHA-256 ZIP packages.

### Phase 5 — Optional Processing Boundary
- **Goal**: Contain downstream analytics with zero risk to media capture.
- **Deliverables**:
  1. Subscribe [`AiPipelineCoordinator`](../src/ai/ai-pipeline-coordinator.ts) strictly as a consumer of `recording.segment_created`.
  2. Dispatch to PostgreSQL-backed [`ProcessingJobQueue`](../src/jobs/processing-job.queue.ts) with backoff retry.
  3. Guarantee that worker timeouts, crash loops, or missing GPUs never impede MediaMTX or core recording.
