# Phase 2 Plan 02: Camera Onboarding, MediaMTX Sync & REST API Summary

**Executed:** 2026-09-24  
**Plan:** `02-02-PLAN.md`  
**Status:** COMPLETE  

## Accomplishments

1. **Camera Domain Service & License Limit Gating**:
   - Implemented `CameraService` in `src/cameras/camera.service.ts` coordinating discovery, device profiling, database persistence, MediaMTX streaming path management, and event bus lifecycle events.
   - Enforced single-site offline license limit via `capabilities.getCameraLimit()` (T-02-04), throwing `LicenseLimitExceededError` and returning HTTP 403 `LicenseLimitExceeded` when attempting to add cameras beyond the licensed quota.
   - Emits `camera.online` and `camera.offline` events through the Core Event Bus (`src/events/event-bus.ts`).

2. **Secure Fastify Camera REST Endpoints**:
   - Implemented `cameraRoutes` in `src/cameras/camera.routes.ts` registered under `/api/cameras`:
     - `POST /api/cameras/discover`: Runs ONVIF WS-Discovery probe across local subnet (Admin only).
     - `POST /api/cameras`: Onboards ONVIF Profile T/S cameras or manual RTSP streams with schema validation via Zod (Admin only).
     - `GET /api/cameras`: Lists all configured cameras (Admin & Viewer).
     - `GET /api/cameras/:id`: Returns camera stream info and device metadata (Admin & Viewer).
     - `DELETE /api/cameras/:id`: Deletes camera record and tears down MediaMTX path (Admin only).
   - Ensured camera passwords are never serialized in API responses (`CameraResponseDto`, T-02-06).

3. **End-to-End Test Suite**:
   - `tests/camera-discovery.test.ts`: 6/6 tests passing (discovery, dual-stream profile extraction, manual streams, license quota limits).
   - `tests/camera-routes.test.ts`: 11/11 tests passing (Fastify route guards, RBAC Admin vs Viewer authorization, MediaMTX dynamic sync, 403 on license overflow).

## Verification Evidence

- `npm test`: 52/52 tests passing across 8 test suites.
- `npm run build`: TypeScript compiles with 0 errors.

---
*Created by GSD Executor*
