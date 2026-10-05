# VMS-Lite: project memory

Lighter sibling of VIGIL One VMS for customers who want many sites in one UI without
much AI/ML. One central server pulls every site's cameras over RTSP (site-to-site VPN
or port forwarding), records them and shows them grouped by site. Primary market:
India (Hikvision / Dahua / CP Plus cameras; default timezone Asia/Kolkata).

## Architecture (see ARCHITECTURE.md for detail)

- **Control plane**: Node 22, TypeScript, Fastify 5 (`src/`), Prisma 5 + PostgreSQL 16.
  Migrations in `prisma/migrations` (0001 to 0008); `npx prisma migrate dev --name x`.
- **Media plane**: MediaMTX 1.11 (`mediamtx.yml`), localhost-only. The app reconciles
  MediaMTX paths from the DB every 30 s. Browsers never talk to MediaMTX directly:
  WHEP, HLS and fMP4 playback go through `/api/media` (JWT or HttpOnly `vms_media` cookie).
- **Client**: React 19 + Vite 7 + Tailwind 3 (`client/`), built into `client/dist`
  and served by the app.
- **Deploy**: `docker-compose.yml` (host networking; profiles `turn`, `https` with
  Caddy, `deploy/Caddyfile`), `deploy/install.sh` (`HTTPS_DOMAIN`/`HTTPS_EMAIL` enable
  HTTPS), `deploy/update.sh` (DB dump, update, health check, `--rollback`).

## Key behaviours worth knowing

- Sites: `Site` table, `camera.siteId`, site filter everywhere, per-site health.
  Operators get camera grants and/or site grants (`src/users/camera-access.ts`).
- Site link outage: all cameras of a site (2 or more) unreachable gives one
  `site.offline` alert; covered camera alerts are tagged `metadata.siteOutage` and
  skipped by email/WhatsApp (`src/health/site-outage.ts`). Events have a `site_id`.
- Health telemetry carries `videoCodec`, `hasSubStream`, `subVideoCodec`,
  `subBitrateKbps`. H.265 warnings come from `client/src/utils/codec.ts`. Sites have
  `uplinkMbps`; summaries report `bandwidthKbps` and `linkUsage`.
- Grids play the sub-stream; single view and recorded playback use the main stream.
- Storage abstraction & tiering (`src/storage/`): `IStorageProvider`, `LocalStorageProvider`
  (enforcing root path containment), and `TieredStorageManager` for asynchronous
  offloading of mission-critical footage (bookmarks, motion alerts) to secondary object
  storage or NAS. Video segments are addressed via canonical `recording.id` and opaque
  artifact keys (`provider` + `key`), demoting physical file paths to internal details.
- Versioned segment event contract (`src/events/segment-created-event.schema.ts`):
  `SegmentCreatedEventV1` captures capture mode (`CONTINUOUS` vs `MOTION_ONLY`), motion
  `incidentId`, and generic `analysisHints` (`priority`, `preferredStream`). Emitted
  by `RecordingCatalog` carrying `siteId` and canonical storage URI.
- Durable processing jobs (`src/jobs/processing-job.queue.ts`): PostgreSQL-backed
  `ProcessingJob` queue with `UNIQUE(recordingId, jobType)`, priority claiming, and
  exponential backoff retry. Survives appliance power cuts and restarts without Redis or
  Kafka dependencies.
- Spatio-temporal detection store (`src/ai/detection.repository.ts`): Dedicated `Detection`
  table with composite indexes on `(cameraId, label, timestamp)` and `(siteId, label, timestamp)`
  for sub-second timeline smart queries ("find person at Gate 1 between 10-11 PM").
- AI worker harness (`src/ai/ai-pipeline-coordinator.ts`): `AiPipelineCoordinator`
  orchestrates durable jobs and async inference (`IAiWorker`) with strict error isolation,
  guaranteeing that worker exceptions, timeouts, or NPU OOMs never disrupt media capture.
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
- All 75 test files passed (531/531 tests green). Full typecheck clean (0 errors).

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
