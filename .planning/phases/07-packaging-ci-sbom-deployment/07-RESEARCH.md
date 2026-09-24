# Phase 7: Packaging, CI/SBOM & Single-Command Deployment - Research

**Researched:** 2026-09-24  
**Domain:** Docker Compose production topology, MediaMTX integration, Coturn STUN/TURN, single-command installer script, systemd auto-restart service, automated SBOM generation, and license compliance auditing  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from ROADMAP.md & PROJECT.md)

### Locked Decisions
- **Target Market & Deployment Bar**: Indian SMB and residential CCTV tier (CP Plus / Hikvision DVR replacement). Installer must achieve first working live view in under 30 minutes on bare customer hardware (`DEP-02`).
- **Single-Command Installer**: Installer can execute a single command (`curl -sSL ... | bash` or `./install.sh`) to provision Node runtime, MediaMTX, PostgreSQL, and Coturn (`DEP-01`).
- **100% Permissive Licensing Compliance**: Dependencies must be 100% permissively licensed (MIT, Apache-2.0, BSD, ISC). Absolutely zero copyleft (GPL, AGPL, LGPL, SSPL) (`DEP-04`).
- **Automated SBOM & License Inventory**: CI automatically outputs Software Bill of Materials (SBOM) and release license inventory in `third_party/licenses/` and `third_party/notices/` (`DEP-03`).
- **Power Loss Recovery**: System must automatically recover, remount storage, resume recording schedules, and restart streaming services upon host power restoration without manual installer intervention.
- **Zero VigilOne Domain Entanglement**: Standalone, clean-room deployment stack with zero enterprise multi-tenancy or compliance dependencies.

### Discretionary Decisions
- **Container Stack**: Docker Compose multi-container deployment:
  - `app`: Basic VMS Node.js / Fastify backend + static React frontend build
  - `mediamtx`: MediaMTX v1.11+ container for RTSP ingest, WebRTC (WHEP), HLS, fMP4 segmenting, and playback server
  - `postgres`: PostgreSQL 16 Alpine container with persistent local volume
  - `coturn`: Coturn container for STUN/TURN NAT traversal
- **Systemd Service**: Host systemd unit `basic-vms.service` managing the Docker Compose lifecycle (`ExecStart=/usr/bin/docker compose up -d`, `ExecStop=/usr/bin/docker compose down`, `Restart=always`).
- **Zero-Dependency License & SBOM Tooling**: Build high-performance, native Node.js scripts for license verification and CycloneDX SBOM generation without external proprietary scanner requirements.

### Deferred Ideas (OUT OF SCOPE)
- Multi-node Kubernetes / Helm clusters (overkill for single-site standalone NVR boxes)
- Multi-site cloud sync / offsite backups (Package 2 Extended)
- Cloud licensing entitlement server (Package 1 uses offline Ed25519 node licensing)
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Container Orchestration | Docker Compose | systemd unit | Standard, lightweight container orchestration on Linux hosts |
| Automated Provisioning | `deploy/install.sh` | `.env.production` | Generates random secrets, runs DB migrations, and brings up containers |
| Host Auto-Restart & Power-Loss Recovery | systemd (`basic-vms.service`) | Docker restart policies | Restarts daemon stack automatically upon host power restoration |
| License Compliance Verification | Node.js Script (`audit-licenses.ts`) | CI Action | Traverses lockfile and audits 100% permissive licenses |
| SBOM Generation | Node.js Script (`generate-sbom.ts`) | `sbom.json` | Generates CycloneDX / SPDX SBOM release artifact |
</architectural_responsibility_map>

<research_summary>
## Research Summary

### 1. Single-Command Installer (<30 min Setup)
Installers at customer sites typically run Ubuntu or Debian on budget mini-PCs or NVR boxes.
The installer script (`deploy/install.sh`):
1. Detects OS and verifies Docker & Docker Compose availability (installs via official convenience script if missing).
2. Generates a tailored `.env` file with cryptographically secure random passwords (Postgres password, JWT secret, Coturn TURN secret).
3. Configures local persistent recording directories (e.g., `/var/lib/basic-vms/recordings` and `/var/lib/basic-vms/postgres`).
4. Executes `docker compose up -d` with healthchecks.
5. Runs Prisma migrations inside the app container (`npx prisma migrate deploy`).
6. Polls `/health` endpoint until HTTP 200 is confirmed.
7. Installs and enables `basic-vms.service` in systemd for automatic startup on power restoration.
Total execution time: 2–4 minutes on a typical 100Mbps broadband connection.

### 2. MediaMTX Production Configuration
MediaMTX configuration file (`mediamtx.yml`):
- `api: yes` on port 9997 (internal control).
- `rtsp: yes` on port 8554 (camera ingest).
- `hls: yes` on port 8888 (HLS live streaming).
- `webrtc: yes` on port 8889 (WHEP low-latency WebRTC).
- `playback: yes` on port 9996 (fMP4 playback server).
- `runOnRecordSegmentComplete`: Triggers curl POST request to `http://app:3000/api/recordings/segments/complete` with segment metadata.

### 3. Automated License Compliance & SBOM
To fulfill `DEP-03` and `DEP-04`:
- Permissive licenses accepted: `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`.
- Prohibited licenses: Any GPL, AGPL, LGPL, SSPL, or Non-Commercial licenses.
- The auditor parses `package.json` and `package-lock.json`, queries `node_modules/*/package.json`, asserts license validity, and outputs:
  - `third_party/licenses/`
  - `third_party/notices/`
  - `sbom.json` (CycloneDX JSON format)
</research_summary>
