# Phase 18: Operator Controls & System Dashboard - Validation Plan

## Requirements Covered
- **MVP-10**: Operator Live Controls (Instant Canvas Snapshot, Multi-Grid Kiosk Fullscreen, CSS Digital Zoom 1x-4x).
- **MVP-11**: System Overview Landing Dashboard (Camera Fleet Health, Recording Status, Storage Pool Gauge, Uptime, Recent Security Alerts).

## Automated & Visual Verification Criteria
1. **Instant Snapshot**:
   - `captureSnapshot(videoElement, cameraName)` correctly creates `<canvas>`, draws frame, generates blob URL, and triggers download.
2. **Digital Zoom**:
   - Zoom in/out transforms scale between 1.0x and 4.0x.
   - Panning adjusts `translate(x, y)` when zoom > 1.0x.
   - Reset button restores scale to 1.0x and `translate(0, 0)`.
3. **Multi-Grid Kiosk Fullscreen**:
   - Fullscreen toggle switches layout to kiosk mode.
   - Restores smoothly on ESC or exit button.
4. **Dashboard Backend Endpoint (`GET /api/system/dashboard`)**:
   - Returns valid JSON payload containing `status`, `uptimeSeconds`, `fleet`, `recording`, `storage`, and `recentEvents`.
   - RBAC requires valid JWT authentication.
5. **Dashboard UI**:
   - Renders health summary cards, storage bar with warning/critical thresholds, and real-time events feed.
   - Quick action buttons successfully switch tabs to `live`, `playback`, and `cameras`.
6. **Code & Build Quality**:
   - `npm run build:client` passes with zero errors.
   - `npm run build` passes with zero errors.
   - Full test suite passes 100%.
