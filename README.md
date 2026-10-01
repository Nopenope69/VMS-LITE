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
