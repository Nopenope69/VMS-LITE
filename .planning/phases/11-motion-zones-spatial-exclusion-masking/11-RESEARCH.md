# Phase 11: Motion Zones & Spatial Exclusion Masking - Technical Research

**Phase:** 11-motion-zones-spatial-exclusion-masking  
**Requirement:** EXT-02 (`extended.motion_zones`)  
**Date:** 2026-09-24  

---

## 1. Domain Context & Mathematical Foundations

Commercial CCTV installations (factories, warehouses, residential gates, parking lots) are subject to high false alarm rates caused by:
- Swaying tree branches and foliage.
- Road traffic outside the property perimeter.
- Shadows, cloud shifts, and illumination changes.
- Indoor ceiling fans or moving equipment.

To eliminate false triggers without heavy AI compute models (which belong to Package 3), **EXT-02** implements geometric spatial filtering:
1. **Inclusion Zones**: Areas where motion detection is desired (e.g. walkways, doors, gates). If any inclusion zone is defined for a camera, motion events outside all inclusion zones are discarded.
2. **Exclusion Zones (Masks)**: Areas where motion detection must be suppressed (e.g. public streets, trees). If a motion event occurs within any exclusion zone, it is discarded immediately, even if it overlaps an inclusion zone.
3. **Normalized Coordinates**:
   - All vertices are stored as normalized floats $x \in [0.0, 1.0]$ and $y \in [0.0, 1.0]$.
   - This ensures polygons remain strictly aligned regardless of camera streaming resolution changes (e.g. 1080p, 4K, 720p substream).

---

## 2. Ray-Casting Algorithm (Point-in-Polygon)

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

### Spatial Filtering Logic
For a motion trigger at coordinate $P(x, y)$:
1. **Step 1 (Exclusion Check)**: If any enabled `EXCLUSION` zone contains $P$, **DROP EVENT**.
2. **Step 2 (Inclusion Check)**:
   - If there are NO enabled `INCLUSION` zones configured: entire frame is included by default $\implies$ **PASS EVENT**.
   - If one or more enabled `INCLUSION` zones exist: $P$ must be inside at least one inclusion zone $\implies$ if true, **PASS EVENT**, otherwise **DROP EVENT**.

---

## 3. ONVIF Event Mapping & Grid Cell Containment

ONVIF Profile T and Profile S motion detection can emit:
1. **CellMotionDetector (Grid bitmask)**:
   - Contains grid dimensions: `Columns` (e.g. 32) and `Rows` (e.g. 24), and a base64 or hex bitmask `Data` indicating active cells.
   - Each active cell index $(c, r)$ is converted to a normalized centroid:
     $$x = \frac{c + 0.5}{\text{Columns}}, \quad y = \frac{r + 0.5}{\text{Rows}}$$
   - The spatial filter evaluates whether any active cell centroid satisfies the inclusion/exclusion criteria.
2. **Point / Bounding Box**:
   - `SimpleItem Name="X" Value="0.45"`, `SimpleItem Name="Y" Value="0.60"` or normalized bounding box coordinates.
3. **Coarse Binary Alarm (`IsMotion=true`)**:
   - When spatial coordinates are absent in legacy camera profiles, the event is flagged with `spatialVerified: false`. If inclusion zones are strictly required, it can be evaluated according to camera setting (default: allow coarse alarms with warning or treat as center-frame).

---

## 4. Prisma Schema Design

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
  color       String?   // UI display hex (e.g. #10b981 for inclusion, #ef4444 for exclusion)
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([cameraId])
  @@map("motion_zones")
}
```

---

## 5. API Routes Specification

- `GET /api/cameras/:id/zones`:
  - Returns list of motion zones for camera.
  - Pre-handler: `[authenticate, requireCapability('extended.motion_zones')]`.
- `POST /api/cameras/:id/zones`:
  - Body: `{ name: string, zoneType: 'INCLUSION' | 'EXCLUSION', coordinates: Array<{x: number, y: number}>, enabled?: boolean, color?: string }`.
  - Pre-handler: `[authenticate, requireRole([Role.ADMIN]), requireCapability('extended.motion_zones')]`.
- `PUT /api/cameras/:id/zones/:zoneId`:
  - Updates zone properties.
  - Pre-handler: `[authenticate, requireRole([Role.ADMIN]), requireCapability('extended.motion_zones')]`.
- `DELETE /api/cameras/:id/zones/:zoneId`:
  - Deletes zone.
  - Pre-handler: `[authenticate, requireRole([Role.ADMIN]), requireCapability('extended.motion_zones')]`.
- `POST /api/cameras/:id/zones/test`:
  - Test coordinate containment: `{ x: number, y: number }`.
  - Returns `{ allowed: boolean, matchedInclusion: string[], matchedExclusion: string[] }`.

---

## 6. Frontend Interactive Polygon Canvas (SVG)

- Renders an SVG overlay on top of camera frame / snapshot.
- ViewBox: `0 0 1000 1000` (mapping to normalized `0.0` - `1.0`).
- **Drawing Mode**:
  - Click to add vertex point.
  - Rubber-band line follows cursor.
  - Clicking first point or double-clicking closes polygon (minimum 3 points).
- **Edit Mode**:
  - Drag vertex handles to reshape polygon.
  - Delete vertex or delete entire zone.
- **Visuals**:
  - Inclusion Zones: Emerald `#10b981` (translucent fill `fill-emerald-500/20`, stroke `stroke-emerald-400`).
  - Exclusion Zones: Solar Amber / Rose `#f43f5e` (translucent fill `fill-rose-500/20`, stroke `stroke-rose-400`).
- **Interactive Test Mode**:
  - User can click anywhere on the camera canvas to instantly verify whether motion at that point triggers an alert or is masked!
