# Sub-Project D Implementation Plan: Installer Handoff & Audit Security

**Spec:** `docs/superpowers/specs/2026-10-01-installer-handoff-audit-design.md`  
**Branch:** `feature-installer-handoff-audit`

## Global Constraints

- **100% Permissive Licensing**: Standard Node.js & React APIs; zero copyleft dependencies.
- **Fail-Loud Runtime**: Explicit error messages on runtime failures.
- **Audit Defensibility**: Security events must record server-authoritative timestamps, IP addresses, and exact actor identity.

---

## Tasks

### Task 1: AuditLog Model & AuditService Engine
**Files**:
- Modify: `prisma/schema.prisma` (add `AuditLog` model and run `npx prisma generate`)
- Create: `src/audit/audit.service.ts`
- Create: `src/audit/audit.routes.ts`
- Modify: `src/server.ts` (register audit routes under `/api/audit`)
- Create: `tests/audit-service.test.ts`
**Description**:
- Add `AuditLog` model: `id`, `timestamp`, `userId`, `username`, `action`, `resource`, `ipAddress`, `metadata`, `createdAt`.
- Implement `AuditService` with methods to record and query audit logs with pagination and filters.
- Wire audit interceptors into login (`src/users/auth.routes.ts`), export (`src/export/export.routes.ts`), and streaming (`src/streaming/streaming.routes.ts`).

### Task 2: First-Boot Setup Wizard & Status API
**Files**:
- Create: `src/system/setup.service.ts`
- Create: `src/system/setup.routes.ts`
- Modify: `src/server.ts` (register setup routes)
- Create: `tests/setup-wizard.test.ts`
**Description**:
- Implement `GET /api/system/setup-status` checking if default admin credentials exist or setup flag is unset.
- Implement `POST /api/system/setup-complete` to update admin password, site name, and mark setup completed.

### Task 3: Installer Handoff Acceptance Certificate Endpoint
**Files**:
- Create: `src/system/handoff.service.ts`
- Create: `src/system/handoff.routes.ts`
- Modify: `src/server.ts` (register handoff route)
- Create: `tests/handoff-certificate.test.ts`
**Description**:
- Build server-side HTML certificate generator compiling appliance telemetry, network parameters, camera roster, S.M.A.R.T. health, retention capacity, and formal installer/client sign-off blocks with print-optimized CSS.
- Expose `GET /api/system/handoff-report`.

### Task 4: Frontend First-Boot Wizard Modal & Searchable Audit Log UI
**Files**:
- Create: `client/src/components/FirstBootWizardModal.tsx`
- Create: `client/src/components/AuditLogViewerModal.tsx`
- Modify: `client/src/App.tsx` (trigger FirstBootWizard when setup-status indicates first boot, add Audit Log navigation button)
**Description**:
- Build `FirstBootWizardModal` enforcing admin password update on first login.
- Build `AuditLogViewerModal` with filtering by action, user, date, and CSV/JSON export.
- Verify client build with `tsc` and Vite.

### Task 5: Integration Test & Full License Audit
**Files**:
- Create: `tests/installer-handoff-audit-integration.test.ts`
**Description**:
- End-to-end test validating first-boot completion, audit recording on login/stream/export, handoff report generation, and 100% permissive licensing audit.
