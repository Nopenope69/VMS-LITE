# Phase 16: Operational Settings & Core Health Licensing Realignment - Validation

## Validation Gates

### Automated Integration & Unit Tests
1. **Licensing Realignment**:
   - `createEvaluationRegistry()` includes `core.camera_health` and `extended.camera_health`.
   - Core edition `registry.has('camera.health')`, `registry.has('core.camera_health')`, and `registry.has('extended.camera_health')` return `true`.
   - Evaluation registry provides a 16-camera limit by default.
   - Fastify routes protected by `requireCapability('extended.camera_health')` or `core.camera_health` succeed for authenticated users with Core evaluation or Core signed licenses.
2. **Operational Settings REST API**:
   - `GET /api/settings/operational`: Returns current recording mode, retention days, quotas, default schedule, and storage metrics.
   - `PUT /api/settings/operational`: Validates and persists operational settings changes (admin only, rejects non-admin with 403).
   - `GET /api/settings/schedule/:cameraId`: Returns camera-specific schedule or global default.
   - `PUT /api/settings/schedule/:cameraId`: Updates camera schedule and recording mode.
   - `POST /api/settings/storage/purge`: Executes retention and quota-based storage cleanup, returning freed bytes and deleted segments count while preserving bookmarked segments.
3. **Frontend Compilation & Build**:
   - `npm run build:client` (Vite) compiles cleanly with 0 errors.
   - `npm run build` (tsc) compiles with 0 type errors.
   - All tests in `tests/operational-settings.test.ts` pass 100%.
   - Full regression suite (247+ tests) passes 100%.
