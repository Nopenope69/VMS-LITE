# Phase 18: Operator Controls & System Dashboard - Research

## Context
Operators in guard cabins and SMB control rooms require two primary operational capabilities:
1. **Live Controls on Video Feeds**:
   - **Canvas Snapshot**: Immediate frame capture via HTML5 `<canvas>` and `drawImage(videoElement)`, triggering a browser download named `snapshot_{cameraName}_{YYYY-MM-DD_HH-mm-ss}.jpg`. Must operate purely client-side without burdening server transcode pipelines.
   - **Multi-Grid Kiosk Fullscreen**: Multi-monitor / dedicated guard station mode that hides browser toolbars, app header, and sidebar, maximizing the camera grid across the screen. Supports ESC or exit button to restore standard layout.
   - **CSS Digital Zoom (1x to 4x)**: Mouse wheel scroll and drag-to-pan across active video streams using client-side CSS transforms (`transform: scale(...) translate(...)`). Explicit boundary: No server-side transcode or PTZ dispatching.

2. **Operator Landing Dashboard**:
   - High-contrast system overview answering: *"Is my system working and protected right now?"*
   - Displays real-time camera fleet health (Online, Degraded, Offline), active recording engines vs motion buffer standby, storage pool gauge with estimated retention days, uptime counter, and recent security alerts stream.
   - Quick navigation shortcuts into Live Grid, 24h Timeline Playback, and Camera Roster.

## Technical Architecture
- **Snapshot Execution**:
  - `HTMLCanvasElement.getContext('2d').drawImage(videoElement, 0, 0, width, height)`
  - `canvas.toBlob((blob) => { download(blob) }, 'image/jpeg', 0.95)`
  - Works on both WebRTC `<video>` elements and HLS streams.
- **Digital Zoom Execution**:
  - Maintained via local React state per tile: `zoomLevel` (1.0 to 4.0, step 0.25) and `panOffset` `{ x: number, y: number }`.
  - Wheel event listener on video viewport:
    - Wheel up increases scale up to 4x.
    - Wheel down decreases scale down to 1x (resetting pan offset).
  - Mouse drag (`onMouseDown`, `onMouseMove`, `onMouseUp`) pans the zoomed viewport, clamped to container bounds so video cannot be dragged out of view.
  - Reset button or double-click quickly snaps back to 1.0x neutral zoom.
- **Multi-Grid Kiosk Fullscreen**:
  - Invokes `document.documentElement.requestFullscreen()` or container `requestFullscreen()`.
  - Listens to `fullscreenchange` events to update UI toggles and layout styles.
- **Dashboard Backend Endpoint (`GET /api/system/dashboard`)**:
  - Aggregates status from `CameraHealthMonitor`, `RecordingEngine` storage & motion buffer, `ICapabilityRegistry`, and `EventBus` recent event query.
  - Authenticated via JWT bearer token.
