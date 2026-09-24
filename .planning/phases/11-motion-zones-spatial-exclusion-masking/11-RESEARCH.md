# Phase 11: Motion Zones & Spatial Exclusion Masking - Technical Research

**Phase:** 11-motion-zones-spatial-exclusion-masking  
**Requirement:** EXT-02 (`extended.motion_zones`)  
**Date:** 2026-09-24 (Revised)  

---

## 1. Domain Context & Architectural Principles (VMS-Lite)

Commercial CCTV installations (factories, warehouses, residential gates, parking lots) are subject to high false alarm rates caused by:
- Swaying tree branches and foliage.
- Road traffic outside the property perimeter.
- Shadows, cloud shifts, and illumination changes.
- Indoor ceiling fans or moving equipment.

To eliminate false triggers without heavy AI compute models (which belong to Package 3), **EXT-02** implements geometric spatial event filtering:
1. **Spatial Event Filtering vs. Video Masking**:
   - This feature performs **spatial event filtering** (suppressing or passing ONVIF event triggers based on geometry).
   - It is **not image/pixel privacy masking** (which blacks out or blurs raw video frames).
   - Internal naming strictly follows: `MotionZone`, `SpatialMotionFilter`, `MotionZoneService` (never `PrivacyMaskEngine` or `VideoMaskService`).
2. **Normalized Coordinates**:
   - All vertices are stored as normalized floats $x \in [0.0, 1.0]$ and $y \in [0.0, 1.0]$.
   - Guarantees resolution-independence across camera profile switches (e.g. 1080p, 4K, 720p substream).
3. **Strict Vertex Bounds Rejection (No Silent Clamping)**:
   - Coordinates outside $[0.0, 1.0]$ must be rejected at the API boundary with HTTP 400 Bad Request.
   - The server must never silently alter or clamp the operator's intended polygon geometry.
4. **AI Boundary Fence**:
   - Phase 11 is strictly deterministic computational geometry. It does NOT depend on or execute neural networks, object detection (YOLO/SSD), or background subtractors.

---

## 2. Multi-Zone Truth Table & Ray-Casting Point-in-Polygon

The Jordan curve theorem states that every simple closed curve divides the Euclidean plane into an interior and exterior. The Ray-Casting algorithm tests whether a point $P(x, y)$ is inside a polygon by projecting an infinite ray along the positive $X$ axis and counting intersections with the polygon edges:

```typescript
export function isPointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>
): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const { x, y } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}
```

### Complete Multi-Zone Interaction Truth Table

| Exclusion Hit | Inclusion Configured | Inclusion Hit | Final Result |
| ------------- | -------------------- | ------------- | ------------ |
| **Yes**       | No                   | —             | **DROP**     |
| **Yes**       | Yes                  | No            | **DROP**     |
| **Yes**       | Yes                  | Yes           | **DROP**     |
| **No**        | No                   | —             | **PASS**     |
| **No**        | Yes                  | No            | **DROP**     |
| **No**        | Yes                  | Yes           | **PASS**     |

Deterministic evaluation logic:
```typescript
// 1. Exclusion wins immediately
if (matchesAnyExclusion) {
  return { allowed: false, reason: 'Matched exclusion zone' };
}

// 2. If no inclusion zones configured, entire frame is active
if (inclusionZones.length === 0) {
  return { allowed: true, reason: 'No inclusion zones configured; full frame active' };
}

// 3. Otherwise must match at least one inclusion zone
if (matchesAnyInclusion) {
  return { allowed: true, reason: 'Matched inclusion zone' };
}

return { allowed: false, reason: 'Outside all configured inclusion zones' };
```

---

## 3. ONVIF Event Mapping & Grid Cell Approximation Contract

### Architectural Contract:
> **Grid-based ONVIF motion is evaluated using the normalized centroid of each active cell. Zone filtering therefore operates at ONVIF event-grid resolution, not pixel/object resolution.**

ONVIF Profile T / S motion detectors emit:
1. **CellMotionDetector (Grid bitmask)**:
   - Contains grid dimensions: `Columns` (e.g. 32) and `Rows` (e.g. 24), and a base64 or hex bitmask `Data` indicating active cells.
   - Each active cell index $(c, r)$ is converted to a normalized centroid:
     $$x = \frac{c + 0.5}{\text{Columns}}, \quad y = \frac{r + 0.5}{\text{Rows}}$$
   - Evaluated using the centroid approximation contract.
2. **Point / Bounding Box**:
   - `SimpleItem Name="X" Value="0.45"`, `SimpleItem Name="Y" Value="0.60"` or normalized bounding box centroid.
3. **Coarse Binary Alarm (`IsMotion=true`) without Spatial Metadata**:
   - When spatial coordinates are absent, the event is marked `spatialVerified: false`. By default, it passes with a warning flag, ensuring legacy cameras remain alert-capable.

---

## 4. Dynamic In-Memory Zone Cache (Zero Listener Restarts)

Zone changes must take effect immediately on the very next ONVIF event without restarting the persistent ONVIF event listener or tearing down PullPoint subscriptions:

```
[ Admin / User ] ──> PUT /api/cameras/:id/zones
                           │
                           ▼
                  [ MotionZoneService ]
                     │             │
              (Persist DB)   (Invalidate / Update)
                     │             │
                     ▼             ▼
              [ PostgreSQL ]  [ SpatialMotionFilter Cache ]
                                   │
                           (Read latest zones)
                                   │
                                   ▼
                       [ OnvifEventListenerService ]
```

`SpatialMotionFilter` maintains a lightweight `Map<string, MotionZoneDto[]>` cache keyed by `cameraId`.

---

## 5. Prisma Schema Design

```prisma
enum ZoneType {
  INCLUSION
  EXCLUSION
}

model MotionZone {
  id          String    @id @default(uuid())
  cameraId    String    @map("camera_id")
  camera      Camera    @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  name        String
  zoneType    ZoneType  @default(INCLUSION) @map("zone_type")
  enabled     Boolean   @default(true)
  coordinates Json      // Array of { x: number, y: number }
  color       String?   // UI display hex (e.g. #10b981 for inclusion, #f43f5e for exclusion)
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([cameraId])
  @@map("motion_zones")
}
```

---

## 6. API Routes Specification

- `GET /api/cameras/:id/zones`:
  - Returns list of motion zones for camera.
  - Pre-handler: `[authenticate, requireCapability('extended.motion_zones')]`.
- `POST /api/cameras/:id/zones`:
  - Body: `{ name: string, zoneType: 'INCLUSION' | 'EXCLUSION', coordinates: Point[], enabled?: boolean, color?: string }`.
  - Rejects coordinates with $x, y \notin [0.0, 1.0]$ with HTTP 400.
  - Rejects polygon vertex counts $<3$ or $>32$ with HTTP 400.
  - Pre-handler: `[authenticate, requireRole([Role.ADMIN]), requireCapability('extended.motion_zones')]`.
- `PUT /api/cameras/:id/zones/:zoneId`:
  - Updates zone properties.
  - Validates coordinates bounds strictly.
  - Pre-handler: `[authenticate, requireRole([Role.ADMIN]), requireCapability('extended.motion_zones')]`.
- `DELETE /api/cameras/:id/zones/:zoneId`:
  - Deletes zone.
  - Pre-handler: `[authenticate, requireRole([Role.ADMIN]), requireCapability('extended.motion_zones')]`.
- `POST /api/cameras/:id/zones/test`:
  - Test coordinate containment: `{ x: number, y: number }`.
  - Returns `{ allowed: boolean, matchedInclusion: string[], matchedExclusion: string[], reason: string }`.

---

## 7. Frontend Interactive Polygon Canvas (SVG)

- Renders an SVG overlay on top of camera frame / snapshot (`viewBox="0 0 1000 1000"`).
- **Drawing Mode**: Click to add vertex point; rubber-band line follows cursor; clicking first point or double-clicking closes polygon (3-32 vertices).
- **Edit Mode**: Drag circular vertex handles to reshape polygon boundaries; constrained inside `[0, 1]`.
- **Visuals**:
  - Inclusion Zones: Emerald `#10b981` (fill `rgba(16, 185, 129, 0.2)`, stroke `#10b981`).
  - Exclusion Zones: Rose `#f43f5e` (fill `rgba(244, 63, 94, 0.25)`, stroke `#f43f5e`).
- **Interactive Test Mode**: Click anywhere on the camera canvas to instantly test point evaluation with live visual feedback badge.
