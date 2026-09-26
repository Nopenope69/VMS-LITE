# Plan 16-01 Summary: Core Health Licensing Realignment & Operational Settings Backend

## Work Completed
1. **Commercial Licensing Realignment (MVP-07)**:
   - Added `'core.camera_health'` and `'extended.camera_health'` directly into `CORE_CAPABILITIES` in `src/licensing/types.ts`.
   - Updated `CapabilityRegistry.has(capability)` in `src/licensing/capabilities.ts` to seamlessly alias `camera.health`, `core.camera_health`, and `extended.camera_health`.
   - Extended `createEvaluationRegistry(cameraLimit = 2)` to provide camera health capabilities out of the box in evaluation dev mode while supporting up to 16 cameras for Core production licenses.
   - Verified that `GET /api/cameras/health` is accessible for `OPERATOR` and `ADMIN` on Core edition without requiring Pro or Extended tier.

2. **Recording Types & Storage Protection**:
   - Added `MOTION_ONLY` mode to `RecordingMode` and `SetCameraScheduleSchema` in `src/recordings/recording.types.ts`.
   - Updated `RecordingSchedulerCollaborator` to handle `MOTION_ONLY` (continuous recording inactive, promoted dynamically by ring buffer).
   - Enhanced `StorageController` in `src/recordings/storage-controller.ts`:
     - Added `purgeRetention(days)` method to delete segments exceeding retention days cutoff.
     - Added `isBookmarkedFn` checker that shields segments overlapping incident bookmarks from automated deletion during FIFO rollover and retention purges.
     - Added setters for thresholds and retention days.
   - Exposed `purgeRetention` and `getStorageController()` in `RecordingEngine`.

3. **Operational Settings Service & API (MVP-08)**:
   - Created `src/settings/settings.types.ts`:
     - Zod schemas and TypeScript types for `OperationalSettings`, `HourlyScheduleSlot`, and camera schedule payloads.
     - Bi-directional schedule converters `gridToWindows(grid)` and `windowsToGrid(windows)` converting between compact schedule windows and interactive 7-day $\times$ 24-hour boolean matrices.
     - Preset factories for `ALL_HOURS`, `BUSINESS_HOURS`, `NIGHTS_AND_WEEKENDS`, and `CLEAR_ALL`.
   - Created `src/settings/settings.service.ts`:
     - Singleton `SettingsService` managing global operational policies, storage metrics, estimated retention days, camera schedule resolution, and storage purges.
     - Integrated with `BookmarkService` to protect bookmarked segments.
   - Created `src/settings/settings.routes.ts`:
     - `GET /api/settings/operational`: returns active settings, 7-day grid, storage pool metrics, and licensing status.
     - `PUT /api/settings/operational`: updates system-wide settings (Admin only).
     - `GET /api/settings/schedule/:cameraId`: returns camera schedule with 7-day grid.
     - `PUT /api/settings/schedule/:cameraId`: updates camera schedule and mode (Admin only).
     - `POST /api/settings/storage/purge`: triggers retention & quota purge (Admin only).
   - Registered `/api/settings` route plugin in `src/server.ts`.

4. **Integration & Regression Testing**:
   - Created `tests/operational-settings.test.ts` covering licensing realignment, schedule grid converters, REST endpoints, RBAC protection, and bookmark preservation during purge (15/15 tests passing).
   - Verified full regression suite: 27/27 test files passed, 262/262 tests passed.
   - `npm run build` (tsc) compiled with 0 errors.
