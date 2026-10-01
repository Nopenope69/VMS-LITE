# Sub-Project B Design Specification: Appliance Operations & Maintenance

**Version:** 1.0
**Date:** 2026-09-30
**Scope:** VMS-Lite Post-MVP Production Elevation (Sub-Project B)
**Branch:** `feature-appliance-operations`

## Overview

**Sub-Project B (Appliance Operations & Maintenance)** adds the three operational primitives that a field installer or site admin needs after initial deployment: one-click system configuration backup and restore, a controlled shutdown with recording buffer flush, and NTP time-sync visibility.

## Locked Decisions

1. **Backup Scope — Config-only.** Export Users, Cameras, MotionZones, RecordingSchedules, CameraPermissions, Bookmarks, WebhookEndpoints, NotificationConfig, and OperationalSettings. Exclude transient/historical data (Events, Recordings, ExportJobs, AuditLogs).

2. **Backup Format — JSON inside tar.gz.** Archive is `vms-backup-<ISO-date>.tar.gz` containing `manifest.json` (schema version, creation timestamp, model row counts, SHA-256 of config.json) and `config.json` (all model rows as JSON arrays, password hashes preserved as-is).

3. **Restore Strategy — Merge-safe with conflict resolution.** On restore, each record is matched by primary key or unique natural key (e.g. `Camera.rtspUrl`, `User.username`). A `mode` query parameter selects behavior: `skip-existing` (default, only insert new records) or `overwrite` (upsert all records from backup).

4. **Reboot/Shutdown — Software-only signal with buffer flush.** `POST /api/system/shutdown` flushes the recording engine (`engine.stop()`), tears down all background services, then sends `SIGTERM` to `process.pid`. The process manager (Docker restart policy / systemd) handles restart. No OS-level reboot command.

5. **NTP Detection — `timedatectl show` via child process.** Parse `NTPSynchronized`, `TimeUSec`, and NTP service status. Expose on `GET /api/system/ntp-status`. Display sync badge on dashboard. Zero new dependencies.

## Global Constraints

- **100% Permissive Licensing:** Only MIT, Apache-2.0, or BSD dependencies. Zero GPL/copyleft libraries.
- **Fail-Loud Runtime:** Zero synthetic fallbacks in production paths. Explicit error responses on file I/O, database, or system command failure.
- **Server-Authoritative:** Backup SHA-256 is computed server-side over exact archive bytes. Restore validates manifest integrity before applying.
- **Recording Invariant:** Shutdown flush must complete all in-progress segment writes before process exit.

## Feature Specifications

### Feature 1: System Configuration Backup & Restore

#### 1.1 Backup Endpoint

`POST /api/system/backup` (Admin-only, authenticated)

1. Query all config models from database (Users, Cameras, MotionZones, RecordingSchedules, CameraPermissions, Bookmarks, WebhookEndpoints, NotificationConfig).
2. Query operational settings from `settingsService`.
3. Assemble `config.json` with model arrays.
4. Compute SHA-256 of `config.json` bytes.
5. Build `manifest.json`:
   ```json
   {
     "version": "1.0",
     "schemaVersion": "vms-bare-v1",
     "createdAt": "<ISO-8601 UTC>",
     "hostname": "<os.hostname()>",
     "modelCounts": { "users": 3, "cameras": 9, ... },
     "configSha256": "<hex>"
   }
   ```
6. Create tar.gz archive in memory containing `manifest.json` and `config.json`.
7. Stream response with `Content-Type: application/gzip`, `Content-Disposition: attachment; filename="vms-backup-<ISO-date>.tar.gz"`.

#### 1.2 Restore Endpoint

`POST /api/system/restore` (Admin-only, authenticated)

- Accepts multipart upload of `.tar.gz` archive.
- Query parameter: `mode=skip-existing` (default) | `mode=overwrite`.
- Steps:
  1. Extract archive, validate `manifest.json` exists.
  2. Verify `manifest.schemaVersion === 'vms-bare-v1'`.
  3. Compute SHA-256 of extracted `config.json`, compare against `manifest.configSha256`. Reject on mismatch.
  4. Parse `config.json`, validate structure.
  5. For each model in dependency order (Users first, then Cameras, then dependent models):
     - `skip-existing`: INSERT only if no matching record exists.
     - `overwrite`: UPSERT (update if exists, insert if not).
  6. Return summary: `{ restored: { users: 2, cameras: 5, ... }, skipped: { users: 1, ... }, errors: [] }`.
- On any database error, transaction rolls back entirely. No partial restores.

### Feature 2: Graceful Shutdown with Buffer Flush

#### 2.1 Shutdown Endpoint

`POST /api/system/shutdown` (Admin-only, authenticated)

1. Set server to "draining" state (reject new requests with 503).
2. Flush recording engine: `await engine.stop()` (completes in-progress segment writes).
3. Stop all background services (health monitor, ONVIF events, notification dispatchers, WebSocket feed).
4. Disconnect database: `await prisma.$disconnect()`.
5. Send `SIGTERM` to `process.pid` after a 500ms delay (allows the HTTP response to be sent).
6. Response: `{ success: true, message: "Shutdown initiated. Service will restart via process manager." }`.

#### 2.2 Process Signal Handlers

Register `SIGTERM` and `SIGINT` handlers in `src/server.ts`:
- On signal, call `app.close()` which triggers the existing `onClose` hook (which already calls `engine.stop()` and service teardown).
- Log shutdown reason.
- Exit with code 0 after close completes.

### Feature 3: NTP Time-Sync Status

#### 3.1 NTP Status Endpoint

`GET /api/system/ntp-status` (Authenticated, any role)

1. Execute `timedatectl show --no-pager` via `child_process.execFile`.
2. Parse key-value output for:
   - `NTP` → NTP service enabled (boolean)
   - `NTPSynchronized` → Currently synchronized (boolean)
   - `TimeUSec` → System time in microseconds
3. If `timedatectl` is not available (e.g. macOS dev), fall back to `{ available: false, reason: "timedatectl not found" }`.
4. Response:
   ```json
   {
     "available": true,
     "ntpEnabled": true,
     "synchronized": true,
     "systemTimeUtc": "2026-09-30T12:00:00Z"
   }
   ```

#### 3.2 Dashboard Integration

Add NTP sync badge to the existing `/api/system/dashboard` response:
- New field: `ntpSync: { synchronized: boolean, available: boolean }`.
- Frontend: Display green "NTP ✓" or red "NTP ✗" badge in the dashboard system status section.
