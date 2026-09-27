# Phase 21: Field Validation & 72-Hour Acceptance Gate - Validation Criteria

## Test Commands

### 1. Accelerated Soak & Network Glitch Acceptance Suite
```bash
npx vitest run tests/soak-acceptance.test.ts
```
Expected:
- 16 cameras simulated concurrently.
- Accelerated 72-hour progression generates thousands of segment events without memory leaks.
- Storage FIFO threshold triggers segment purge; bookmarked clips are strictly preserved.
- Network disconnection on Camera 3 triggers `DEGRADED` -> `OFFLINE` (at 30s) -> email notification.
- Reconnection recovers to `ONLINE` with exact logged downtime.
- Rolling motion ring buffer promotes 10s pre-buffer and 30s post-buffer segments.
- Self-verifying evidence export passes `node verify.js` cryptographic verification.

### 2. Installer Litmus Test Suite
```bash
npx vitest run tests/installer-litmus.test.ts
```
Expected:
- Fastify backend builds cleanly.
- Vite frontend builds cleanly to `client/dist/`.
- Caddy reverse-proxy configuration passes syntax check.
- System health `/health` and capability status verified.
- License compliance passes 100% permissive check.

### 3. Automated Installer Litmus Shell Script
```bash
bash scripts/installer-litmus-test.sh
```
Expected:
- Executes clean-machine preflight checks (Node 20+, Postgres, MediaMTX, FFmpeg).
- Runs build and license audit.
- Exits with return code 0 and `[SUCCESS] DAY 75 INSTALLER LITMUS TEST PASSED`.

### 4. Full Monorepo Test Suite
```bash
npm test
npm run audit:licenses
```
Expected:
- 100% tests passing across all 34+ test suites.
- 0 license violations (100% MIT/Apache-2.0/BSD).
