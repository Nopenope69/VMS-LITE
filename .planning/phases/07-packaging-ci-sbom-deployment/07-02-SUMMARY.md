# Phase 7 Plan 02 Summary: Automated License Auditor, SBOM & Recovery Smoke Tests

## Overview
Implemented automated license compliance auditing, CycloneDX 1.5 SBOM generation, GitHub Actions CI workflow, and recovery smoke testing, fulfilling requirements `DEP-03` and `DEP-04`.

## Deliverables
1. **Automated License Compliance Auditor (`scripts/audit-licenses.js`)**:
   - Traverses all 157 production dependencies in `package-lock.json`.
   - Strictly enforces 100% permissive licenses: `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`, `BlueOak-1.0.0`, `CC0-1.0`.
   - Prohibits viral copyleft licenses (`GPL`, `AGPL`, `LGPL`, `SSPL`).
   - Automatically generates release inventory:
     - `third_party/notices/THIRD_PARTY_NOTICES.md`
     - `third_party/licenses/`
2. **CycloneDX 1.5 JSON SBOM Generator (`scripts/generate-sbom.js`)**:
   - Parses production dependencies and outputs `sbom.json` (and `dist/sbom.json`) complying with CycloneDX 1.5 standard.
   - Includes purl identifiers, license IDs, component versions, and unique serial numbers.
3. **Power Loss & Service Recovery Smoke Tests (`tests/recovery-smoke.test.ts`)**:
   - 3 automated smoke tests verifying:
     - Restoration of camera configurations and active recording schedules after unexpected service crash.
     - Storage manager re-initialization and disk capacity threshold monitoring.
     - Control plane server healthcheck response on fresh boot.
4. **GitHub Actions CI Workflow (`.github/workflows/ci.yml`)**:
   - Runs `npm test` across all 17 test suites (112 tests).
   - Runs `npm run audit:licenses` (DEP-04).
   - Runs `npm run generate:sbom` (DEP-03).
   - Verifies TypeScript build for both backend and client.
   - Uploads `sbom.json` and `third_party/` notices as release build artifacts.
5. **NPM Scripts (`package.json`)**:
   - Added `"audit:licenses": "node scripts/audit-licenses.js"`.
   - Added `"generate:sbom": "node scripts/generate-sbom.js"`.

## Verification
- `npm test`: 112/112 tests passed across 17 test files.
- `npm run audit:licenses`: 157/157 packages passed; 100% permissive compliance confirmed.
- `npm run generate:sbom`: `sbom.json` generated with 157 components.
- `npm run build`: Backend compiled cleanly.
- `npx tsc -p client/tsconfig.json --noEmit`: Client typecheck clean.
