# VMS-Lite (Basic VMS)

Lightweight video management system for on-site appliances: live view (WebRTC, HLS
fallback), continuous / scheduled / motion recording, 24h timeline playback, ONVIF
motion events, health monitoring and alerts. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Install (Linux appliance)

```bash
./deploy/install.sh          # generates .env, builds and starts the stack
```

or manually:

```bash
cp .env.example .env         # set POSTGRES_PASSWORD (and JWT_SECRET, TZ, PUBLIC_HOST)
docker compose up -d --build
# Remote viewers behind strict NAT/CGNAT: set TURN_SECRET + TURN_SERVER_HOST, then
docker compose --profile turn up -d
```

Open `http://<appliance-ip>:3000` and sign in as `admin` / `admin123` (or
`ADMIN_INITIAL_PASSWORD`). The first-boot wizard forces a password change.

Ports: `3000/tcp` (UI, API, authenticated video proxy) and `8189/udp` (WebRTC media).
Everything else listens on localhost. Database migrations run automatically on start.

### HTTPS

Use HTTPS whenever the server is reached over the internet: without it, passwords
and video cross the network unencrypted. Pass a domain to the installer:

```bash
# Public certificate from Let's Encrypt (the domain must resolve to this server,
# ports 80 and 443 reachable from the internet)
HTTPS_DOMAIN=vms.example.com HTTPS_EMAIL=ops@example.com ./deploy/install.sh

# LAN / VPN-only install: certificate from Caddy's internal CA (browsers warn
# until that CA is trusted)
HTTPS_DOMAIN=192.168.1.50 ./deploy/install.sh
```

This starts Caddy (`deploy/Caddyfile`) on ports 443 and 80 (redirect) and keeps the
app on localhost, so port 3000 is no longer reachable from the network. WebRTC media
still uses `8189/udp` and is encrypted on its own. To switch an existing install,
add the settings listed under "HTTPS" in `.env.example` and run `docker compose up -d`.

## Multiple sites

One VMS-Lite server records and shows cameras from many locations. Each site's
cameras must be reachable from the server over RTSP, using one of:

- **Site-to-site VPN** (WireGuard, IPsec, the site router's VPN): add cameras by
  their LAN address at the site, e.g. `rtsp://user:pass@192.168.10.21:554/stream1`.
- **Port forwarding** on the site router: `rtsp://user:pass@<site-public-ip>:<port>/...`.
  Restrict the forwarded port to the server's IP.

Camera streams are pulled over TCP, so each camera sends one stream over the WAN
whoever is watching. Add a sub-stream URL when onboarding: multi-camera grids
use it to save bandwidth for viewers.

Set the sub-stream to **H.264** on the camera. Many cameras default to H.265, which
records fine but which most browsers cannot play live; the Cameras page flags
cameras whose live stream is H.265.

Give each site its upload capacity (**Settings → Sites → Uplink Mbps**) to see how
full its link is: the Overview site cards and the Health page show the video each
site is sending (main streams, plus sub-streams while someone watches a grid)
against that capacity, amber from 80% and red from 95%.

Create sites in **Settings → Sites** (the first-boot site name becomes the first
site), pick the site when adding a camera, and move cameras between sites from
the **Cameras** page. The site selector in the sidebar filters every page; the
Overview shows health per site, and the Recordings timeline groups lanes by site
(click a site in the camera picker to load its cameras).

If every camera at a site (2 or more) stops answering at once, the server treats it
as the site link going down (VPN, router or internet at the site): it raises one
**Site unreachable** alert, and another when the site is back, instead of one alert
per camera. Email and WhatsApp/SMS channels that send camera-offline alerts send
these too; webhooks can subscribe to `site.offline` / `site.online`. If only some
cameras fail, they are alerted individually as before.

Operators can be granted a whole site in **Settings → User Accounts**: the grant
covers every camera at that site, including cameras added later, on top of any
per-camera grants. Operators only see the sites and cameras they are granted.

## Updating an installed appliance

```bash
cd /opt/basic-vms              # wherever the appliance was installed
./deploy/update.sh             # latest version of the installed branch
./deploy/update.sh --ref v1.2.0   # or a specific tag/branch/commit
```

It refuses to run over local file changes, dumps the database to `backups/` first,
updates the code, rebuilds and restarts (database migrations run automatically) and
waits for the app to report healthy. Recordings are not touched. If the new version
does not come up, `./deploy/update.sh --rollback` restores the previous code and the
pre-update database.

## Backups

The server backs up its configuration (sites, cameras, users, permissions,
schedules; not recordings) once a day and keeps the last 14 in the `basic_vms_data`
volume. Admins list and download them with `GET /api/system/backups`, take one on
demand with `POST /api/system/backup`, and restore with `POST /api/system/restore`.
Copy backups off the appliance regularly: they protect against a broken database
or a bad change, not against losing the disk. They contain password hashes and
camera credentials, so store them securely.

## Licensing (vendor)

```bash
node scripts/license-tool.mjs keygen          # once; keep the private key offline
# paste the printed public key into src/licensing/vendor-key.ts, then per customer:
node scripts/license-tool.mjs issue --key ~/.basic-vms/license-private.key \
  --edition extended --cameras 32 --days 365
```

Set the token as `BASIC_VMS_LICENSE` in the customer's `.env`. Without a valid
license the appliance runs in evaluation mode (2 cameras).

## Develop

```bash
npm ci && npx prisma generate
# PostgreSQL + MediaMTX locally (mediamtx.yml works as-is on the host), then:
DATABASE_URL=postgresql://... RECORDINGS_PATH=./data/recordings npx prisma migrate deploy
npm run dev                   # control plane on :3000
npm run dev:client            # Vite on :5173, proxies /api to :3000
npm run dev:mock              # no database: in-memory demo data (not persisted)

npm test                      # unit/integration tests (in-memory Prisma mock)
npm run typecheck             # server + client

# Browser end-to-end test (CI runs it on every PR): needs ffmpeg, a MediaMTX binary,
# an empty database and the built app (npm run build && npm run build:client)
MEDIAMTX_BIN=/path/to/mediamtx DATABASE_URL=postgresql://.../vms_e2e e2e/stack.sh start
npm run test:e2e              # Google Chrome; or E2E_CHROMIUM_PATH=... E2E_PLAYBACK_DECODE=0
e2e/stack.sh stop
```

Schema changes: edit `prisma/schema.prisma`, then
`npx prisma migrate dev --name <change>` and commit the generated migration.
