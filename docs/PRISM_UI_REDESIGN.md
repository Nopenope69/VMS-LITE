# PRISM · Physical Security OS — UI Redesign Summary

The Basic VMS user interface has been comprehensively transformed to match the **PRISM · Physical Security OS** design system inspired by Verkada, Linear, and Vercel dark aesthetics.

---

## 1. Design System & Foundation

### Typography & Icons
- **Primary Typeface:** `Inter` (`-apple-system`, `BlinkMacSystemFont`, `sans-serif`) for crisp, legible telemetry and operational labels.
- **Data & Ticker Monospace:** `JetBrains Mono` with `tabular-nums` for rock-steady timecodes, FPS, bitrates, and IP addresses.
- **Iconography:** Cohesive pairing of Lucide React with Google Material Symbols Outlined.

### Color Palette (Void Dark Mode)
- **Background Void:** `#090a0f` (`brand.DEFAULT`)
- **Surface / Panels:** `#111318` (`brand.surface`)
- **Cards / Containers:** `#151821` (`brand.card`)
- **Subtle Borders:** `rgba(255, 255, 255, 0.08)` / `border-white/10`
- **Functional Accents:**
  - **Operational / Live / Normal:** Emerald (`#10b981` / `emerald-400`)
  - **Motion / Alert / Warning:** Amber (`#f59e0b` / `amber-400`)
  - **Active Recording:** Rose (`#f43f5e` / `rose-400`)
  - **Bookmarks / Secondary Focus:** Cyan (`#06b6d4` / `cyan-400`)

### Glassmorphism Utility Tokens
- `.glass-bar`: Top/bottom control bars (`rgba(12, 14, 20, 0.85)` + 20px blur).
- `.hud-chip`: Semi-transparent floating chips (`rgba(10, 12, 18, 0.76)` + 12px blur + 1px white/9% border).
- `.alert-glass`: High-elevation modals and drawers (`rgba(14, 17, 24, 0.90)` + 24px blur).
- `.dock-glass`: Floating bottom Enterprise Dock with soft depth shadows.

---

## 2. Silicon Valley Header (`App.tsx`)
Replaced the traditional left sidebar and bulky headers with an ultra-sleek, space-maximizing top navigation bar:
1. **Identity & Health:** PRISM polygon badge, version badge `v2.4`, and live telemetry status pill (`Operational`, `4 feeds live`, `0 dropped`).
2. **Navigation Tabs:** Segmented live tabs with real-time badges:
   - **Live** (pulsing emerald dot)
   - **Recordings**
   - **Incidents** (amber count badge)
   - **Devices**
   - **Dashboard**
   - **Settings**
3. **Linear-style Quick Search (`⌘K`):** Global command palette searching across cameras, zones, and fast navigation jumps.
4. **Live Grid Controls:** Segmented switcher for Quad 2×2, Focus 1×1, and Fullscreen.
5. **Operator Profile:** Avatar pill and notification trigger bell with indicator dot.

---

## 3. Live Surveillance Canvas & Enterprise Dock (`LiveCameraTile.tsx` & `LiveViewPage.tsx`)
- **Channel HUD Chips:** Floating top-left channel pill (`01 · North Gatehouse`, `CAM-01`) and top-right recording status with centisecond timecode ticker (`REC | 11:42:19.48`).
- **Telemetry Indicators:** Bottom-left floating chips showing resolution, FPS (`1080p · 30fps`), and network throughput (`2.4 Mb/s`).
- **Verkada-style Incident Cards:** Contextual motion alert overlays featuring thumbnail preview, motion trigger timestamp, and immediate action buttons (`Review Clip`, `Dismiss`).
- **Hover Action Strip:** Quick actions on hover (Snapshot, Mute audio, PTZ joystick, Motion zones, Maximize, Close).
- **Refined Enterprise Dock:** Floating glass bottom bar with fast camera feed selectors, audio chime mute toggle, and a tactile **"Capture Frame" CTA** (Spacebar shortcut) that triggers a tactile visual screen flash animation.

---

## 4. Multi-Camera Playback Matrix & Scrubber (`PlaybackPage.tsx`, `MultiLaneTimeline.tsx`, `PlaybackControls.tsx`)
- **Harmonized Playback Toolbar:** Dropdown camera matrix picker (up to 4 channels), quick date selectors (`Today`, `Yesterday`, `2 Days Ago`, custom date picker), and quick jump shortcuts (`-5m`, `-15m`, `-1h`, `Yesterday Same Time`).
- **Gap Cards:** Redesigned clean void gap cards when footage is absent at the playhead.
- **Multi-Lane Scrubber:** 24h ruler with 1-hour gridlines, Emerald continuous spans, Amber motion events, Cyan bookmarks, and an interactive synchronized playhead ticker.
- **Playback Control Bar:** Transport controls with an emerald play/pause circular button, jog-shuttle variable speeds (`0.5x` to `8x`), and direct clip export.

---

## 5. Drawers, Modals & Management Views
- **Incident & Alert Feed Drawer (`EventNotificationDrawer.tsx`):** Real-time right-anchored glass drawer with motion/system filter segmented controls and severity pills.
- **Clip Export Modal (`ClipExportModal.tsx`):** Range presets, stream-copy vs transcoded OSD derivative selection, progress spinner, and self-verifying evidence ZIP package download with SHA-256 integrity checksum badge.
- **Bookmark Modal (`BookmarkModal.tsx`):** Glassmorphic incident tagging modal with category chips (Incident, Visitor, Activity, Maintenance).
- **Keyboard Shortcuts Cheat Sheet (`KeyboardShortcutsModal.tsx`):** Two-column operator hotkey reference (`?` hotkey).
- **RBAC & Camera Permissions (`UserManagementModal.tsx`):** Dark glass table and camera permission matrix.
- **Dashboard & Drive Telemetry (`DashboardView.tsx`, `DriveTelemetryCard.tsx`):** Real-time drive gauge bars, storage health indicators, and fast appliance maintenance triggers.
