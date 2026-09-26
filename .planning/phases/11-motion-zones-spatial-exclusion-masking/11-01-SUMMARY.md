---
phase: 11-motion-zones-spatial-exclusion-masking
plan: 01
subsystem: motion-zones-spatial-filtering
tags: [ray-casting, point-in-polygon, motion-zones, exclusion-masking, onvif, dynamic-cache, rbac, licensing]

# Dependency graph
requires:
  - phase: 01-foundation-licensing-event-bus
    provides: Licensing capability verifier, EventBus, and JWT authentication
  - phase: 06-onvif-motion-alerts-real-time-event-feed
    provides: OnvifEventListenerService and PullPoint SOAP parser
  - phase: 08-operator-role-granular-rbac
    provides: 3-tier RBAC (ADMIN, OPERATOR, VIEWER)
provides:
  - MotionZone Prisma model and ZoneType enum
  - Ray-Casting Point-in-Polygon (Jordan curve theorem) algorithm
  - Formalized multi-zone truth table evaluator (Exclusion wins; Inclusion require matches; full frame default)
  - Strict vertex bounds rejection ([0.0, 1.0], 3-32 vertices) without silent clamping
  - Dynamic in-memory camera zone cache (zero listener restarts)
  - ONVIF CellMotionDetector centroid approximation and motion event interception
  - Motion zones REST API with ADMIN mutation protection and test point evaluation
affects: [11-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sub-millisecond pure TypeScript Ray-Casting point-in-polygon"
    - "Exclusion-precedence multi-zone truth table"
    - "Grid-cell centroid approximation contract at ONVIF event-grid resolution"
    - "Dynamic in-memory cache invalidation ensuring immediate geometry updates without listener restarts"
    - "Strict vertex bounds rejection (HTTP 400) preventing silent coordinate distortion"

key-files:
  created:
    - src/zones/zone.types.ts
    - src/zones/spatial-motion-filter.ts
    - src/zones/motion-zone.service.ts
    - src/zones/zone.routes.ts
    - tests/motion-zones.test.ts
  modified:
    - prisma/schema.prisma
    - src/events/onvif-events.service.ts
    - src/server.ts

key-decisions:
  - "Grid-based ONVIF motion is evaluated using the normalized centroid of each active cell, operating at event-grid resolution"
  - "Internal naming strictly follows spatial event filtering (MotionZone, SpatialMotionFilter), avoiding confusion with video pixel privacy masking"
  - "Multi-zone truth table gives strict precedence to exclusion zones; drops immediately if any enabled exclusion zone is matched"
  - "Out-of-bounds coordinates (<0.0 or >1.0) and invalid vertex counts (<3 or >32) are strictly rejected with HTTP 400 (never silently clamped)"
  - "In-memory cache in SpatialMotionFilter is synchronized on zone CRUD so ONVIF events evaluate against new geometry with zero listener restarts"
  - "Zero AI dependencies: strictly deterministic computational geometry"

requirements-completed:
  - EXT-02

duration: 15m
completed: 2026-09-24
---

# Plan 11-01 Summary: Motion Zones & Spatial Exclusion Masking Backend Engine

**Delivered Ray-Casting Point-in-Polygon geometric filtering, formalized multi-zone truth table evaluation, ONVIF event grid centroid approximation, strict vertex bounds rejection, dynamic in-memory zone caching with zero listener restarts, and REST API routes.**

## Accomplishments

1. **Prisma Schema & Model Extensions**:
   - Added `enum ZoneType` (`INCLUSION`, `EXCLUSION`).
   - Added `model MotionZone` with normalized `coordinates` Json, `cameraId` index, and relations.
   - Refreshed Prisma Client via `npx prisma generate`.

2. **Ray-Casting Point-in-Polygon Engine (`SpatialMotionFilter`)**:
   - Implemented sub-millisecond Jordan Curve theorem algorithm (`isPointInPolygon`) in pure TypeScript.
   - Accurately evaluates convex, concave (L-shape), exterior, and degenerate polygons.
   - Formalized multi-zone truth table:
     1. Any enabled exclusion hit -> **DROP**.
     2. No exclusion hit + no inclusions configured -> **PASS** (full frame active).
     3. No exclusion hit + inclusion configured + matches at least one inclusion -> **PASS**.
     4. Otherwise -> **DROP** (outside configured inclusion zones).
   - Implemented `evaluateCellGrid` applying the normalized centroid approximation contract ($x = \frac{c+0.5}{cols}, y = \frac{r+0.5}{rows}$).

3. **Motion Zone Service (`MotionZoneService`)**:
   - Strict vertex bounds validator: enforces 3 to 32 vertices and normalized bounds $[0.0, 1.0]$. Throws on violation; never silently clamps.
   - Manages CRUD lifecycle with PostgreSQL and resilient in-memory fallback for offline testing.
   - Automatically synchronizes `SpatialMotionFilter` in-memory cache on every mutation.

4. **Dynamic In-Memory Cache (Zero Listener Restarts)**:
   - `SpatialMotionFilter` caches camera zones in memory (`Map<string, MotionZoneDto[]>`).
   - Zone changes apply instantaneously to the next ONVIF event without tearing down or restarting `OnvifEventListenerService` PullPoint subscriptions.

5. **ONVIF Motion Event Interception**:
   - `OnvifEventListenerService.processEvents` extracts spatial data (points, normalized coordinates, or grid bitmask cells).
   - Events in exclusion zones or outside inclusion zones are dropped before emitting to Core `EventBus`.
   - Legacy coarse alarms without spatial coordinates pass through with `spatialVerified: false` to maintain backwards compatibility.

6. **REST API & Security Controls**:
   - `GET /api/cameras/:id/zones`: Gated by `extended.motion_zones` capability.
   - `POST /api/cameras/:id/zones`: Restricted to `Role.ADMIN` and `extended.motion_zones`; validates with Zod.
   - `PUT /api/cameras/:id/zones/:zoneId`: Restricted to `Role.ADMIN`.
   - `DELETE /api/cameras/:id/zones/:zoneId`: Restricted to `Role.ADMIN`.
   - `POST /api/cameras/:id/zones/test`: Real-time coordinate test evaluation.

7. **Automated Verification**:
   - 20/20 unit and integration tests passing in `tests/motion-zones.test.ts`.
   - 58/58 passing across all existing test suites (`tests/export-bookmarks.test.ts`, `tests/ptz.test.ts`, `tests/operator-rbac.test.ts`).
