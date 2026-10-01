# Sub-Project C Implementation Plan: Storage Reliability & Drive Telemetry

**Spec:** `docs/superpowers/specs/2026-10-01-storage-reliability-design.md`  
**Branch:** `feature-storage-reliability`

## Global Constraints

- **100% Permissive Licensing**: Standard Node.js APIs (`node:child_process`, `node:fs`). Zero copyleft dependencies.
- **Fail-Loud Runtime**: Explicit error messages on runtime failures; clean mock fallback when OS tools are absent.
- **Recording Invariant**: Never block recording segment writes.

---

## Tasks

### Task 1: Storage Telemetry Service & SMART / Device Parser
**Files**:
- Create: `src/system/storage-telemetry.service.ts`
- Create: `src/system/storage-telemetry.types.ts`
- Create: `tests/storage-telemetry-service.test.ts`
**Description**:
- Implement parser for `lsblk -J` and `smartctl --json=c -a`.
- Implement `StorageTelemetryService` supporting periodic polling, device discovery, SMART parsing, temperature checks, and alert emissions through `EventBus`.

### Task 2: Storage Telemetry API Routes & Server Integration
**Files**:
- Create: `src/system/storage-telemetry.routes.ts`
- Modify: `src/server.ts` (register route under `/api/system/storage`)
- Modify: `src/system/system.routes.ts` (include drive health summary in `/api/system/dashboard`)
- Create: `tests/storage-telemetry-routes.test.ts`
**Description**:
- Expose `GET /api/system/storage/drives` for full drive telemetry list.
- Expose `GET /api/system/storage/removable` for detected external/USB mount points.
- Include drive summary badge in `/api/system/dashboard`.

### Task 3: Dashboard Drive Telemetry UI & USB Target Selector
**Files**:
- Create: `client/src/components/DriveTelemetryCard.tsx`
- Modify: `client/src/components/DashboardView.tsx` (add drive health metrics & temperature status)
**Description**:
- Render drive telemetry card with temperature gauge, SMART health status (`PASSED` / `FAILING`), model/size, and removable badge.
- Build clean Vite bundle and verify with `tsc`.

### Task 4: Integration Test & Full License Audit
**Files**:
- Create: `tests/storage-reliability-integration.test.ts`
**Description**:
- End-to-end integration test validating drive discovery, SMART alerts, temperature threshold triggers, and license audit.
