# Phase 15: 6-Step Robust Camera Onboarding Wizard - Validation Contract

## Quality Gates & Acceptance Criteria

### Gate 1: Probe & Verification Endpoints
- [ ] `POST /api/cameras/probe-network`: Handshakes TCP port on camera IP, returns reachability status and RTT latency in milliseconds.
- [ ] `POST /api/cameras/probe-auth`: Validates ONVIF credentials, queries `getDeviceInformation` and `getProfiles`, and classifies Main and Sub stream RTSP URIs.
- [ ] `POST /api/cameras/provision-preview`: Provisions a temporary MediaMTX preview path, queries readiness, and returns the WHEP URL for client playback.
- [ ] `POST /api/cameras/commit`: Commits camera record to PostgreSQL only after streaming is verified; cleans up preview path; rolls back MediaMTX path if database persistence fails.

### Gate 2: Frontend 6-Step Wizard (`CameraOnboardingWizardModal`)
- [ ] Stepper navigation with visual indicators for Steps 1 through 6.
- [ ] Step 1 (Discovery): Subnet scanning via `POST /api/cameras/discover` or manual RTSP/IP input.
- [ ] Step 2 (Auth & Profiles): Username/password input with "Probe Camera" action resolving camera details and video stream profiles.
- [ ] Step 3 (Network Verification): Automatic TCP handshake ping displaying latency in milliseconds.
- [ ] Step 4 & 5 (Provisioning & Visual Preview): Live WebRTC WHEP player displaying camera stream for installer confirmation.
- [ ] Step 6 (Commit): Camera naming, recording schedule attachment, and atomic commit to database.
- [ ] Cancellation cleans up any temporary preview path.

### Gate 3: Integration Test Coverage
- [ ] Automated tests in `tests/camera-onboarding-wizard.test.ts` validating:
  - Network probe with reachable and unreachable targets.
  - Credential and profile probing with valid vs invalid credentials.
  - Preview path provisioning and teardown.
  - Transactional commit with capability limit enforcement.

### Gate 4: System Builds & Non-Regression
- [ ] Client build passes (`npm run build:client`).
- [ ] Backend build passes (`npm run build`).
- [ ] All test suites pass.
- [ ] 100% permissive licensing maintained (`npm run audit:licenses`).
