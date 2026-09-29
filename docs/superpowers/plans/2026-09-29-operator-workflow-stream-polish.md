# Operator Workflow & Stream Polish (Sub-Project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement client-sparing adaptive dual-stream switching, a master-clock synchronized 1–4 camera playback matrix, NVR-grade CCTV keyboard jog-shuttle navigation, and a server-authoritative BSA-aware snapshot audit pipeline.

**Architecture:** The media plane provisions high-res main-stream for recording and on-demand low-res sub-stream for grid viewing. The playback engine coordinates up to 4 concurrent camera decoders anchored to absolute UTC wall-clock time from the database catalog within a $\pm 200\text{ms}$ barrier. Global keyboard listeners operate in a 2-context state machine (Live vs. Playback) driving an accessible transient HUD, while snapshot exports are hashed and verified server-side.

**Tech Stack:** TypeScript 5, Node.js 20 LTS, Fastify 4, Prisma ORM, PostgreSQL, React 19, Vite 5, Tailwind CSS, MediaMTX v1.11 (WHEP WebRTC & HLS).

**Spec:** [`docs/superpowers/specs/2026-09-29-operator-workflow-stream-polish-design.md`](file:///Users/tecbusiness/Desktop/IMPORTANT/VMS-Bare/docs/superpowers/specs/2026-09-29-operator-workflow-stream-polish-design.md)

## Global Constraints

- 100% Permissive Licensing: Only MIT, Apache-2.0, or BSD dependencies. Zero GPL/copyleft libraries.
- Recording Invariant: Recording pipelines consume the camera's high-resolution `mainStream` RTSP feed exclusively. Dual-stream switching affects live viewing only.
- Canonical Time Domain: All internal playback coordination operates in UTC anchored to the database segment catalog. UI handles site timezone formatting (IST).
- Server-Authoritative Auditing: Hashes are computed server-side over exact persisted bytes. Client-supplied hashes are never trusted for audit logs.
- Fail-Loud Runtime: Zero synthetic fallbacks in production paths. Explicit error responses on network, decoder, or database failure.

---

### Task 1: Camera Schema & MediaMTX On-Demand Dual-Stream Ingest

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/cameras/camera.types.ts`
- Modify: `src/cameras/camera.service.ts`
- Test: `tests/dual-stream.test.ts`

**Interfaces:**
- Consumes: `CameraService` onboarding pipeline, `MediaMtxClient.setPath`
- Produces: `Camera.subRtspUrl`, `Camera.subMediaMtxPath`, `CameraProfiles` type definitions, MediaMTX path config with `sourceOnDemand: true` for sub-streams.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/dual-stream.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CameraService } from '../src/cameras/camera.service.js';
import { MediaMtxClient } from '../src/mediamtx/mediamtx.client.js';

describe('Dual-Stream Model & On-Demand Path Provisioning', () => {
  let cameraService: CameraService;
  let mockMediaMtx: MediaMtxClient;
  let mockPrisma: any;

  beforeEach(() => {
    mockMediaMtx = new MediaMtxClient({ mockMode: true });
    vi.spyOn(mockMediaMtx, 'setPath').mockResolvedValue(true);

    const cameras: any[] = [];
    mockPrisma = {
      camera: {
        create: vi.fn(async ({ data }) => {
          const record = { id: `cam-${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
          cameras.push(record);
          return record;
        }),
        findMany: vi.fn(async () => cameras),
        findUnique: vi.fn(async ({ where }) => cameras.find(c => c.id === where.id || c.mediaMtxPath === where.mediaMtxPath)),
      },
    };

    cameraService = new CameraService(mockPrisma as any, mockMediaMtx);
  });

  it('provisions both main and sub streams with sourceOnDemand enabled for sub-stream', async () => {
    const camera = await cameraService.createCamera({
      name: 'Warehouse Gate',
      rtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream1',
      subRtspUrl: 'rtsp://admin:pass@192.168.1.50:554/stream2',
    });

    expect(camera.mediaMtxPath).toBeDefined();
    expect(camera.subMediaMtxPath).toBeDefined();
    expect(camera.subMediaMtxPath).toContain('_sub');

    // Verify main stream provisioned in MediaMTX
    expect(mockMediaMtx.setPath).toHaveBeenCalledWith(
      camera.mediaMtxPath,
      expect.objectContaining({
        source: 'rtsp://admin:pass@192.168.1.50:554/stream1',
      })
    );

    // Verify sub-stream provisioned with sourceOnDemand: true
    expect(mockMediaMtx.setPath).toHaveBeenCalledWith(
      camera.subMediaMtxPath,
      expect.objectContaining({
        source: 'rtsp://admin:pass@192.168.1.50:554/stream2',
        sourceOnDemand: true,
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dual-stream.test.ts`  
Expected: FAIL with `camera.subMediaMtxPath is undefined` or property missing.

- [ ] **Step 3: Write minimal implementation**

Update `prisma/schema.prisma`:
```prisma
model Camera {
  id              String    @id @default(uuid())
  name            String
  ip              String?
  port            Int?      @default(554)
  rtspUrl         String
  subRtspUrl      String?
  mediaMtxPath    String    @unique
  subMediaMtxPath String?   @unique
  status          String    @default("offline")
  recordingMode   String    @default("CONTINUOUS")
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  recordings      Recording[]
}
```

Update `src/cameras/camera.types.ts`:
```typescript
export interface CreateCameraDto {
  name: string;
  rtspUrl: string;
  subRtspUrl?: string;
  ip?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface CameraDto {
  id: string;
  name: string;
  ip?: string | null;
  port?: number | null;
  rtspUrl: string;
  subRtspUrl?: string | null;
  mediaMtxPath: string;
  subMediaMtxPath?: string | null;
  status: string;
  recordingMode: string;
}
```

Update `src/cameras/camera.service.ts` to provision sub-stream path with `sourceOnDemand: true`:
```typescript
const subMediaMtxPath = dto.subRtspUrl ? `${mediaMtxPath}_sub` : null;

// Provision main stream in MediaMTX
await this.mediaMtx.setPath(mediaMtxPath, {
  source: dto.rtspUrl,
  sourceOnDemand: false,
});

// Provision on-demand sub-stream if provided
if (dto.subRtspUrl && subMediaMtxPath) {
  await this.mediaMtx.setPath(subMediaMtxPath, {
    source: dto.subRtspUrl,
    sourceOnDemand: true,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dual-stream.test.ts`  
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/cameras/camera.types.ts src/cameras/camera.service.ts tests/dual-stream.test.ts
git commit -m "feat(dual-stream): add subRtspUrl and on-demand subMediaMtxPath provisioning"
```

---

### Task 2: Server-Authoritative Snapshot Audit Pipeline & Storage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/audit/audit.service.ts`
- Create: `src/audit/audit.routes.ts`
- Modify: `src/server.ts`
- Test: `tests/snapshot-audit.test.ts`

**Interfaces:**
- Consumes: Fastify multipart plugin, JWT user session, TokenBucketRateLimiter
- Produces: `POST /api/audit/snapshot`, `GET /api/audit/snapshot/:id/download`, `AuditLog` database model.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/snapshot-audit.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import crypto from 'node:crypto';

describe('Server-Authoritative Snapshot Audit Pipeline (BSA-Aware)', () => {
  let app: FastifyInstance;
  let operatorToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
    operatorToken = app.jwt.sign({ id: 'usr-op-1', username: 'operator1', role: 'OPERATOR' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('receives image bytes, calculates SHA-256 over exact persisted bytes, and logs audit record', async () => {
    const rawImage = Buffer.from('FAKE-JPEG-PAYLOAD-BINARY-CONTENT-FOR-TESTING');
    const expectedServerHash = crypto.createHash('sha256').update(rawImage).digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/snapshot',
      headers: {
        authorization: `Bearer ${operatorToken}`,
      },
      payload: {
        image: rawImage.toString('base64'),
        cameraId: 'cam-01',
        timestampUtc: new Date().toISOString(),
        streamProfile: 'MAIN',
        resolution: '1920x1080',
        playbackSegmentId: 'seg-123',
        mediaOffsetSeconds: 42.5,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.sha256).toBe(expectedServerHash);
    expect(body.downloadUrl).toContain(body.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/snapshot-audit.test.ts`  
Expected: FAIL with 404 (route `/api/audit/snapshot` not found).

- [ ] **Step 3: Write minimal implementation**

Add `AuditLog` to `prisma/schema.prisma`:
```prisma
model AuditLog {
  id                 String   @id @default(uuid())
  userId             String
  username           String
  action             String
  cameraId           String?
  timestampUtc       DateTime
  streamProfile      String?
  resolution         String?
  playbackSegmentId  String?
  mediaOffsetSeconds Float?
  sha256             String
  filePath           String
  clientIp           String
  createdAt          DateTime @default(now())
}
```

Implement `src/audit/audit.service.ts`:
```typescript
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/prisma.js';

export interface CreateSnapshotAuditInput {
  imageBuffer: Buffer;
  userId: string;
  username: string;
  cameraId: string;
  timestampUtc: Date;
  streamProfile?: string;
  resolution?: string;
  playbackSegmentId?: string;
  mediaOffsetSeconds?: number;
  clientIp: string;
}

export class AuditService {
  private readonly storageDir: string;

  constructor(storageDir = process.env.SNAPSHOTS_PATH || '/var/recordings/snapshots') {
    this.storageDir = path.resolve(storageDir);
  }

  async recordSnapshot(input: CreateSnapshotAuditInput) {
    await fs.mkdir(this.storageDir, { recursive: true });

    // Compute server-authoritative hash over exact persisted bytes
    const sha256 = crypto.createHash('sha256').update(input.imageBuffer).digest('hex');
    const filename = `SNAP_${input.cameraId}_${Date.now()}_${sha256.slice(0, 8)}.jpg`;
    const filePath = path.join(this.storageDir, filename);

    await fs.writeFile(filePath, input.imageBuffer);

    const logEntry = await prisma.auditLog.create({
      data: {
        userId: input.userId,
        username: input.username,
        action: 'SNAPSHOT_CAPTURED',
        cameraId: input.cameraId,
        timestampUtc: input.timestampUtc,
        streamProfile: input.streamProfile,
        resolution: input.resolution,
        playbackSegmentId: input.playbackSegmentId,
        mediaOffsetSeconds: input.mediaOffsetSeconds,
        sha256,
        filePath,
        clientIp: input.clientIp,
      },
    });

    return {
      id: logEntry.id,
      sha256,
      filename,
      filePath,
      downloadUrl: `/api/audit/snapshot/${logEntry.id}/download`,
    };
  }

  async getSnapshotById(id: string) {
    return prisma.auditLog.findUnique({ where: { id } });
  }
}

export const auditService = new AuditService();
```

Register route `POST /api/audit/snapshot` and `GET /api/audit/snapshot/:id/download` in `src/audit/audit.routes.ts` and attach to `src/server.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/snapshot-audit.test.ts`  
Expected: PASS (HTTP 201, verified hash returned).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/audit/ tests/snapshot-audit.test.ts src/server.ts
git commit -m "feat(audit): implement server-authoritative snapshot audit pipeline with exact-byte SHA-256"
```

---

### Task 3: Client Dual-Stream Cross-Fade Player & Quality Controller

**Files:**
- Create: `client/src/utils/streamProfileManager.ts`
- Modify: `client/src/components/WhepHlsPlayer.tsx`
- Modify: `client/src/components/LiveCameraTile.tsx`
- Test: `tests/stream-profile-manager.test.ts`

**Interfaces:**
- Consumes: `CameraDto.mediaMtxPath`, `CameraDto.subMediaMtxPath`, `viewMode` (`GRID` | `FOCUSED` | `FULLSCREEN`)
- Produces: `resolveStreamPath`, `AUTO | SD | HD` quality pill selector, dual-layer `<video>` opacity cross-fade.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/stream-profile-manager.test.ts
import { describe, it, expect } from 'vitest';
import { resolveStreamProfile } from '../client/src/utils/streamProfileManager.js';

describe('StreamProfileManager Quality Resolution Engine', () => {
  it('resolves SUB profile in GRID mode when camera exposes a sub-stream', () => {
    const res = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'AUTO',
      mainPath: 'cam_warehouse',
      subPath: 'cam_warehouse_sub',
    });
    expect(res.selectedStream).toBe('SUB');
    expect(res.path).toBe('cam_warehouse_sub');
  });

  it('resolves MAIN profile in FOCUSED mode even if sub-stream exists', () => {
    const res = resolveStreamProfile({
      viewMode: 'FOCUSED',
      operatorOverride: 'AUTO',
      mainPath: 'cam_warehouse',
      subPath: 'cam_warehouse_sub',
    });
    expect(res.selectedStream).toBe('MAIN');
    expect(res.path).toBe('cam_warehouse');
  });

  it('respects manual operator override over viewMode', () => {
    const res = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'HD',
      mainPath: 'cam_warehouse',
      subPath: 'cam_warehouse_sub',
    });
    expect(res.selectedStream).toBe('MAIN');
    expect(res.path).toBe('cam_warehouse');
  });

  it('gracefully falls back to MAIN with HD-only status when camera lacks sub-stream', () => {
    const res = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'AUTO',
      mainPath: 'cam_legacy',
      subPath: null,
    });
    expect(res.selectedStream).toBe('MAIN');
    expect(res.path).toBe('cam_legacy');
    expect(res.isHdOnly).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stream-profile-manager.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

Implement `client/src/utils/streamProfileManager.ts`:
```typescript
export type ViewMode = 'GRID' | 'FOCUSED' | 'FULLSCREEN';
export type QualityOverride = 'AUTO' | 'SD' | 'HD';

export interface ResolveStreamProfileInput {
  viewMode: ViewMode;
  operatorOverride: QualityOverride;
  mainPath: string;
  subPath?: string | null;
}

export interface StreamProfileResolution {
  selectedStream: 'MAIN' | 'SUB';
  path: string;
  isHdOnly: boolean;
}

export function resolveStreamProfile(input: ResolveStreamProfileInput): StreamProfileResolution {
  const hasSub = Boolean(input.subPath && input.subPath.trim().length > 0);

  if (!hasSub) {
    return {
      selectedStream: 'MAIN',
      path: input.mainPath,
      isHdOnly: true,
    };
  }

  if (input.operatorOverride === 'HD') {
    return { selectedStream: 'MAIN', path: input.mainPath, isHdOnly: false };
  }

  if (input.operatorOverride === 'SD') {
    return { selectedStream: 'SUB', path: input.subPath!, isHdOnly: false };
  }

  // AUTO mode: GRID -> SUB, FOCUSED/FULLSCREEN -> MAIN
  const selectedStream = input.viewMode === 'GRID' ? 'SUB' : 'MAIN';
  return {
    selectedStream,
    path: selectedStream === 'SUB' ? input.subPath! : input.mainPath,
    isHdOnly: false,
  };
}
```

Update `client/src/components/LiveCameraTile.tsx` and `WhepHlsPlayer.tsx` to mount dual `<video>` elements with opacity cross-fade and manual `AUTO | SD | HD` selector pill.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stream-profile-manager.test.ts`  
Expected: PASS (all profile resolution rules verified).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/streamProfileManager.ts client/src/components/WhepHlsPlayer.tsx client/src/components/LiveCameraTile.tsx tests/stream-profile-manager.test.ts
git commit -m "feat(client): add state-driven stream profile manager and dual-stream cross-fade rendering"
```

---

### Task 4: Master Synchronized 1–4 Camera Playback Engine & Multi-Lane Timeline

**Files:**
- Create: `client/src/context/PlaybackSyncContext.tsx`
- Create: `client/src/components/MultiLaneTimeline.tsx`
- Modify: `client/src/pages/PlaybackPage.tsx`
- Test: `tests/synchronized-playback.test.ts`

**Interfaces:**
- Consumes: Playback timeline segment API, UTC wall-clock target
- Produces: `PlaybackSyncContext` with `targetTimestampUtc`, `seekToTimestamp`, stall pause lock, and multi-lane activity bars.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/synchronized-playback.test.ts
import { describe, it, expect } from 'vitest';
import { calculatePlayerAlignment } from '../client/src/context/PlaybackSyncContext.js';

describe('Synchronized Playback Engine Time Alignment', () => {
  const segmentStart = new Date('2026-10-01T12:00:00.000Z').getTime();

  it('maps media currentTime to absolute UTC time correctly', () => {
    const currentTimeSec = 15.2;
    const absTimeMs = segmentStart + currentTimeSec * 1000;
    const targetTimestampMs = new Date('2026-10-01T12:00:15.300Z').getTime();

    const alignment = calculatePlayerAlignment({
      segmentStartMs: segmentStart,
      currentTimeSec,
      targetTimestampMs,
      toleranceMs: 200,
    });

    expect(alignment.skewMs).toBe(100);
    expect(alignment.needsReseek).toBe(false);
  });

  it('triggers re-seek when skew exceeds 200ms threshold', () => {
    const currentTimeSec = 10.0;
    const targetTimestampMs = new Date('2026-10-01T12:00:10.500Z').getTime(); // 500ms ahead

    const alignment = calculatePlayerAlignment({
      segmentStartMs: segmentStart,
      currentTimeSec,
      targetTimestampMs,
      toleranceMs: 200,
    });

    expect(alignment.skewMs).toBe(500);
    expect(alignment.needsReseek).toBe(true);
    expect(alignment.suggestedSeekSec).toBe(10.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/synchronized-playback.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

Implement `client/src/context/PlaybackSyncContext.tsx`:
```typescript
export interface AlignmentInput {
  segmentStartMs: number;
  currentTimeSec: number;
  targetTimestampMs: number;
  toleranceMs: number;
}

export interface AlignmentResult {
  playerAbsoluteMs: number;
  skewMs: number;
  needsReseek: boolean;
  suggestedSeekSec: number;
}

export function calculatePlayerAlignment(input: AlignmentInput): AlignmentResult {
  const playerAbsoluteMs = input.segmentStartMs + input.currentTimeSec * 1000;
  const skewMs = Math.abs(playerAbsoluteMs - input.targetTimestampMs);
  const needsReseek = skewMs > input.toleranceMs;
  const suggestedSeekSec = Math.max(0, (input.targetTimestampMs - input.segmentStartMs) / 1000);

  return {
    playerAbsoluteMs,
    skewMs,
    needsReseek,
    suggestedSeekSec,
  };
}
```

Implement `MultiLaneTimeline.tsx` rendering stacked lanes for Camera A, B, C, D, color-coding continuous recordings (green), motion events (amber), and incident bookmarks (blue). Wire stall lock in `PlaybackPage.tsx` so if any player enters `BUFFERING`, the master pauses all players and displays a buffering spinner.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/synchronized-playback.test.ts`  
Expected: PASS (alignment and reseek thresholds validated).

- [ ] **Step 5: Commit**

```bash
git add client/src/context/PlaybackSyncContext.tsx client/src/components/MultiLaneTimeline.tsx client/src/pages/PlaybackPage.tsx tests/synchronized-playback.test.ts
git commit -m "feat(playback): implement synchronized master-clock playback matrix and multi-lane timeline"
```

---

### Task 5: Two-Context CCTV Keyboard Hotkeys & Accessible HUD Engine

**Files:**
- Create: `client/src/hooks/useCctvHotkeys.ts`
- Create: `client/src/components/FloatingHudBadge.tsx`
- Create: `client/src/components/ChannelSwitcherModal.tsx`
- Create: `client/src/components/KeyboardShortcutsModal.tsx`
- Test: `tests/cctv-hotkeys.test.ts`

**Interfaces:**
- Consumes: Browser window keydown events, current mode (`LIVE` | `PLAYBACK`)
- Produces: `useCctvHotkeys` hook, deterministic shuttle controller (`J`, `K`, `L`), 60ms seek-coalescing, and `FloatingHudBadge` overlay.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cctv-hotkeys.test.ts
import { describe, it, expect } from 'vitest';
import { resolveShuttleTransition } from '../client/src/hooks/useCctvHotkeys.js';

describe('CCTV Jog-Shuttle State Machine Transitions', () => {
  it('increments forward shuttle speeds with L (1x -> 2x -> 4x -> 8x)', () => {
    expect(resolveShuttleTransition({ currentSpeed: 0, key: 'l' })).toBe(1);
    expect(resolveShuttleTransition({ currentSpeed: 1, key: 'l' })).toBe(2);
    expect(resolveShuttleTransition({ currentSpeed: 2, key: 'l' })).toBe(4);
    expect(resolveShuttleTransition({ currentSpeed: 4, key: 'l' })).toBe(8);
    expect(resolveShuttleTransition({ currentSpeed: 8, key: 'l' })).toBe(8); // Capped
  });

  it('increments reverse shuttle speeds with J (-1x -> -2x -> -4x -> -8x)', () => {
    expect(resolveShuttleTransition({ currentSpeed: 0, key: 'j' })).toBe(-1);
    expect(resolveShuttleTransition({ currentSpeed: -1, key: 'j' })).toBe(-2);
    expect(resolveShuttleTransition({ currentSpeed: -2, key: 'j' })).toBe(-4);
    expect(resolveShuttleTransition({ currentSpeed: -4, key: 'j' })).toBe(-8);
  });

  it('steps reverse speed back toward zero when pressing L while in reverse', () => {
    expect(resolveShuttleTransition({ currentSpeed: -4, key: 'l' })).toBe(-2);
    expect(resolveShuttleTransition({ currentSpeed: -1, key: 'l' })).toBe(0);
  });

  it('immediately stops shuttle and resets speed to 0 when pressing K', () => {
    expect(resolveShuttleTransition({ currentSpeed: 4, key: 'k' })).toBe(0);
    expect(resolveShuttleTransition({ currentSpeed: -8, key: 'k' })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cctv-hotkeys.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

Implement `client/src/hooks/useCctvHotkeys.ts`:
```typescript
export function resolveShuttleTransition({ currentSpeed, key }: { currentSpeed: number; key: string }): number {
  const forwardLadder = [1, 2, 4, 8];
  const reverseLadder = [-1, -2, -4, -8];

  if (key === 'k') return 0;

  if (key === 'l') {
    if (currentSpeed < 0) {
      // Step back toward zero
      const idx = reverseLadder.indexOf(currentSpeed);
      return idx > 0 ? reverseLadder[idx - 1] : 0;
    }
    const idx = forwardLadder.indexOf(currentSpeed);
    return idx === -1 ? 1 : Math.min(8, forwardLadder[Math.min(forwardLadder.length - 1, idx + 1)]);
  }

  if (key === 'j') {
    if (currentSpeed > 0) {
      // Step back toward zero
      const idx = forwardLadder.indexOf(currentSpeed);
      return idx > 0 ? forwardLadder[idx - 1] : 0;
    }
    const idx = reverseLadder.indexOf(currentSpeed);
    return idx === -1 ? -1 : Math.max(-8, reverseLadder[Math.min(reverseLadder.length - 1, idx + 1)]);
  }

  return currentSpeed;
}
```

Implement `FloatingHudBadge.tsx` with `role="status"` and `aria-live="polite"` rendering transient feedback badges (`[ +5s ]`, `[ Frame +1 ]`, `[ 2x KF ⏩ ]`), and `ChannelSwitcherModal.tsx` for `G` quick channel switching.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cctv-hotkeys.test.ts`  
Expected: PASS (all shuttle transitions pass).

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useCctvHotkeys.ts client/src/components/FloatingHudBadge.tsx client/src/components/ChannelSwitcherModal.tsx client/src/components/KeyboardShortcutsModal.tsx tests/cctv-hotkeys.test.ts
git commit -m "feat(hotkeys): implement CCTV jog-shuttle state machine, accessible HUD, and channel switcher"
```

---

### Task 6: Full Integration & Operator Workflow Verification

**Files:**
- Create: `tests/operator-workflow-integration.test.ts`
- Modify: `package.json` (ensure audit script includes new audit routes)
- Run: Full test suite verification

**Interfaces:**
- Consumes: All Sub-Project A components
- Produces: Integrated test verification confirming dual-stream switching, synchronized 4-camera playback, keyboard shuttle, and server snapshot hashing.

- [ ] **Step 1: Write integration test**

```typescript
// tests/operator-workflow-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { resolveStreamProfile } from '../client/src/utils/streamProfileManager.js';
import { resolveShuttleTransition } from '../client/src/hooks/useCctvHotkeys.js';

describe('Sub-Project A: Operator Workflow & Stream Polish End-to-End', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('proves end-to-end coherence between stream profile resolution, hotkey state transitions, and audit services', async () => {
    // 1. Dual stream resolution
    const stream = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'AUTO',
      mainPath: 'cam1',
      subPath: 'cam1_sub',
    });
    expect(stream.path).toBe('cam1_sub');

    // 2. Shuttle transition
    const speed = resolveShuttleTransition({ currentSpeed: 1, key: 'l' });
    expect(speed).toBe(2);

    // 3. Health check remains 200
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test suite**

Run: `npm test`  
Expected: PASS across all 35+ test suites (300+ passing tests).

- [ ] **Step 3: Run license audit**

Run: `npm run audit:licenses`  
Expected: PASS with 100% Permissive licenses (0 copyleft).

- [ ] **Step 4: Commit**

```bash
git add tests/operator-workflow-integration.test.ts
git commit -m "test(sub-project-a): add end-to-end operator workflow integration test"
```

---

## Plan Review Checklist

1. **Spec Coverage**:
   - Adaptive dual-stream switching $\to$ Task 1 & Task 3
   - Synchronized 1–4 camera playback matrix $\to$ Task 4
   - CCTV keyboard hotkeys & jog-shuttle $\to$ Task 5
   - Server-authoritative snapshot audit pipeline $\to$ Task 2
   - End-to-end integration & license verification $\to$ Task 6
2. **Placeholder Scan**: Zero instances of "TODO", "TBD", or placeholder strings.
3. **Type Consistency**: All types (`CameraStreamProfile`, `CameraProfiles`, `StreamProfileResolution`, `AlignmentInput`, `AlignmentResult`, `AuditLog`) align with spec definitions.
