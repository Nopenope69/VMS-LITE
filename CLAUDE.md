# VMS-Lite: project memory

Lighter sibling of VIGIL One VMS for customers who want many sites in one UI without
much AI/ML. One central server pulls every site's cameras over RTSP (site-to-site VPN
or port forwarding), records them and shows them grouped by site. Primary market:
India (Hikvision / Dahua / CP Plus cameras; default timezone Asia/Kolkata).

## Architecture (see ARCHITECTURE.md for detail)

- **Control plane**: Node 22, TypeScript, Fastify 5 (`src/`), Prisma 5 + PostgreSQL 16.
  Migrations in `prisma/migrations` (0001 to 0012); `npx prisma migrate dev --name x`.
- **Media plane**: MediaMTX 1.11 (`mediamtx.yml`), localhost-only. The app reconciles
  MediaMTX paths from the DB every 30 s and sweeps orphaned ones; path naming,
  desired state and proxy URLs live only in `src/mediamtx/camera-media-paths.ts`. Browsers never talk to MediaMTX directly:
  WHEP, HLS and fMP4 playback go through `/api/media` (JWT or HttpOnly `vms_media` cookie).
- **Client**: React 19 + Vite 7 + Tailwind 3 (`client/`), built into `client/dist`
  and served by the app.
- **Deploy**: `docker-compose.yml` (host networking; profiles `turn`, `https` with
  Caddy, `deploy/Caddyfile`), `deploy/install.sh` (`HTTPS_DOMAIN`/`HTTPS_EMAIL` enable
  HTTPS), `deploy/update.sh` (DB dump, update, health check, `--rollback`).

## Key behaviours worth knowing

- Sites: `Site` table, `camera.siteId`, site filter everywhere, per-site health.
  Operators get camera grants and/or site grants. `src/users/camera-scope.ts` is the one
  place that decides who may do what on which camera; every route under `/api/cameras`,
  `/recordings`, `/playback`, `/streaming`, `/media`, `/audit`, `/sites`, `/events` and
  `/system`
  must declare `config.cameraAccess` or the server refuses to start. `/api/auth/me`
  reports effective per-camera rights for every role; the client uses `can()` only.
  Browser API calls go through `apiFetch()` (`client/src/api/client.ts`): token and
  401 handling in one place.
- Site link outage: all cameras of a site (2 or more) unreachable gives one
  `site.offline` alert; covered camera alerts are tagged `metadata.siteOutage` and
  skipped by email, WhatsApp and webhooks alike (`src/health/site-outage.ts`). Whether an
  event alerts, its cooldown key and its link are decided only in
  `src/notifications/alert-policy.ts`; channels just format and deliver. Deleting a
  camera emits `camera.deleted` only. Events have a `site_id`.
- Health telemetry carries `videoCodec`, `hasSubStream`, `subVideoCodec`,
  `subBitrateKbps`. H.265 warnings come from `client/src/utils/codec.ts`. Sites have
  `uplinkMbps`; summaries report `bandwidthKbps` and `linkUsage`.
- Grids play the sub-stream; single view and recorded playback use the main stream.
- **Built but not wired into production yet** (no production caller; each waits for a
  real adapter, worker or UI before it is connected): storage tiering (`src/storage/`,
  `IStorageProvider`, `TieredStorageManager`; segments use the local filesystem
  directly), the AI pipeline (`src/ai/ai-pipeline-coordinator.ts`, `IAiWorker`, no
  worker exists), the durable job queue (`src/jobs/processing-job.queue.ts`), the
  detection store (`src/ai/detection.repository.ts`) and incident correlation
  (`src/incidents/`, no routes). Don't describe these as running features.
- `recording.segment_created` is emitted by Segment Ingest with the metadata in
  `segment-ingest.ts` (`emitSegmentCreated`); that is the contract.
- Recording lifecycle (`src/recordings/`): `segment-ingest.ts` is the only way into the
  catalog (scan of the recordings volume; every file gets one row: AVAILABLE, BUFFERED for
  MOTION_ONLY cameras, or QUARANTINED); `segment-validator.ts` checks MP4 box atoms
  without fsync. `retention-policy.ts` alone decides what may be deleted (tier
  lifetimes CONTINUOUS <= EVENT <= INCIDENT; holds: legal hold, bookmark +/- 2 min,
  running exports). `storage-controller.ts` keeps disk health, the write canary and
  FIFO rollover (quarantined first); protected footage over 25% alerts once, never
  auto-deletes.
- Storage invariants (`storage-invariants.service.ts`): one catalog row per AVAILABLE
  recording, one object per cataloged segment (missing files become MISSING), no
  uncatalogued video after a crash, protected evidence is never retained-out, and
  storage failure halts deletions. The audit runs once at engine start, only on mounted,
  writable storage; expired exports are pruned hourly. Deletion is two-phase: AVAILABLE -> DELETE_PENDING
  -> [unlink] -> DELETED or GARBAGE. `diagnostics-logger.ts` warns on slow I/O.
- Camera abstraction (`src/cameras/camera-provider.interface.ts`): ONVIF is the one
  provider; reachability checks use `src/cameras/tcp-probe.ts`. Health status rules are
  the pure `src/health/camera-status.ts`.
- Optional processing boundary: with AI disabled the core runs with zero processing
  overhead; worker failures stay isolated. Full spec: `docs/VMS_LITE_ARCHITECTURE_SPEC.md`.
- Times in alerts and reports use the appliance timezone (`src/system/time-format.ts`);
  the first-boot wizard's timezone overrides `TZ` from `.env`.
- Sessions are revocable (`User.tokenVersion`); completing the wizard's password
  change revokes earlier tokens.
- `TRUST_PROXY=true` trusts X-Forwarded-* from a proxy on this host only.
- Daily config backups (`src/system/backup-scheduler.ts`), listed at `/api/system/backups`.
- `/playback?cameraId=&t=` (alert e-mail links) opens Recordings at that moment.
- Licensing: `src/licensing/vendor-key.ts` holds the vendor public key and is still
  **empty**. The owner must run `node scripts/license-tool.mjs keygen` and keep the
  private key offline. Until then every install is evaluation mode (2 cameras).

## Commands

```bash
npm ci && npx prisma generate
npm run typecheck            # server + client
npm test                     # vitest, tests/**/*.test.ts, in-memory Prisma mock
npm run build && npm run build:client
# Browser end-to-end (CI job "Browser end-to-end", Google Chrome):
MEDIAMTX_BIN=... DATABASE_URL=postgresql://.../vms_e2e e2e/stack.sh start
npm run test:e2e             # here: E2E_CAMERA_CODEC=vp9 (stack) + E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PLAYBACK_DECODE=0
e2e/stack.sh stop
npm run audit:licenses       # regenerates third_party/; `git checkout third_party` if only the date changed
```

Conventions: tests live in `tests/` (`signAs()` in `tests/helpers/auth.ts` creates
real users; `extendedLicense()` in `tests/helpers/license.ts` for 32-camera tests).
Match the surrounding code's comment density; no model identifiers in commits.

## Status (2026-10-06)

Merged into `main`:
- PRs #1-#5 (Multi-site, site outage detection, site permissions, Fastify 5, HTTPS,
  daily backups, H.265 warnings, browser e2e CI, session revocation, `update.sh`).
- Commit `ef37621` on `main`: Implemented the 4-way separation architecture inspired by
  Kerberos Vault/Agent analysis:
  1. Storage abstraction (`IStorageProvider`, `LocalStorageProvider`, `TieredStorageManager`)
  2. Versioned contract (`SegmentCreatedEventV1` Zod schema with capture context and analysis hints)
  3. Durable edge job queue (`ProcessingJob` in PostgreSQL with unique deduplication and backoff)
  4. Spatio-temporal detection repository (`Detection` model with composite indexing)
  5. Asynchronous `AiPipelineCoordinator` with non-blocking error isolation.
- Migration `0008_processing_jobs_and_detections` added.
- Commit `4a75148` on `main`: five-phase appliance hardening (recording correctness,
  storage reliability, camera abstraction, incident correlation, optional processing
  boundary). Migrations `0009_recording_lifecycle_and_correctness` and
  `0010_incidents_and_event_correlation`.
- Commit `8901849` on `main`: storage invariants, two-phase deletion, crash-recovery
  matrix (`tests/storage-invariants-and-crash-recovery.test.ts`, 14 scenarios).
  Migration `0011_storage_invariants_and_garbage_state`.
- Last full-suite result recorded (at `ef37621`): 75 test files, 531/531 green. Not
  re-run since the three commits above; re-run `npm test` and `npm run typecheck`.
- Branches: `origin/vms-lite` holds an unrelated-history simulator prototype (with a
  committed `.agent/` GSD directory); four `feature-*` branches have no commits beyond `main`.

## Next steps

1. Owner's hardware pilot: real cameras, real VPN to a branch, a week of recording,
   `deploy/install.sh` with HTTPS, then try `deploy/update.sh`.
2. Owner generates the license key pair; embed the public key in `vendor-key.ts`.
3. Not yet tested: full `docker compose up` on an x86 Linux appliance (host
   networking, Caddy container). `docker compose build` was verified on the owner's
   Apple Silicon Mac.
4. Package 3 AI worker implementations: plug first lightweight ONNX/YOLO worker into
   `AiPipelineCoordinator` to consume from `ProcessingJobQueue`.
5. Ideas not started: alert when a site link is saturated; per-site timezone in
   alerts (sites have a `timezone` field, unused); check whether a live tile showing
   "No signal" recovers by itself when the camera comes back.
