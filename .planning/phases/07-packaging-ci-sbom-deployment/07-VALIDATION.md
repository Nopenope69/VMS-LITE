# Phase 7: Packaging, CI/SBOM & Single-Command Deployment - Validation Plan

**Planned:** 2026-09-24  
**Scope:** Automated testing and verification strategy for single-command installer, docker configuration, license auditing, SBOM generation, and recovery mechanisms.

## Validation Criteria

1. **Single-Command Installer & Docker Setup (`DEP-01`, `DEP-02`)**:
   - `Dockerfile` multi-stage build compiles cleanly.
   - `docker-compose.yml` configures valid services (`app`, `mediamtx`, `postgres`, `coturn`) with proper healthchecks and persistent volumes.
   - `deploy/install.sh` syntax and execution flow validates environment, generates secrets, and manages containers.
   - `deploy/basic-vms.service` provides proper systemd unit definitions for power-loss recovery.

2. **Automated License Compliance Audit (`DEP-04`)**:
   - `scripts/audit-licenses.js` scans all installed dependencies.
   - Asserts 100% permissive licenses (MIT, Apache-2.0, BSD, ISC).
   - Fails with non-zero exit code if any copyleft (GPL, AGPL, LGPL, SSPL) dependency is introduced.
   - Generates license notices and releases inventory to `third_party/licenses/` and `third_party/notices/`.

3. **Release SBOM Generation (`DEP-03`)**:
   - `scripts/generate-sbom.js` generates valid CycloneDX 1.5 JSON SBOM (`sbom.json`).
   - Includes component names, versions, license declarations, and file hashes.

4. **Service Restart & Power Loss Recovery Smoke Test**:
   - Unit/integration test verifies that on service restart, recording schedules and storage monitor resume smoothly without corrupting recording state or database records.

## Test Suites
- `scripts/audit-licenses.js`: Executed to verify 100% permissive compliance.
- `scripts/generate-sbom.js`: Executed to verify SBOM generation.
- `tests/recovery-smoke.test.ts`: Verifies crash and reboot recovery logic.
