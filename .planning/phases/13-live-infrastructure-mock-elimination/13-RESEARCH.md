# Phase 13: Live Infrastructure & Mock Elimination - Technical Research

**Phase:** 13-live-infrastructure-mock-elimination  
**Source Workstreams:** Milestone 1, Workstreams 1.1 & 1.2 (`.planning/MVP-ROADMAP.md`)  
**Date:** 2026-09-27  

---

## 1. Executive Summary & Problem Analysis

In the initial rapid prototyping phases of VMS-Lite, several domain services implemented "graceful" fallback branching to in-memory maps or synthetic strings whenever external dependencies (PostgreSQL, MediaMTX, or FFmpeg) were unreachable or failed.

While this allowed unit tests to pass in sandboxed environments without running database daemons or external media binaries, it introduced a fatal flaw for real-world deployments: **Mock-Fallback Fake Success**.

### The Manifested Anti-Patterns:
1. **Silent In-Memory State Mutation**:
   - `CameraService`: When `prisma.camera.upsert()` throws (e.g. PostgreSQL is offline or schema unmigrated), it caught the error and saved the camera into `this.memoryCameras`.
   - `BookmarkService`: When `prisma.bookmark.create()` throws, it caught the error and saved into `this.memoryBookmarks`.
   - `WebhookDispatcherService`: Kept `this.memoryEndpoints` as a parallel in-memory map.
   - `NotificationDispatcherService`: Maintained `this.memoryConfig` and defaulted to `MockNotificationDispatcher` even when production settings were submitted.
   - **Real-World Consequence:** An installer deploys the software, adds cameras, configures bookmarks and webhooks, and receives HTTP 200 OK. But upon rebooting the machine or restarting the Docker container, all state vanishes. The installer believes the system is working, but it was operating entirely in RAM.

2. **Synthetic Media Generation**:
   - `ExportService`: When FFmpeg failed to spawn (`ENOENT`) or failed to process segment formats, it wrote `'MOCK_VIDEO_STREAM_DATA'` to the destination file and marked the export job as `COMPLETED`.
   - **Real-World Consequence:** An operator requests evidence for the police or insurance adjuster, downloads an `.mp4` file, and receives a text file containing "MOCK_VIDEO_STREAM_DATA" instead of actual surveillance video.

---

## 2. Architectural Mandate: Fail Loudly & Explicitly

Every production service must operate under a strict zero-silent-fallback contract:

```text
Real Dependency Fails (PostgreSQL / MediaMTX / Camera RTSP / FFmpeg)
                            │
                            ▼
           Log Detailed Diagnostic Error with Stack Trace
                            │
                            ▼
          No Misleading State Mutation (RAM Maps)
                            │
                            ▼
    Return HTTP 4xx / 5xx with Structured, Actionable Error Payload
```

### Standard Error Response Schema:
```json
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "code": "DATABASE_UNAVAILABLE",
  "message": "Failed to persist camera entity to PostgreSQL. Verify database service is running and migrations are applied."
}
```

### Error Code Taxonomy:
| Error Code | HTTP Status | Trigger Condition |
|---|---|---|
| `DATABASE_UNAVAILABLE` | 503 | Prisma query throws or connection to PostgreSQL is refused. |
| `MEDIAMTX_UNAVAILABLE` | 502 | MediaMTX REST API is unreachable or returns 5xx during path provisioning. |
| `CAMERA_UNREACHABLE` | 504 | TCP handshake to camera IP:port timed out or was refused. |
| `STREAM_NOT_READY` | 504 | MediaMTX path did not transition to `ready: true` within timeout window. |
| `FFMPEG_SPAWN_FAILED` | 500 | FFmpeg binary is missing from system `$PATH` or failed execution permissions. |
| `RECORDING_SEGMENTS_MISSING` | 404 | No recorded fMP4 segments found on disk for the requested export time window. |

---

## 3. Dependency Injection Architecture for Test Isolation

To eliminate in-memory maps from production code while maintaining fast, isolated unit tests, we establish an explicit Dependency Injection (DI) seam:

```text
                           PRODUCTION RUNTIME
                  ┌───────────────────────────────────┐
                  │ Fastify Controller / Domain Service│
                  └─────────────────┬─────────────────┘
                                    │
                                    ▼
                         [Prisma Client / Real DB]
                         (Throws on error → HTTP 503)

                  ─────────────────────────────────────

                              UNIT TESTS
                  ┌───────────────────────────────────┐
                  │    Test Suite / Vitest Spec       │
                  └─────────────────┬─────────────────┘
                                    │ Injects Mock/Fake
                                    ▼
                     [Mock Repository / Test Harness]
                     (Isolated strictly inside tests/)
```

### Rules:
1. `src/` domain files must **never** instantiate internal fallback maps (`memoryCameras`, `memoryBookmarks`, `memoryEndpoints`, `memoryJobs`).
2. If a database operation fails, let the error propagate or wrap it in a typed domain error (`DatabaseError`, `MediaPlaneError`).
3. For unit testing without PostgreSQL, test files supply an explicitly mocked Prisma client or repository via constructor options (`new CameraService({ prisma: mockPrisma })`).
4. In production (`new CameraService()`), the service directly utilizes the singleton Prisma client. If Prisma fails, the route responds with HTTP 503.

---

## 4. Golden Installer Path Integration Test

Workstream 1.2 requires verifying the end-to-end installer lifecycle against real live dependencies:

1. **Database Schema Verification**: Run Prisma migrations (`prisma migrate deploy`) against PostgreSQL.
2. **Admin Initialization**: Seed admin user and obtain valid JWT token.
3. **Camera Onboarding**: Onboard camera, verify MediaMTX path creation, verify PostgreSQL row persistence.
4. **Recording Persistence**: Verify fMP4 segments cataloged in `recordings` table.
5. **Timeline Query**: Query `/api/playback/timeline` and assert non-empty spans.
6. **Export Verification**: Request clip export, verify FFmpeg stitches segments, verify output MP4 has valid headers and non-zero byte size.
7. **Process Restart**: Destroy and re-instantiate service instances to prove data persists across restarts.

---

## 5. File Remediation Plan

1. **`src/bookmarks/bookmark.service.ts`**:
   - Remove `this.memoryBookmarks`.
   - Remove `catch` blocks that fall back to in-memory bookmarks.
   - Allow Prisma errors to propagate or throw `DatabaseError`.

2. **`src/export/export.service.ts`**:
   - Remove `this.memoryJobs`.
   - Remove fallback writing `'MOCK_VIDEO_STREAM_DATA'`.
   - If FFmpeg fails or is missing, explicitly reject and mark job as `FAILED` with `errorCode: 'FFMPEG_UNAVAILABLE'`.
   - If Prisma write fails in `persistJob`, throw error rather than saving to RAM.

3. **`src/webhooks/webhook-dispatcher.service.ts`**:
   - Remove `this.memoryEndpoints`.
   - All CRUD methods query and mutate `this.prisma.webhookEndpoint`.
   - Reject with 503 if Prisma is unreachable.

4. **`src/notifications/notification-dispatcher.service.ts`**:
   - Remove `this.memoryConfig`.
   - All config reads/writes go directly to `this.prisma.notificationConfig`.
   - Do not default silently to `MockNotificationDispatcher` when live credentials fail.

5. **`src/cameras/camera.service.ts`**:
   - Remove `this.memoryCameras`.
   - Remove fallback catch block in `persistCamera`.
   - Ensure camera onboarding fails if PostgreSQL upsert fails.

6. **`tests/`**:
   - Update tests that previously relied on silent in-memory fallback to provide explicit in-memory mocks via constructor injection, or run against the test database.
