---
phase: 03-recording-engine-storage-management
plan: 02
status: completed
date: 2026-09-24
requirements_covered:
  - REC-02
  - REC-04
  - REC-05
threats_mitigated:
  - T-03-04
  - T-03-05
  - T-03-06
---

# Plan 03-02 Summary: Recording Scheduler, Storage Monitoring & FIFO Rollover

Plan 02 of Phase 3 completed the recording scheduling engine and disk storage lifecycle management, satisfying `REC-02`, `REC-04`, and `REC-05`.

## Key Deliverables

1. **RecordingScheduler (`src/recordings/recording-scheduler.service.ts`)**:
   - Supports 3 modes: `CONTINUOUS` (24/7), `SCHEDULED` (day-of-week and time-of-day windows), and `MANUAL_OFF`.
   - Handles overnight schedules crossing midnight boundaries.
   - Dynamically toggles MediaMTX recording path configuration via `MediaMtxClient.patchPath(path, { record })`.
   - Dispatches `recording.started` and `recording.stopped` events to `EventBus` when state changes occur.

2. **StorageManager (`src/recordings/storage-manager.service.ts`)**:
   - Inspects disk mount storage utilization via native Node 20 LTS `fs.statfs` (zero native C++ or external dependencies).
   - Monitors capacity against warning (80%) and critical (90%) thresholds (`REC-04`), emitting `storage.warning` and `storage.full` events.
   - Enforces automatic FIFO rollover (`REC-05`): purges oldest video files from disk and removes records from PostgreSQL/memory catalog when critical threshold is breached.
   - Strict Path Traversal Guard (`T-03-06`): validates that all unlinked files resolve strictly within the configured `recordingsDir` root, preventing deletion outside the storage mount.

3. **Fastify Route Integration & RBAC Protection (`src/recordings/recording.routes.ts`)**:
   - `GET /api/recordings/schedules/:cameraId` (Viewer & Admin)
   - `POST /api/recordings/schedules/:cameraId` (Admin only, `T-03-05`)
   - `GET /api/recordings/storage` (Viewer & Admin)
   - `POST /api/recordings/storage/cleanup` (Admin only, `T-03-05`)

4. **Automated Verification**:
   - `tests/recording-scheduler.test.ts`: 7 tests verifying schedule matching, midnight transitions, and dynamic patching.
   - `tests/storage-manager.test.ts`: 7 tests verifying disk space calculations, warning/full event triggers, FIFO deletion ordering, and traversal prevention.
   - `tests/recording-catalog.test.ts`: 13 tests covering segment ingestion, catalog queries, schedule updates, storage metrics, and RBAC enforcement.
   - Full test suite: 79/79 passing across all 11 test files with clean TypeScript compilation (`tsc`).
