# Phase 16: Operational Settings & Core Health Licensing Realignment - Research

## Context & Objectives
To fulfill Workstream 1.5 and 1.6 of `.planning/MVP-ROADMAP.md`:
1. **Commercial Licensing Realignment**:
   - Camera health telemetry (`camera.health`) was previously gated behind Package 2 (`extended.camera_health`).
   - For CP Plus / Hikvision parity in the Indian SMB market, a surveillance system must show whether cameras are online and healthy out-of-the-box.
   - Core Package 1 must include camera health telemetry in its baseline capability registry.
   - Core camera count limit is established at 16 cameras (sufficient for standard 4/8/16-channel DVR/NVR replacement installations).
   - Evaluation registry (`createEvaluationRegistry`) must supply camera health capabilities and 16-camera headroom.

2. **Operational Settings Surface**:
   - **Recording Mode**:
     - `CONTINUOUS`: Records 24/7 non-stop fMP4 segments.
     - `MOTION_ONLY`: Records short ring-buffer segments promoted on ONVIF motion alerts.
     - `SCHEDULED`: Operates strictly according to the 7-day weekly schedule grid.
     - `MANUAL_OFF`: Disables automatic recording.
   - **Visual 7-Day Schedule Grid**:
     - 7 days (Sunday=0 to Saturday=6) $\times$ 24 hours (0 to 23).
     - 1-hour resolution blocks.
     - Presets: "24/7 Continuous", "Business Hours (Mon-Fri 09:00-18:00)", "Nights & Weekends (18:00-08:00 + Weekends)", "Clear All".
     - Can be applied globally or per-camera.
   - **Storage Retention & Auto-Purge Management**:
     - Retention period: 7, 15, 30, 60 days, custom days, or unlimited (0 = full disk FIFO only).
     - Storage quotas: Warning threshold (default 80%) and Critical threshold (default 90% or 85%).
     - Bookmarked recording protection: Recordings tagged with bookmarks or during bookmarked incident windows are shielded from FIFO and retention purges.
     - On-demand cleanup trigger.

## Architectural Seams & Compatibility
- `src/licensing/types.ts`:
  - Add `'core.camera_health'` to `CORE_CAPABILITIES`.
  - Include `'extended.camera_health'` in `CORE_CAPABILITIES` for backward compatibility.
  - Set Core default camera limit to 16.
- `src/licensing/capabilities.ts`:
  - `CapabilityRegistry.has(capability)` maps `camera.health`, `core.camera_health`, and `extended.camera_health` seamlessly.
- `src/settings/`:
  - `settings.types.ts`: Zod schemas and TypeScript interfaces for operational settings.
  - `settings.service.ts`: Singleton service managing operational settings, storage metrics, retention calculation, and schedule translation.
  - `settings.routes.ts`: Fastify route plugin registered under `/api/settings`.
- `client/src/components/OperationalSettingsModal.tsx` & `client/src/App.tsx`:
  - Interactive operator UI with schedule grid, mode switcher, storage meter, and license capabilities view.
