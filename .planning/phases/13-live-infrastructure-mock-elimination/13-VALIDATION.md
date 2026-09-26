# Phase 13: Live Infrastructure & Mock Elimination - Validation Contract

**Phase:** 13-live-infrastructure-mock-elimination  
**Status:** In Progress  

---

## 1. Scope & Verification Criteria

Phase 13 establishes the production reliability baseline by eliminating all silent mock-fallbacks from domain services and strictly separating test fakes from production code.

### Automated Test Gates:
1. **Zero Silent Fallback in Production Services**:
   - `CameraService`: When PostgreSQL is unreachable or fails, throw `DatabaseError` / fail explicitly. No saving to `memoryCameras`.
   - `BookmarkService`: When PostgreSQL is unreachable, throw `DatabaseError`. No saving to `memoryBookmarks`.
   - `ExportService`: When FFmpeg is missing or fails, mark job `FAILED` with explicit code (`FFMPEG_UNAVAILABLE`). No writing `'MOCK_VIDEO_STREAM_DATA'`. When PostgreSQL fails in `persistJob`, fail loudly.
   - `WebhookDispatcherService`: Endpoints stored strictly in PostgreSQL. No internal `memoryEndpoints` cache.
   - `NotificationDispatcherService`: Notifications config stored in PostgreSQL. Fails if database write fails.
2. **Deterministic Error Responses**:
   - HTTP routes must return structured JSON: `{ error, code, message }` with appropriate 4xx/5xx status codes (`DATABASE_UNAVAILABLE: 503`, `MEDIAMTX_UNAVAILABLE: 502`, `FFMPEG_ERROR: 500`).
3. **Unit Test Decoupling & Test Harness**:
   - Any unit test running without PostgreSQL or MediaMTX must inject explicit mocks via service constructors or mock repositories, rather than relying on silent production catch blocks.
   - Fix date-drift in `tests/playback.test.ts` so dynamic segments always match query date.
4. **All Tests Passing**:
   - `npm test` runs with 0 failed tests.
   - TypeScript build (`npm run build`) passes with 0 errors.

---

## 2. Test Execution Matrix

| Test Suite | Purpose | Target Status |
|---|---|---|
| `tests/camera-discovery.test.ts` | Camera discovery & provider abstraction | PASS |
| `tests/camera-routes.test.ts` | REST camera management routes | PASS |
| `tests/camera-health.test.ts` | Dual-plane health monitoring telemetry | PASS |
| `tests/recording-catalog.test.ts` | Video recording segment catalog | PASS |
| `tests/recording-engine.test.ts` | Recording engine & rollover pruner | PASS |
| `tests/playback.test.ts` | 24-hour timeline scrubber & stream endpoints | PASS |
| `tests/export-bookmarks.test.ts` | Clip export & incident bookmarks | PASS |
| `tests/webhooks-alerts.test.ts` | Webhooks and rate-limited alerts | PASS |
| `tests/operator-rbac.test.ts` | 3-role RBAC & camera ACLs | PASS |
| `tests/motion-zones.test.ts` | Motion zones polygon containment | PASS |
