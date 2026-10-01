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

Create sites in **Settings → Sites** (the first-boot site name becomes the first
site), pick the site when adding a camera, and move cameras between sites from
the **Cameras** page. The site selector in the sidebar filters every page; the
Overview shows health per site, and the Recordings timeline groups lanes by site
(click a site in the camera picker to load its cameras).

Operators can be granted a whole site in **Settings → User Accounts**: the grant
covers every camera at that site, including cameras added later, on top of any
per-camera grants. Operators only see the sites and cameras they are granted.

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
```

Schema changes: edit `prisma/schema.prisma`, then
`npx prisma migrate dev --name <change>` and commit the generated migration.
