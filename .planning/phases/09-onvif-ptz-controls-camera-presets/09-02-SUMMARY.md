---
phase: 09-onvif-ptz-controls-camera-presets
plan: 02
subsystem: ui-ptz
tags: [ptz, react, virtual-dpad, hud, overlay, presets, keyboard-shortcuts, palette-1]

# Dependency graph
requires:
  - phase: 09-01
    provides: PTZ move, stop, and preset REST API endpoints
  - phase: 08-02
    provides: AuthContext with role and per-camera ACL support
provides:
  - PtzControlsOverlay HUD component with 8-directional D-Pad and optical zoom stepper
  - Preset quick-selector and 5s tour runner
  - Live stream keyboard navigation (Arrow keys, +, -, Space)
  - Tile header PTZ toggle button with permission-aware rendering
affects: [10-clip-export]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Floating semi-transparent HUD overlay (Obsidian #090d16 / Slate #111827 / Ion Blue #4fc3f7)"
    - "Immediate pointerdown/pointerup event binding preventing continuous pan drift (Threat T-09-01)"
    - "Global keyboard shortcut capture when camera tile or overlay is active"
    - "Permission-filtered PTZ trigger button on live camera tiles"

key-files:
  created:
    - client/src/components/PtzControlsOverlay.tsx
  modified:
    - client/src/components/LiveCameraTile.tsx
    - client/src/components/LiveGrid.tsx
    - client/src/pages/LiveViewPage.tsx
    - client/src/index.ts

key-decisions:
  - "Used pointerdown/pointerup alongside pointerleave to guarantee stop dispatch even if pointer leaves button bounds"
  - "Styled in Palette 1 (Kinetic High-Contrast): Ion Blue (#4fc3f7) accents, Solar Amber (#fb923c) STOP button, Obsidian (#090d16) backdrop blur"
  - "Permitted Admin to save new presets; restricted Operators to quick preset jumping and tours"

requirements-completed:
  - EXT-03

duration: 15m
completed: 2026-09-24
---

# Plan 09-02 Summary: React Virtual D-Pad Overlay & Keyboard Controls

**Interactive PTZ HUD overlay delivered with 8-directional virtual D-Pad, optical zoom controls, preset quick-selection, preset tour runner, and live stream keyboard shortcuts.**

## Accomplishments

1. **Virtual D-Pad & HUD Overlay (`PtzControlsOverlay.tsx`)**:
   - Engineered floating HUD styled in Palette 1 (Obsidian `#090d16` backdrop blur, Slate `#111827` surface, Ion Blue `#4fc3f7` accents).
   - 8 directional arrow buttons (N, NE, E, SE, S, SW, W, NW) supporting continuous hold-to-move.
   - High-contrast Solar Amber (`#fb923c`) center STOP button with tactile active state.
   - Optical Zoom stepper with Zoom In (`+`) and Zoom Out (`-`) buttons.

2. **Preset Management & Preset Tour**:
   - Fetches camera presets dynamically from `/api/cameras/:id/ptz/presets`.
   - 1-click preset jump pills.
   - Preset tour mode cycling through all available presets with a 5-second interval.
   - "Save Preset" dialog modal enabled for administrators.

3. **Keyboard Controls**:
   - Integrated keyboard listener: Arrow keys for Pan/Tilt, `+`/`-` for Zoom In/Out, `Space`/`Escape` for Stop.
   - Key release automatically halts camera movement.

4. **Live Grid & Tile Integration**:
   - Updated `LiveCameraTile` with `<Compass>` toggle icon in the header.
   - Mounted `PtzControlsOverlay` directly over the active video feed.
   - Filtered PTZ button visibility: only rendered when user has `canControlPtz` permission (or `isAdmin`).
   - Clean compilation: 0 errors in both root and client TypeScript builds.
