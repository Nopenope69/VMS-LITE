# Phase 9: ONVIF PTZ Controls & Camera Presets - Technical Research

**Phase:** 09-onvif-ptz-controls-camera-presets  
**Requirement:** EXT-03 (`extended.ptz`)  
**Date:** 2026-09-24  

---

## 1. Domain Context & Requirements

In commercial CCTV systems (such as CP Plus, Hikvision, and Dahua NVRs), PTZ (Pan-Tilt-Zoom) functionality is essential for active perimeter tracking, gate monitoring, and guard surveillance patrols.

Requirement **EXT-03** dictates:
1. **Continuous & Directional Movement**: Operators and Admins can command cameras to Pan (left/right), Tilt (up/down), and Zoom (in/out) via directional buttons or virtual joystick with sub-200ms latency.
2. **1.5-Second Server-Side Safety Watchdog**: Unbounded camera movement is an existential mechanical risk (motor strain, gear burnout, tangled cabling). Whenever a `ContinuousMove` is initiated, the server MUST run a 1500ms watchdog timer that auto-fires `Stop` if the client drops offline, closes the tab, or fails to send a stop command.
3. **Preset Management**: Operators can save, list, recall, and delete camera preset positions (`GetPresets`, `GotoPreset`, `SetPreset`, `RemovePreset`), as well as run preset tours (sequential sweeps).
4. **Access Control & Licensing**:
   - Gated by license capability `extended.ptz`.
   - Gated by RBAC ACL `requireCameraPermission('canControlPtz')`.
   - Viewers are prohibited from sending PTZ commands (`403 Forbidden`).

---

## 2. Media Plane & ONVIF Integration (`node-onvif`)

### 2.1 Native `node-onvif` Capabilities
The project utilizes the pinned `node-onvif` library. Inspection of `node-onvif` reveals:
1. `OnvifDevice.ptzMove(params, callback)`:
   - Takes `{ speed: { x: float, y: float, z: float }, timeout: seconds }`.
   - Profile token defaults to `device.current_profile.token`.
   - Employs `device.services['ptz'].continuousMove(...)`.
2. `OnvifDevice.ptzStop(callback)`:
   - Halts active Pan, Tilt, and Zoom operations via `device.services['ptz'].stop(...)`.
3. `device.services['ptz']` exposes full Profile S preset management:
   - `getPresets({ ProfileToken })`: Retrieves array of stored presets with tokens and names.
   - `gotoPreset({ ProfileToken, PresetToken, Speed })`: Drives the camera to target preset.
   - `setPreset({ ProfileToken, PresetName })`: Persists current coordinates under the given name.
   - `removePreset({ ProfileToken, PresetToken })`: Deletes a saved preset.

### 2.2 Abstraction Seam: `ICameraProvider`
To maintain the project's zero-hardware-lock-in principle, all ONVIF PTZ operations are mediated through the internal `ICameraProvider` interface:

```typescript
export interface PtzMoveParams {
  speed: {
    x?: number; // Pan: -1.0 (left) to 1.0 (right)
    y?: number; // Tilt: -1.0 (down) to 1.0 (up)
    z?: number; // Zoom: -1.0 (out) to 1.0 (in)
  };
  timeout?: number; // ONVIF hardware timeout in seconds
}

export interface CameraPreset {
  token: string;
  name: string;
}

export interface ICameraProvider {
  // Existing discovery & stream methods...
  ptzMove(params: CameraConnectionParams, move: PtzMoveParams, profileToken?: string): Promise<void>;
  ptzStop(params: CameraConnectionParams, profileToken?: string): Promise<void>;
  getPresets(params: CameraConnectionParams, profileToken?: string): Promise<CameraPreset[]>;
  gotoPreset(params: CameraConnectionParams, presetToken: string, profileToken?: string): Promise<void>;
  setPreset(params: CameraConnectionParams, presetName: string, profileToken?: string): Promise<string>;
  removePreset(params: CameraConnectionParams, presetToken: string, profileToken?: string): Promise<void>;
}
```

---

## 3. Server-Side Safety Watchdog Architecture

### 3.1 The Runaway Problem
When an operator clicks and holds a direction in a browser:
- If the browser tab is closed,
- If the network drops or Wi-Fi reconnects,
- If the user releases the pointer outside the window,
the camera would continue panning indefinitely until it hits mechanical stops or burns its stepper motor.

### 3.2 Watchdog Design in `PtzService`
The `PtzService` maintains a singleton map of active watchdog timers indexed by `cameraId`:

```typescript
class PtzService {
  private activeTimers = new Map<string, NodeJS.Timeout>();

  async continuousMove(cameraId: string, speed: { x?: number; y?: number; z?: number }) {
    // 1. Clear existing timer for this camera
    this.clearWatchdog(cameraId);

    // 2. Dispatch hardware move via camera provider
    await this.provider.ptzMove(connectionParams, { speed, timeout: 2 });

    // 3. Set 1500ms safety watchdog auto-stop
    const timer = setTimeout(async () => {
      try {
        await this.stop(cameraId);
      } catch (err) {
        logger.warn({ cameraId, err }, 'PTZ watchdog stop execution failed');
      } finally {
        this.activeTimers.delete(cameraId);
      }
    }, 1500);

    this.activeTimers.set(cameraId, timer);
  }

  async stop(cameraId: string) {
    this.clearWatchdog(cameraId);
    await this.provider.ptzStop(connectionParams);
  }

  private clearWatchdog(cameraId: string) {
    const existing = this.activeTimers.get(cameraId);
    if (existing) {
      clearTimeout(existing);
      this.activeTimers.delete(cameraId);
    }
  }
}
```

---

## 4. REST API & Authorization Pipeline

### 4.1 Routes & Security Hooks
All PTZ endpoints are nested under `/api/cameras/:id/ptz` with 3 pre-handler security checks:
1. `authenticate`: Validates JWT session token.
2. `requireCameraPermission('canControlPtz')`:
   - `ADMIN`: Full bypass.
   - `OPERATOR`: Verifies `CameraPermission.canControlPtz === true`.
   - `VIEWER`: Returns `403 Forbidden`.
3. `requireCapability('extended.ptz')`:
   - Checks offline Ed25519 license. Returns `403 Forbidden` if license is Core tier.

### 4.2 Endpoint Contract
- `POST /api/cameras/:id/ptz/move`: Accepts `{ x?: number, y?: number, z?: number }` clamped [-1.0, 1.0].
- `POST /api/cameras/:id/ptz/stop`: Immediately stops motion.
- `GET /api/cameras/:id/ptz/presets`: Returns list of saved presets `[{ token, name }]`.
- `POST /api/cameras/:id/ptz/presets`: Saves current coordinates as `{ name: string }`.
- `POST /api/cameras/:id/ptz/presets/:token/goto`: Recalls target preset position.
- `DELETE /api/cameras/:id/ptz/presets/:token`: Removes preset position.

---

## 5. Frontend UI/UX (Palette 1: Kinetic High-Contrast)

### 5.1 HUD Controls Overlay (`PtzControlsOverlay.tsx`)
- **Theme**: Obsidian (`#090d16`), Slate (`#111827`), Ion Blue (`#4fc3f7`), Solar Amber (`#fb923c`).
- **Floating Directional Pad**:
  - 8 directional buttons (N, NE, E, SE, S, SW, W, NW) with active Ion Blue glow.
  - Center STOP button with Solar Amber ring.
  - `onPointerDown` initiates continuous move; `onPointerUp`/`onPointerLeave` sends stop.
- **Optical Zoom Bar**:
  - Zoom In (`+`) and Zoom Out (`-`) buttons with hold-to-zoom behavior.
- **Preset Quick Selector**:
  - Preset pill buttons for one-click jump.
  - Preset save dialog for administrators.
  - Preset tour player (cycles through presets with 5s dwell time).
- **Keyboard Navigation**:
  - Arrow keys: Pan and Tilt.
  - `+` / `-`: Optical Zoom.
  - `Space` / KeyUp: Stop.

---

## 6. Verification Architecture & Test Strategy

1. **Unit & Watchdog Tests (`tests/ptz.test.ts`)**:
   - Verify `PtzService` watchdog triggers `ptzStop` after 1500ms timeout using Vitest fake timers (`vi.useFakeTimers()`).
   - Verify subsequent moves cancel and reset previous watchdog timers.
   - Verify `requireCapability('extended.ptz')` blocks requests when capability is missing.
   - Verify Operator ACL: `canControlPtz: true` permits move; `canControlPtz: false` rejects with 403.
   - Verify Viewer role is rejected with 403.
   - Verify preset listing, saving, and recall.
2. **Frontend Type Check**:
   - `npx tsc --noEmit && npx tsc --project client/tsconfig.json` with 0 errors.
