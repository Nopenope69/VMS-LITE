# VMS-Lite: project memory

Lighter sibling of VIGIL One VMS for customers who want many sites in one UI without
much AI/ML. One central server pulls every site's cameras over RTSP (site-to-site VPN
or port forwarding), records them and shows them grouped by site. Primary market:
India (Hikvision / Dahua / CP Plus cameras; default timezone Asia/Kolkata).

## Architecture (see ARCHITECTURE.md for detail)

- **Control plane**: Node 22, TypeScript, Fastify 5 (`src/`), Prisma 5 + PostgreSQL 16.
  Migrations in `prisma/migrations` (0001 to 0007); `npx prisma migrate dev --name x`.
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

## Status (2026-10-02)

Merged into `main`: PR #1 (architecture fixes, multi-site, site permissions, site
lanes), PR #2 (site-unreachable alert), PR #3 (Fastify 5, HTTPS, local alert
times, Node 22, daily backups, dev advisories), PR #4 (H.265 warnings, per-site
link bandwidth, browser end-to-end CI job incl. recorded playback in Chrome,
alert e-mail playback link fix, session-cache revocation race fix, `deploy/update.sh`).
Both CI jobs (unit/typecheck/migrations/licenses, browser end-to-end) passed on PR #4's final commit.

## Next steps

1. Owner's hardware pilot (planned 2026-10-03): real cameras, real VPN to a branch,
   a week of recording, `deploy/install.sh` with HTTPS, then try `deploy/update.sh`.
   Fix whatever it finds. Advice given: set each camera's sub-stream to H.264 and
   enter each site's uplink speed.
2. Owner generates the license key pair; embed the public key in `vendor-key.ts`.
3. Not yet tested: full `docker compose up` on an x86 Linux appliance (host
   networking, Caddy container). `docker compose build` was verified on the owner's
   Apple Silicon Mac.
4. Ideas not started: alert when a site link is saturated; per-site timezone in
   alerts (sites have a `timezone` field, unused); check whether a live tile showing
   "No signal" recovers by itself when the camera comes back (not verified).
