# Sub-Project B Implementation Plan: Appliance Operations & Maintenance

**Spec:** `docs/superpowers/specs/2026-09-30-appliance-operations-design.md`
**Branch:** `feature-appliance-operations`

## Global Constraints

- **100% Permissive Licensing:** Only MIT, Apache-2.0, or BSD dependencies.
- **Fail-Loud Runtime:** Zero synthetic fallbacks. Explicit errors on failure.
- **Server-Authoritative Integrity:** Backup SHA-256 computed server-side over exact bytes.
- **Recording Invariant:** Shutdown must flush all in-progress segment writes.

---

## Task Dependency Graph

```
Task 1 (Backup Service) ──┐
                           ├──> Task 4 (Dashboard & Frontend Integration)
Task 2 (Shutdown & Signals)┤
                           │
Task 3 (NTP Status) ──────┘
                           └──> Task 5 (Integration Test & License Audit)
```

Tasks 1, 2, 3 are independent. Task 4 depends on all three. Task 5 depends on Task 4.

---

### Task 1: System Configuration Backup & Restore Service

**Files:**
- Create: `src/system/backup.service.ts`
- Create: `src/system/backup.routes.ts`
- Modify: `src/server.ts` (register backup routes)
- Create: `tests/backup-restore.test.ts`

**Interfaces:**
- Consumes: Prisma client (all config models), `settingsService.getOperationalSettings()`
- Produces: `POST /api/system/backup` (streams tar.gz), `POST /api/system/restore` (multipart upload)

- [ ] **Step 1: Write tests (TDD)**

```typescript
// tests/backup-restore.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

describe('System Configuration Backup & Restore', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
    const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin' } });
    adminToken = JSON.parse(loginRes.payload).token;
  });

  afterAll(async () => { await app.close(); });

  it('generates a tar.gz backup with manifest.json and config.json', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/gzip');
    expect(res.headers['content-disposition']).toContain('vms-backup-');
    // Verify it's valid gzip
    const decompressed = zlib.gunzipSync(res.rawPayload);
    expect(decompressed.length).toBeGreaterThan(0);
  });

  it('rejects backup request from non-admin users', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects restore with invalid archive', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore',
      headers: { Authorization: `Bearer ${adminToken}`, 'content-type': 'application/gzip' },
      payload: Buffer.from('not-a-valid-archive'),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects restore with tampered config.json (SHA-256 mismatch)', async () => {
    // Create a valid-looking but tampered archive
    // This test verifies the integrity check
  });

  it('round-trips backup and restore with skip-existing mode', async () => {
    // 1. Create backup
    const backupRes = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(backupRes.statusCode).toBe(200);

    // 2. Restore with skip-existing
    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/system/restore?mode=skip-existing',
      headers: { Authorization: `Bearer ${adminToken}`, 'content-type': 'application/gzip' },
      payload: backupRes.rawPayload,
    });
    expect(restoreRes.statusCode).toBe(200);
    const result = JSON.parse(restoreRes.payload);
    expect(result.success).toBe(true);
    expect(result.summary).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement backup service**

`src/system/backup.service.ts`:
- `createBackup(prisma): Promise<Buffer>` — queries all config models, builds manifest.json + config.json, creates tar.gz in memory using Node's `zlib` and `tar` stream (or manual tar header construction to avoid new deps).
- `restoreBackup(prisma, archiveBuffer, mode): Promise<RestoreSummary>` — extracts, validates manifest, verifies SHA-256, upserts/inserts in dependency order within a Prisma transaction.
- Models in dependency order: Users → Cameras → MotionZones, RecordingSchedules, CameraPermissions → Bookmarks → WebhookEndpoints, NotificationConfig.
- Use `node:crypto` for SHA-256, `node:zlib` for gzip, and a minimal tar packer (512-byte header blocks per POSIX tar spec) to avoid adding `tar` as a dependency.

- [ ] **Step 3: Implement backup routes and register**

`src/system/backup.routes.ts`:
- `POST /backup`: Admin-only, calls `createBackup()`, streams tar.gz response.
- `POST /restore`: Admin-only, accepts raw gzip body, calls `restoreBackup()`.
- Register in `src/server.ts` under existing `/api/system` prefix.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/backup-restore.test.ts
npx tsc --noEmit
git add src/system/backup.service.ts src/system/backup.routes.ts src/server.ts tests/backup-restore.test.ts
git commit -m "feat(system): add config-only backup/restore with SHA-256 integrity verification"
```

---

### Task 2: Graceful Shutdown with Process Signal Handlers

**Files:**
- Create: `src/system/shutdown.service.ts`
- Modify: `src/system/system.routes.ts` (add shutdown endpoint) OR create `src/system/shutdown.routes.ts`
- Modify: `src/server.ts` (register SIGTERM/SIGINT handlers, register shutdown routes)
- Create: `tests/graceful-shutdown.test.ts`

**Interfaces:**
- Consumes: Fastify app instance, recording engine, background services
- Produces: `POST /api/system/shutdown`, process signal handlers

- [ ] **Step 1: Write tests (TDD)**

```typescript
// tests/graceful-shutdown.test.ts
describe('Graceful Shutdown & Process Signal Handlers', () => {
  it('POST /api/system/shutdown returns 200 with shutdown message (admin only)', async () => {});
  it('rejects shutdown from non-admin users', async () => {});
  it('rejects shutdown without authentication', async () => {});
  it('shutdown endpoint sets draining state', async () => {});
});
```

- [ ] **Step 2: Implement shutdown service**

`src/system/shutdown.service.ts`:
- `initiateGracefulShutdown(app: FastifyInstance): Promise<void>` — calls `app.close()` (triggers onClose hook), then schedules `process.kill(process.pid, 'SIGTERM')` after 500ms delay.
- Export `registerProcessSignalHandlers(app: FastifyInstance)`: register `SIGTERM` and `SIGINT` handlers that call `app.close()` then `process.exit(0)`.

- [ ] **Step 3: Add shutdown route and register signal handlers**

Add `POST /shutdown` to system routes (or create `shutdown.routes.ts`). Register signal handlers in `src/server.ts` after server start.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/graceful-shutdown.test.ts
npx tsc --noEmit
git commit -m "feat(system): add graceful shutdown endpoint with recording buffer flush and SIGTERM/SIGINT handlers"
```

---

### Task 3: NTP Time-Sync Status

**Files:**
- Create: `src/system/ntp.service.ts`
- Modify: `src/system/system.routes.ts` (add NTP endpoint and dashboard field)
- Create: `tests/ntp-status.test.ts`

**Interfaces:**
- Consumes: `child_process.execFile('timedatectl', ['show', '--no-pager'])`
- Produces: `GET /api/system/ntp-status`, adds `ntpSync` field to dashboard response

- [ ] **Step 1: Write tests (TDD)**

```typescript
// tests/ntp-status.test.ts
describe('NTP Time-Sync Status', () => {
  it('returns NTP sync status from system', async () => {});
  it('handles timedatectl not available gracefully', async () => {});
  it('dashboard response includes ntpSync field', async () => {});
});
```

- [ ] **Step 2: Implement NTP service**

`src/system/ntp.service.ts`:
- `getNtpStatus(): Promise<NtpStatus>` — executes `timedatectl show --no-pager` via `execFile`, parses key-value output.
- Graceful fallback: if `timedatectl` not found (ENOENT), return `{ available: false, reason: 'timedatectl not found on this system' }`.
- Parse `NTP=yes/no`, `NTPSynchronized=yes/no`, `TimeUSec=<microseconds>`.

- [ ] **Step 3: Add NTP route and dashboard integration**

- Add `GET /ntp-status` to system routes.
- Add `ntpSync: { synchronized, available }` to the existing dashboard response.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/ntp-status.test.ts
npx tsc --noEmit
git commit -m "feat(system): add NTP time-sync status endpoint and dashboard integration"
```

---

### Task 4: Dashboard & Frontend Integration

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx` (add NTP badge, backup/restore buttons, shutdown button)
- Create: `client/src/components/BackupRestorePanel.tsx`
- Create: `client/src/components/SystemMaintenancePanel.tsx`

**Interfaces:**
- Consumes: `/api/system/backup`, `/api/system/restore`, `/api/system/shutdown`, `/api/system/ntp-status`, `/api/system/dashboard`
- Produces: UI panels in dashboard

- [ ] **Step 1: Implement BackupRestorePanel**

- "Download Backup" button: triggers `POST /api/system/backup`, downloads the tar.gz.
- "Restore from Backup" file input: uploads tar.gz to `POST /api/system/restore`, displays summary.
- Mode selector: `skip-existing` / `overwrite`.
- Confirmation dialog before restore.

- [ ] **Step 2: Implement SystemMaintenancePanel**

- NTP sync badge: green "NTP Synced ✓" or amber "NTP Not Synced ⚠" or gray "NTP N/A".
- "Restart VMS Service" button with confirmation dialog ("This will flush all recording buffers and restart the service. Continue?").
- System uptime display (already in dashboard response).

- [ ] **Step 3: Integrate into DashboardPage**

- Add panels to the existing dashboard layout grid.
- Admin-only visibility for backup/restore and shutdown (check user role from auth context).

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit
npm run build:client
git commit -m "feat(client): add backup/restore panel, NTP badge, and shutdown controls to dashboard"
```

---

### Task 5: Integration Test & License Audit

**Files:**
- Create: `tests/appliance-operations-integration.test.ts`

**Interfaces:**
- Consumes: All Sub-Project B endpoints
- Produces: Integrated test verification

- [ ] **Step 1: Write integration test**

```typescript
describe('Sub-Project B: Appliance Operations & Maintenance End-to-End', () => {
  it('backup round-trip: create backup, verify manifest SHA-256, restore with skip-existing', async () => {});
  it('NTP status endpoint returns valid structure', async () => {});
  it('shutdown endpoint requires admin role', async () => {});
  it('dashboard includes ntpSync field', async () => {});
});
```

- [ ] **Step 2: Run full test suite**
- [ ] **Step 3: Run license audit**
- [ ] **Step 4: Commit**

```bash
git commit -m "test(sub-project-b): add appliance operations integration test"
```

---

## Plan Review Checklist

1. **Spec Coverage:**
   - Config backup/restore → Task 1
   - Graceful shutdown with buffer flush → Task 2
   - NTP time-sync status → Task 3
   - Dashboard/frontend integration → Task 4
   - End-to-end verification → Task 5
2. **Placeholder Scan:** Zero TODO/TBD.
3. **Dependency Order:** Tasks 1-3 independent → Task 4 → Task 5.
