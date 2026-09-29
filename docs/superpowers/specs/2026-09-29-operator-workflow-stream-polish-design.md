# Sub-Project A Design Specification: Operator Workflow & Stream Polish

**Document Version:** 1.0  
**Date:** 2026-09-29  
**Status:** Approved Architectural Baseline  
**Scope:** VMS-Lite Post-MVP Production Elevation (Sub-Project A)  
**Target Hardware:** Edge Mini-PC Appliance (Intel N100 / 8GB RAM / Ubuntu 24.04 LTS / Chromium Web Operator)  

---

## 1. Executive Summary & Objective

VMS-Lite has achieved full MVP parity (Phases 1–21), delivering reliable ONVIF onboarding, packet-preserving continuous and motion-buffered recording, single-camera playback, and self-verifying evidence exports.

**Sub-Project A (Operator Workflow & Stream Polish)** elevates the system into a responsive, high-performance surveillance console. It eliminates browser GPU/CPU decoder exhaustion in multi-camera grids, introduces an NVR-grade synchronized 1–4 camera playback matrix, replicates physical jog-shuttle console hotkeys, and provides a BSA-aware, server-verified snapshot audit pipeline.

---

## 2. Core Architectural Invariants

1. **Recording Invariant (Full Resolution Main-Stream Only)**:
   Adaptive dual-stream switching applies strictly to *live viewing*. MediaMTX recording pipelines (continuous and motion ring buffer) consume the camera's high-resolution `mainStream` RTSP feed exclusively. Sub-streams are never the source of recorded evidentiary footage.
2. **Canonical Time Domain**:
   All internal playback coordination operates in **UTC**, anchored to the server's PostgreSQL recording segment catalog. Camera hardware RTCs are not authoritative for synchronization. The UI formats UTC timestamps into the operator/site timezone (e.g. IST).
3. **Server-Authoritative Cryptographic Auditing**:
   No client-computed hashes are trusted for evidentiary audit logs. Artifact hashes (snapshots, evidence ZIPs) are calculated server-side over the exact persisted bytes.
4. **Client Decode Budget Constraint**:
   Active playback decoders are bounded by an aggregate pixel-throughput budget $(\sum \text{width} \times \text{height} \times \text{FPS})$. On low-spec client hardware (Intel N100), the system rejects unsafe concurrent allocations and gracefully switches to keyframe-sampling rather than dropping synchronization.

---

## 3. Subsystem Specifications

### 3.1 State-Driven Adaptive Dual-Stream Switching

#### 3.1.1 Stream Profile Model
The camera data model explicitly stores the identities of both streams retrieved via ONVIF media profiles or manual configuration:

```typescript
export interface CameraStreamProfile {
  rtspUrl: string;
  mediaMtxPath: string;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
}

export interface CameraProfiles {
  mainProfile: CameraStreamProfile;
  subProfile?: CameraStreamProfile; // Optional: absent on older/budget cameras
}
```

#### 3.1.2 Profile Resolution Engine
The client stream session layer determines the active stream using a state-driven resolution policy:

```text
ViewMode Default:
  • GRID (2x2, 3x3)      → preferred = SUB
  • FOCUSED (1x1)        → preferred = MAIN
  • FULLSCREEN           → preferred = MAIN

Operator Override:
  • AUTO | SD | HD

Resolution Formula:
  effectiveStream = (operatorOverride !== 'AUTO')
    ? operatorOverride
    : (camera.hasSubProfile ? viewModeDefault : 'MAIN');
```

- **Fallback**: If `subProfile` is absent, the system defaults to `MAIN` with a non-interactive `"HD Only"` badge on the tile.
- **On-Demand Pulling**: Sub-stream paths in MediaMTX configure `sourceOnDemand: yes`. RTSP sessions to the camera's sub-stream are established only while at least one operator tile subscribes to it.

#### 3.1.3 Dual-Layer Cross-Fade Transition
To prevent black flashes during stream switching (e.g., Grid $\to$ Fullscreen):
1. The player maintains dual `<video>` elements (SUB layer and MAIN layer).
2. While in grid view, SUB is visible (`opacity: 1`), MAIN is unmounted/dormant.
3. Upon tile focus, the player starts the WebRTC (WHEP) negotiation for MAIN in the background while SUB continues rendering.
4. When MAIN decodes its first usable I-frame (`HTMLVideoElement.videoWidth > 0` and `currentTime > 0`):
   - MAIN fades in: `opacity: 0 → 1` (150ms CSS transition).
   - SUB fades out: `opacity: 1 → 0` and tears down its WebRTC connection.
5. Perceived transition latency target: $\le 1.0\text{s}$.

---

### 3.2 Dedicated 1–4 Camera Synchronized Playback Matrix

#### 3.2.1 Playback Session Architecture
Playback supports 1 to 4 cameras arranged in a flexible $1\times 1$, $1\times 2$, or $2\times 2$ grid.

```text
MasterPlaybackController (Context)
  │
  ├── Canonical Wall-Clock: targetTimestamp (UTC Date)
  ├── Playback State: IDLE | BUFFERING | PLAYING | PAUSED | STALLED
  ├── Active Channels: [Cam01, Cam02, Cam03, Cam04] (Max 4)
  │
  └── Playback Channel Engine (per camera)
        ├── Absolute Time Mapping:
        │     playerAbsoluteTime = segment.recordingStart + videoElement.currentTime
        │     skew = Math.abs(playerAbsoluteTime - targetTimestamp)
        │
        ├── Sync Guard:
        │     if (skew > 200ms) → videoElement.currentTime = targetTimestamp - segment.recordingStart
        │
        └── Stall Lock:
              if (any player buffers) → broadcast PAUSE to all; resume only when all ready
```

#### 3.2.2 Time Mapping & Absolute Timestamp Seeking
- Scrubbing updates `targetTimestamp` (UTC).
- For each camera, the catalog queries the segment containing `targetTimestamp`.
- If a segment exists, the player seeks to `offsetSeconds = (targetTimestamp - segment.startTime) / 1000`.
- If no recording exists for a camera at `targetTimestamp`, the tile renders an explicit `"No Recording"` gap card. It never freezes on stale frames or renders black.

#### 3.2.3 Multi-Lane Timeline Activity Visualization
Underneath the $2\times 2$ playback grid, the timeline renders stacked, aligned activity lanes corresponding to the active cameras:

```text
14:30:00          14:31:00          14:32:00          14:33:00 (UTC)
[CAM 01]  ██████████████████████████████████████████████████
[CAM 02]            ░░░░░░░░░░░░            ████████████████
[CAM 03]  ██████████████████████████████
[CAM 04]                      [★ Bookmark]  ████████████████
                              ▲
                       Scrubber Cursor
```
- Solid Green (`██`): Continuous recording.
- Amber Shading (`░░`): ONVIF motion incident block.
- Blue Marker (`★`): User incident bookmark.
- Empty Track: Recording gap (offline or unscheduled).

#### 3.2.4 Decode Budget & Degradation Hierarchy
- Client budget: Bounded by aggregate throughput $(\le 4 \times 1080\text{p} @ 25\text{FPS} \approx 207\text{M pixels/sec})$.
- If an operator attempts to add a 5th camera: The UI rejects the action with a clear warning: `"Maximum 4 synchronized playback channels supported."`
- If client decode latency exceeds frame interval: The controller lowers playback resolution profile or keyframe-samples before ever allowing cameras to desynchronize.

---

### 3.3 CCTV Keyboard Hotkeys & Jog-Shuttle Transport

#### 3.3.1 Context-Aware Keymap State Machine

| Key | Context | Action | Behavior / Semantics |
| :--- | :--- | :--- | :--- |
| `Space` | Playback | Toggle Play/Pause | Toggles between `PAUSED` and forward `1×` playback across all active synced tiles. `preventDefault()` applied to prevent double-firing focused buttons. |
| `J` | Playback | Reverse Shuttle | Cycles reverse speed: $-1\times \to -2\times \to -4\times \to -8\times$ via keyframe hopping. If moving forward, steps speed down toward zero. |
| `K` | Playback | Stop Shuttle | Enters `PAUSED` state immediately; resets shuttle multiplier to 0. |
| `L` | Playback | Forward Shuttle | Cycles forward speed: $1\times \to 2\times \to 4\times \to 8\times$. If in reverse, steps speed up toward zero. Switches to keyframe-sampling at $4\times/8\times$ if decode budget requires. |
| `←` / `→` | Playback | Step | **Playing:** Skips $\pm 5\text{s}$ with 60ms seek-coalescing. **Paused:** Seeks to previous/next available decoded frame. |
| `Shift` + `←` / `→` | Playback | Event Jump | Jumps directly to previous/next event (motion block or bookmark). If none exist, shows HUD: `[No Earlier Event]` / `[No Later Event]`. |
| `1` – `9` | Both | Channel Focus | Instantly switches view to single-camera focus for Channel $1\dots 9$. Preserves timeline position and 2x2 selection. |
| `0` or `Esc` | Both | Grid Return | Returns from single-camera focus back to multi-camera grid without resetting timeline position or channel selection. |
| `G` | Both | Quick Channel Switcher | Opens modal palette listing all channels ($1\dots 16+$) with filter search. |
| `F` | Both | Kiosk Fullscreen | Toggles true fullscreen mode for active tile or entire grid. |
| `S` | Both | Audited Snapshot | Captures current video frame, submits to server for SHA-256 calculation and audit logging, and downloads verified image. |
| `?` | Both | Keyboard Cheat Sheet | Opens modal displaying keyboard shortcuts. Evaluated on `event.key === '?'`. |

#### 3.3.2 Browser Shortcut Passthrough & Input Guard
The global keyboard listener immediately bypasses hotkey handling if:
1. `event.ctrlKey || event.altKey || event.metaKey` is `true` (preserving browser shortcuts like `Ctrl+S`, `Cmd+R`, `Ctrl+F`).
2. `event.target` is an `HTMLInputElement`, `HTMLTextAreaElement`, or `HTMLSelectElement`.
3. `event.target` is an interactive control (`button`, `slider`) and key is `Space`—`event.preventDefault()` ensures only VMS playback toggles without triggering duplicate button clicks.

#### 3.3.3 Transient HUD Overlay
Transport and seek operations render an accessible, non-intrusive floating badge centered on the player (auto-fading after 800ms):
- Element attributes: `role="status"`, `aria-live="polite"`.
- Animation: Disabled when `prefers-reduced-motion` media query matches.
- Badges: `[ +5s ]`, `[ -5s ]`, `[ Frame +1 ]`, `[ Frame -1 ]`, `[ 2x KF ⏩ ]`, `[ 1x KF ⏪ ]`, `[ No Earlier Event ]`.
- Re-sync badge: `[ Re-syncing ±Xms ]` renders only if clock correction exceeds $150\text{ms}$ threshold to eliminate visual flicker.

---

### 3.4 Snapshot Audit Trail Pipeline (BSA-Aware Evidence Audit)

#### 3.4.1 Capture & Verification Sequence
To maintain an unbroken audit trail for snapshots extracted from live or recorded video:

```text
Operator presses 'S'
       │
1. Browser extracts video frame via canvas.toBlob('image/jpeg', 0.95)
       │
2. POST /api/audit/snapshot (multipart/form-data)
   Payload:
     - image: File (raw JPEG binary)
     - cameraId: string
     - timestampUtc: string (ISO 8601)
     - streamProfile: "MAIN" | "SUB"
     - resolution: "1920x1080" | "640x360"
     - playbackSegmentId?: string (if captured from playback)
     - mediaOffsetSeconds?: number
       │
3. Server Processing (Audit Controller):
     - Authenticates user session from JWT; extracts userId and username.
     - Enforces RBAC capability check (operator.snapshot).
     - Applies TokenBucket rate limiter (max 5 snapshots per 10 seconds per user).
     - Computes SHA-256 hash over exact persisted bytes.
     - Persists JPEG to storage: /var/recordings/snapshots/SNAP_{cameraId}_{timestamp}_{hash8}.jpg
     - Inserts record into database 'audit_logs' table.
       │
4. Response to Client:
   HTTP 201 Created:
   {
     "id": "audit-snap-8841",
     "sha256": "4b227777d4da1fc...",
     "filename": "SNAPSHOT_Cam02_20260929T143218Z.jpg",
     "downloadUrl": "/api/audit/snapshot/audit-snap-8841/download"
   }
       │
5. Browser triggers file download & displays success toast:
   "✓ Snapshot saved & audited (SHA: 4b2277...)"
```

*Fail-Loud Guarantee*: If the upload fails, server rejects the payload, or disk write fails, the browser displays an explicit error toast and triggers no file download.

---

## 4. Database Schema Updates (Prisma)

```prisma
// Extension to Camera model for dual-stream ONVIF profiles
model Camera {
  id             String    @id @default(uuid())
  name           String
  ip             String?
  port           Int?      @default(554)
  rtspUrl        String    // Main stream RTSP
  subRtspUrl     String?   // Sub-stream RTSP
  mediaMtxPath   String    @unique
  subMediaMtxPath String?  @unique
  // ... existing fields ...
}

// Audit Log Model for BSA-aware compliance tracking
model AuditLog {
  id                 String   @id @default(uuid())
  userId             String
  username           String
  action             String   // "SNAPSHOT_CAPTURED", "PLAYBACK_VIEWED", "EVIDENCE_EXPORTED"
  cameraId           String?
  timestampUtc       DateTime
  streamProfile      String?  // "MAIN", "SUB"
  resolution         String?  // e.g. "1920x1080"
  playbackSegmentId  String?
  mediaOffsetSeconds Float?
  sha256             String?
  filePath           String?
  clientIp           String
  createdAt          DateTime @default(now())

  @@index([cameraId, timestampUtc])
  @@index([userId, createdAt])
}
```

---

## 5. Verification & Acceptance Criteria

1. **Dual-Stream Switching**:
   - Grid rendering 4 cameras requests `subMediaMtxPath` on MediaMTX.
   - Expanding tile to 1×1 cross-fades from SUB to MAIN in $\le 1.0\text{s}$ with zero black frame interruption.
   - Recording continues uninterrupted on `mainMediaMtxPath` during all switching operations.
2. **Synchronized Playback Matrix**:
   - 4 cameras scrubbing concurrently stay locked within $\pm 200\text{ms}$ of master UTC timeline.
   - Inducing network stall on 1 player holds the remaining 3 players in paused buffer state with HUD spinner.
   - Gaps render explicit `"No Recording"` card.
3. **Keyboard Controls**:
   - `J`/`K`/`L` correctly increments/decrements shuttle speeds and stops cleanly.
   - Arrow keys skip 5s when playing and single decoded frames when paused.
   - Rapid arrow-key presses coalesce within 60ms without queuing redundant requests.
   - Modals and text inputs completely suppress hotkey triggers.
4. **Snapshot Audit**:
   - Canvas snapshot uploads raw JPEG bytes.
   - Server computes SHA-256, writes row to `AuditLog`, and verifies stored file integrity before download.
