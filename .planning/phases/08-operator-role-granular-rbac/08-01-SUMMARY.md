---
phase: 08-operator-role-granular-rbac
plan: 01
subsystem: auth-rbac
tags: [rbac, operator, permissions, acl, prisma, fastify]

# Dependency graph
requires:
  - phase: 01-foundation-licensing-event-bus
    provides: 2-role RBAC and licensing capability verifier
provides:
  - Role.OPERATOR enum and CameraPermission relational model in Prisma
  - requireCameraPermission Fastify pre-handler hook
  - Capability-gated Operator creation and per-camera permission management routes
  - Operator-filtered camera list in GET /api/cameras
affects: [08-02, 09-ptz, 10-export]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fine-grained per-camera ACL pre-handler hook (requireCameraPermission)"
    - "Capability-gated role provisioning (extended.operator_role)"
    - "Relational upsert for camera permission matrix"

key-files:
  created:
    - tests/operator-rbac.test.ts
  modified:
    - prisma/schema.prisma
    - src/users/rbac.guard.ts
    - src/users/auth.service.ts
    - src/users/auth.routes.ts
    - src/cameras/camera.routes.ts

key-decisions:
  - "Decoupled camera permission checks into requireCameraPermission pre-handler so routes remain clean of manual SQL queries"
  - "Admin retains universal bypass across all cameras and actions"
  - "Creating an OPERATOR role requires the extended.operator_role license capability"

requirements-completed:
  - EXT-01

duration: 10m
completed: 2026-09-24
---

# Plan 08-01 Summary: Operator Role & Granular RBAC Backend

**3-tier RBAC (`ADMIN`, `OPERATOR`, `VIEWER`) and per-camera permission ACLs implemented with capability gating and automated route enforcement.**

## Accomplishments

1. **Prisma Schema & Model Extensions**:
   - Added `OPERATOR` to `Role` enum.
   - Defined `CameraPermission` model with unique constraint `@@unique([userId, cameraId])` supporting `canViewLive`, `canViewPlayback`, `canControlPtz`, and `canExportClips`.
   - Validated schema and re-generated Prisma client types.

2. **ACL Guard Hook (`requireCameraPermission`)**:
   - Implemented `requireCameraPermission` in `src/users/rbac.guard.ts`.
   - Admin users bypass checks; Viewers retain baseline read access (live/playback); Operators require explicit database permissions matching the target camera.

3. **User & Permission Management API**:
   - `GET /api/auth/users`: Admin-only user directory.
   - `POST /api/auth/users`: Gated by `extended.operator_role` capability when creating `OPERATOR` accounts.
   - `GET /api/auth/users/:id/permissions`: Permission inspection.
   - `PUT /api/auth/users/:id/permissions`: Granular per-camera permission upserting.

4. **Camera Route Scoping**:
   - `GET /api/cameras` filters camera lists to only authorized cameras for Operators.
   - `GET /api/cameras/:id` enforces `requireCameraPermission('canViewLive')`.
   - Administrative endpoints (`POST`, `DELETE`, `discover`) remain strictly Admin-only.

5. **Test Suite Verification**:
   - Created `tests/operator-rbac.test.ts` covering capability checks, user listing, permission updates, operator camera filtering, and 403 authorization enforcement (10/10 tests passed).
