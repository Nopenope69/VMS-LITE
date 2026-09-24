# Phase 8: Operator Role & Granular RBAC - Technical Research

**Phase:** 08-operator-role-granular-rbac
**Requirement:** EXT-01 (`extended.operator_role`)
**Date:** 2026-09-24

## 1. Domain Context & Requirements

In commercial SMB installations, gated housing societies, and factories:
- **Admin**: System installer or facility IT manager. Configures cameras, storage quotas, recording schedules, and licenses.
- **Operator (Guard)**: Security guard or desk operator. Monitors live multi-camera grids 24/7, scrubs playback footage during incidents, controls PTZ, and bookmarks events. Must NEVER be allowed to change camera IP addresses, delete cameras, edit retention policies, or touch network settings.
- **Viewer**: Baseline monitoring account (from Package 1 Core) with unsegmented read-only visibility.

Requirement `EXT-01` specifies that when the `extended.operator_role` capability is enabled via an Extended license:
1. Admins can create and assign users the `OPERATOR` role.
2. Admins can configure per-camera access controls (`CameraPermission`) defining whether an Operator can:
   - `canViewLive`: Access WHEP/HLS live video streams.
   - `canViewPlayback`: Query fMP4 recording segments and scrub the timeline.
   - `canControlPtz`: Send PTZ directional and zoom commands (Phase 9 integration).
   - `canExportClips`: Request MP4 video clip downloads (Phase 10 integration).
   - `canCreateBookmarks`: Create incident tags on the timeline (Phase 10 integration).
3. If an Operator attempts to access unauthorized cameras or administrative settings, the system rejects with `403 Forbidden`.

---

## 2. Database Schema Design (Prisma)

### Role Enum & CameraPermission Model
```prisma
enum Role {
  ADMIN
  OPERATOR
  VIEWER
}

model User {
  id           String   @id @default(uuid())
  username     String   @unique
  passwordHash String
  role         Role     @default(VIEWER)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  cameraPermissions CameraPermission[]

  @@map("users")
}

model Camera {
  // Existing fields ...
  cameraPermissions CameraPermission[]
  // ...
}

model CameraPermission {
  id              String   @id @default(uuid())
  userId          String   @map("user_id")
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  cameraId        String   @map("camera_id")
  camera          Camera   @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  canViewLive     Boolean  @default(true)  @map("can_view_live")
  canViewPlayback Boolean  @default(true)  @map("can_view_playback")
  canControlPtz   Boolean  @default(false) @map("can_control_ptz")
  canExportClips  Boolean  @default(false) @map("can_export_clips")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@unique([userId, cameraId])
  @@map("camera_permissions")
}
```

---

## 3. Fastify Authorization Hooks & Seams

### Pre-Handler Hook: `requireCameraPermission`
To keep route controllers completely decoupled from database queries:
```typescript
export function requireCameraPermission(permission: 'canViewLive' | 'canViewPlayback' | 'canControlPtz' | 'canExportClips') {
  return async function (request: FastifyRequest<{ Params: { id?: string; cameraId?: string } }>, reply: FastifyReply) {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
    }

    // Admins always have full bypass
    if (user.role === Role.ADMIN) return;

    // Viewers have baseline read access to all cameras (Package 1 Core compatibility)
    if (user.role === Role.VIEWER) {
      if (permission === 'canControlPtz' || permission === 'canExportClips') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Viewers cannot perform this operation' });
      }
      return;
    }

    // Operators require explicit CameraPermission record
    if (user.role === Role.OPERATOR) {
      const targetCameraId = request.params.id || request.params.cameraId;
      if (!targetCameraId) return;

      const perm = await prisma.cameraPermission.findUnique({
        where: { userId_cameraId: { userId: user.id, cameraId: targetCameraId } }
      });

      if (!perm || !perm[permission]) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: `Operator lacks permission '${permission}' for camera '${targetCameraId}'`
        });
      }
    }
  };
}
```

### Camera List Filtering
When an Operator calls `GET /api/cameras`:
```typescript
if (request.user.role === Role.OPERATOR) {
  const permissions = await prisma.cameraPermission.findMany({
    where: { userId: request.user.id, OR: [{ canViewLive: true }, { canViewPlayback: true }] },
    select: { cameraId: true }
  });
  const allowedIds = new Set(permissions.map(p => p.cameraId));
  return cameras.filter(c => allowedIds.has(c.id));
}
```

---

## 4. Frontend UI/UX Integration (Palette 1)

1. **Role-Aware Navigation**:
   - `ADMIN`: Sees all tabs (Live, Playback, Cameras, Settings, Users & Access).
   - `OPERATOR`: Sees only Live View and Playback. The "Add Camera", "Storage Rollover", "Recording Schedule", and "Users" tabs are completely hidden from the sidebar.
   - `VIEWER`: Sees Live View and Playback in pure monitor mode.
2. **Users & Access Management Tab** (Admin only):
   - User table showing Username, Role (`Admin`, `Operator`, `Viewer`), Created Date.
   - Modal to create a new user or edit role.
   - When editing an `Operator`, displays an interactive grid of cameras with checkboxes:
     - `Live View` [x]
     - `Playback` [x]
     - `PTZ Control` [ ]
     - `Export Clips` [ ]
3. **Session Persistence**:
   - `AuthContext` decodes JWT and exposes `user.role`.
   - Dynamic UI banner for operators showing "Operator Shift Mode (Restricted Access)".

---

## 5. Backward Compatibility & Capability Gating

- **Capability Gating**: Attempting to assign `Role.OPERATOR` or manage `camera_permissions` when the license lacks `extended.operator_role` returns `403 Forbidden` (`Missing required capability: 'extended.operator_role'`).
- **Core Fallback**: Systems on a Core license default strictly to `Admin` and `Viewer`.
- **Database Safety**: Existing Core deployments upgrading to v2.0 keep all existing users and cameras without data loss.
