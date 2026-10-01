# Sub-Project D Design Specification: Installer Handoff & Audit Security

**Version:** 1.0  
**Date:** 2026-10-01  
**Scope:** VMS-Lite Post-MVP Production Elevation (Sub-Project D)  
**Branch:** `feature-installer-handoff-audit`

## Overview

**Sub-Project D (Installer Handoff & Audit Security)** delivers the final operational guardrails for site deployment, regulatory compliance, and installation sign-off:
1. **First-Boot Setup Wizard & Status Detection**:
   - Detects whether the system is in "first-boot" state (default `admin` password unchanged, initial network parameters unconfirmed).
   - `GET /api/system/setup-status` returning `{ isFirstBoot: boolean, defaultPasswordActive: boolean, needsNetworkSetup: boolean }`.
   - `POST /api/system/setup-complete`: Changes default admin password, configures site name / timezone, and clears first-boot status.
   - UI blocking modal guiding the installer through mandatory initial configuration.
2. **Comprehensive Security & Operator Audit Log**:
   - `AuditLog` database model storing timestamp, user ID, username, action type (`AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_FAILURE`, `LIVE_VIEW_START`, `EVIDENCE_EXPORT`, `CONFIG_CHANGE`, `CAMERA_MODIFY`), resource target, client IP, and metadata JSON.
   - `AuditService` with automatic logging integration in auth, streaming, export, and settings controllers.
   - `GET /api/audit/logs` with rich query filters (action, username, date range, pagination).
   - Dedicated Searchable Audit Log UI in the operator web console with export to CSV/JSON.
3. **Installer Handoff Acceptance Certificate**:
   - `GET /api/system/handoff-report` generating a formal printable HTML/PDF-ready Acceptance Certificate summarizing:
     - Appliance metadata (hostname, uptime, OS/Node versions, disk models & S.M.A.R.T. status).
     - Network configuration (IP address, ports, NTP sync status).
     - Camera fleet roster (name, RTSP URL, live status, frame resolution, storage mode).
     - Storage retention calculation (FIFO retention days, disk utilization).
     - Installer verification checklist & physical sign-off signature blocks for client and technician.

## Locked Architectural Decisions

- **First-Boot State**: Tracked via `OperationalSettings` / database state. If `admin` password matches default `admin123`, `isFirstBoot` is true. Navigation in client is restricted until completed.
- **Audit Table**: `AuditLog` model in `schema.prisma`. All user logins, failed auth, evidence export, live stream access, and configuration edits generate structured audit rows.
- **Handoff Certificate**: Server-rendered standalone HTML report with print CSS styling, client branding, and camera audit snapshot, ready for physical signing and digital archiving.
