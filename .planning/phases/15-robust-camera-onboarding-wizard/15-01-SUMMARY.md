# Phase 15-01 Summary: Backend Probe Endpoints & Transactional Onboarding Service

## Overview
Implemented the backend verification APIs and transactional pipeline for the 6-step camera onboarding wizard. The backend now verifies network reachability, ONVIF credentials, stream profiles, and MediaMTX stream readiness before committing records to PostgreSQL, with automatic rollback if media plane configuration fails.

## Changes Implemented

1. **CameraService Methods (`src/cameras/camera.service.ts`)**:
   - `probeNetwork(ip, port, timeoutMs)`: Uses `net.createConnection` to handshake TCP port (default RTSP 554), measuring round-trip latency in milliseconds.
   - `probeAuthAndProfiles(params)`: Probes camera credentials and queries ONVIF device information and video profiles without persisting to database.
   - `provisionPreviewPath(rtspUrl)`: Provisions a temporary `preview_<hash>` path in MediaMTX and polls for up to 5 seconds for `ready: true`.
   - `teardownPreviewPath(pathName)`: Removes temporary preview path on wizard cancel or modal exit.
   - `commitVerifiedCamera(input, cameraLimit)`: Validates license capability limits, creates PostgreSQL camera record, provisions permanent MediaMTX streaming path, tears down preview path, and rolls back the database insert if media plane setup fails.

2. **Camera Routes Extension (`src/cameras/camera.routes.ts`)**:
   - `POST /api/cameras/probe-network`: Validated via `ProbeNetworkSchema`.
   - `POST /api/cameras/probe-auth`: Validated via `ProbeAuthSchema`.
   - `POST /api/cameras/provision-preview`: Validated via `ProvisionPreviewSchema`.
   - `POST /api/cameras/teardown-preview`: Cleans up temporary preview path.
   - `POST /api/cameras/commit`: Validated via `CommitCameraSchema`, enforces capability limits, and returns HTTP 201 with camera DTO.

3. **Validation & Automated Tests (`tests/camera-onboarding-wizard.test.ts`)**:
   - Verified TCP reachability handshake against live socket server.
   - Verified unreachable port error handling without unhandled rejections.
   - Verified ONVIF authentication and profile extraction.
   - Verified temporary preview path provisioning and cleanup.
   - Verified atomic database commit and capability limit enforcement.

## Verification Results
- `tests/camera-onboarding-wizard.test.ts`: **9/9 tests passed**.
- `npm run build`: Compiled with 0 TypeScript errors.
