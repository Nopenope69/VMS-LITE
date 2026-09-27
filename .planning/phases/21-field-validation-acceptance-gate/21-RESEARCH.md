# Phase 21: Field Validation & 72-Hour Acceptance Gate - Research & Technical Architecture

## Objective
Establish automated field acceptance and soak test harnesses validating that VMS-Lite operates reliably, deterministically, and unattended under simulated 72-hour operational conditions with 16 cameras, network disruptions, storage rollovers, motion events, and evidence exports — fulfilling the Day 75 Installer Litmus Test.

## Key Requirements & Acceptance Gates

### 1. Accelerated 72-Hour Unattended Soak Test
- **Camera Fleet**: Simulate 16 cameras simultaneously (8 in continuous recording, 8 in motion-buffered recording).
- **Time Acceleration**: Advance clock deterministically (e.g. 1 virtual hour per tick or virtual 72-hour simulated sequence) generating ~8,640 segment completions.
- **Storage FIFO Rollover**: As cumulative segments approach and exceed storage quota (85% threshold), the storage controller must purge oldest unbookmarked segments while protecting incident bookmarks.
- **Leak & Lock Prevention**: Verify heap memory stability, listener counts (`process.listenerCount`), and zero deadlocks.

### 2. Network Disconnect & Reconnect Glitch Simulation
- **Fault Injection**: Simulate network failure on Camera 3 (TCP socket RST / MediaMTX stream dropping).
- **Hysteresis Verification**:
  - T+0s: Ping fails $\to$ status transitions to `DEGRADED`.
  - T+30s: Hysteresis threshold reached $\to$ status transitions to `OFFLINE`.
  - Event Bus emits `camera.offline` with camera metadata.
  - Notification dispatcher issues high-priority email alert.
- **Recovery Verification**:
  - Reconnect simulated $\to$ status recovers to `ONLINE`.
  - Event Bus emits `camera.online` with precise calculated downtime.
  - No orphaned worker threads or duplicate event listeners.

### 3. Motion Ring Buffer End-to-End Flow
- Rolling ring buffer holds 2-second fMP4 segments.
- On motion trigger, atomically promotes 10s pre-buffer segments to disk/database catalog.
- Cooldown timer keeps post-buffer segments for 30s.
- Non-promoted ring buffer segments are purged automatically via TTL cleanup.

### 4. Self-Verifying Evidence Export Package
- Export job stitches segments into `video.mp4`.
- Bundle builder generates `manifest.json`, `audit.json`, `verify.js`, and packages them into a PKWARE ZIP archive.
- Subprocess executes `node verify.js` within the extracted bundle to verify cryptographic SHA-256 match.
- Tamper verification: Mutating 1 byte of `video.mp4` causes `verify.js` to report tampering and exit with non-zero code.

### 5. Single-Command Installer Litmus Script
- An automated CLI test harness (`scripts/installer-litmus-test.sh` and Vitest suite `tests/installer-litmus.test.ts`) that runs pre-flight, build, license audit, and service startup checks:
  1. Node.js 20+ runtime & dependencies.
  2. PostgreSQL schema readiness and migrations.
  3. MediaMTX configuration and API responsiveness.
  4. FFmpeg availability for evidence clipping.
  5. Production frontend bundle in `client/dist/`.
  6. 100% Permissive licensing compliance (`audit:licenses`).
  7. Full test suite passing 100%.

## Design Decisions
- **Deterministic Time Advancement**: Use simulated accelerated time steps with `TestClock` and mock timers where appropriate, while keeping actual I/O operations real (file creation, hash verification, database writes).
- **Zero Mock Fallbacks**: Live database records, real crypto hashes, real ZIP construction, and genuine child process execution of `verify.js`.
