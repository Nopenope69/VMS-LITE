# Phase 15: 6-Step Robust Camera Onboarding Wizard - Research

## Context & Problem Statement
Currently, camera onboarding in Basic VMS inserts records into PostgreSQL and provisions MediaMTX in a single call. If a camera has wrong credentials, bad RTSP stream paths, or high network packet drop, the database record is already committed and the installer has no visual confirmation that video is actually streaming.

To satisfy Workstream 1.4 of `.planning/MVP-ROADMAP.md` (and achieve CP Plus / Hikvision parity for sub-30 minute field installations), camera onboarding must be converted into a 6-step transactional wizard with active verification:
1. **Network Discovery**: Multicast WS-Discovery probes local subnet; fallback to manual IP entry.
2. **Authentication & Profile Resolution**: Probes ONVIF `GetDeviceInformation` and `GetProfiles`, automatically identifying Main Stream (HD) and Sub Stream (Low-res).
3. **Network & Port Verification**: Performs TCP socket handshake to camera IP:port (default RTSP 554) to confirm latency and reachability before provisioning.
4. **MediaMTX Path Provisioning**: Adds RTSP pull source into MediaMTX configuration API and verifies that path state transitions to `ready: true`.
5. **Visual Stream Preview & Confirmation**: Renders live WebRTC (WHEP) preview in the modal so installer visually validates camera alignment, lighting, and focus.
6. **Atomic Database Commit**: Commits camera to PostgreSQL only after visual/streaming verification succeeds, rolling back MediaMTX paths if database commit fails.

## Architectural Findings

### 1. Backend Probe Architecture
- We can structure the backend with 4 distinct verification endpoints:
  - `POST /api/cameras/probe-network`: TCP handshake check returning `{ reachable: boolean, latencyMs: number }`.
  - `POST /api/cameras/probe-auth`: ONVIF authentication and profile extraction returning `{ authenticated: boolean, device: {...}, profiles: [...] }`.
  - `POST /api/cameras/provision-preview`: Provisions a temporary MediaMTX path and waits up to 5s for `ready: true`, returning `{ path, ready, whepUrl }`.
  - `POST /api/cameras/commit`: Atomically creates the camera DB record with verified stream URLs, locks in the permanent MediaMTX path, attaches recording schedules, and rolls back if an error occurs.

### 2. Frontend Wizard Architecture
- A multi-step modal component `CameraOnboardingWizardModal`:
  - Visual step progress stepper (Steps 1 to 6).
  - Step 1: Scan Subnet or Enter Manual RTSP.
  - Step 2: Credentials & Profile Inspection (shows HD Main and Low-res Sub stream).
  - Step 3: Network Diagnostics (TCP latency display).
  - Step 4 & 5: Stream Provisioning & Live WebRTC Preview (uses existing `WhepHlsPlayer`).
  - Step 6: Camera Name, Recording Policy, and Save.
- Rollback capability: If user cancels before Step 6, any preview MediaMTX path is automatically deleted.

### 3. Verification Strategy
- Backend unit and integration tests in `tests/camera-onboarding-wizard.test.ts`:
  - Network probe test with reachable vs unreachable ports.
  - Auth probe test with mock ONVIF provider.
  - Preview provisioning test with mock MediaMTX client.
  - Full commit test with atomic DB persistence and rollback on error.
- Frontend compilation and Vite bundling validation.
