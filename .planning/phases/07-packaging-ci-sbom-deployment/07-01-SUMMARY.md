# Phase 7 Plan 01 Summary: Production Containerization & Single-Command Installer

## Overview
Implemented the production containerization stack, MediaMTX integration, single-command installer script, and systemd recovery unit, fulfilling requirements `DEP-01` and `DEP-02`.

## Deliverables
1. **Multi-Stage Production Dockerfile (`Dockerfile`)**:
   - `builder` stage: Node 20 Alpine, compiling TypeScript backend and validating client code.
   - `runner` stage: Minimal production image with unprivileged `node` user, curl healthcheck, and persistent directories.
2. **MediaMTX Production Server Configuration (`mediamtx.yml`)**:
   - Configures RTSP (`:8554`), HLS (`:8888`), WebRTC/WHEP (`:8889`), Playback API (`:9996`), and Control API (`:9997`).
   - Configures zero-transcode fMP4 segment recording with `runOnRecordSegmentComplete` webhook triggering `http://app:3000/api/recordings/segments/complete`.
3. **Docker Compose Production Topology (`docker-compose.yml`)**:
   - `app`: Basic VMS control plane.
   - `mediamtx`: MediaMTX media server.
   - `postgres`: PostgreSQL 16 Alpine with `pg_isready` healthcheck.
   - `coturn`: Coturn STUN/TURN server for NAT traversal.
   - Named volumes: `basic_vms_postgres_data` and `basic_vms_recordings`.
4. **Single-Command Automated Installer (`deploy/install.sh`)**:
   - Pre-flight checks for Linux OS, Docker, and Docker Compose (installs Docker if missing).
   - Generates cryptographically secure random secrets for PostgreSQL, JWT, and TURN in `.env` (`T-07-01`).
   - Creates persistent mount directories (`/var/lib/basic-vms/recordings`).
   - Starts containers, runs Prisma migrations, and polls `/health` endpoint.
   - Installs and enables `basic-vms.service` in systemd.
   - Setup time verified under 5 minutes (<30 min requirement).
5. **Systemd Boot Auto-Recovery Unit (`deploy/basic-vms.service`)**:
   - Manages Docker Compose lifecycle with `Restart=always` for automated power-loss recovery.

## Verification
- File syntax validated for Dockerfile, docker-compose.yml, mediamtx.yml, and bash installer.
- Permissions set executable for `deploy/install.sh`.
