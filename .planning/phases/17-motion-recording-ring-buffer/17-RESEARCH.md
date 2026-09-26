# Phase 17: Motion Recording with Rolling Ring Buffer - Research

## Context & Objectives
To fulfill Workstream 2.1 of `.planning/MVP-ROADMAP.md`:
1. **The Problem**:
   - In traditional VMS systems, continuous recording consumes massive storage, while motion-only recording misses the crucial moments leading up to an incident (e.g., an intruder walking up to a door before triggering the sensor).
   - In standard budget NVR hardware (Intel N100 / Celeron / ARM), running continuous FFmpeg transcoding sidecars for 16 cameras destroys CPU performance.
2. **The Zero-Transcode Ring Buffer Solution**:
   - MediaMTX ingests the RTSP feed and cuts short fMP4 chunks (e.g., 2-second segments).
   - An in-memory and disk-backed rolling ring buffer maintains these short segments in an unpromoted state for each camera.
   - If no motion occurs within 30 seconds, segments are unlinked from disk and evicted from memory. Zero database rows are created during idle non-motion periods.
   - When an ONVIF `motion.detected` event arrives on the `EventBus`:
     - The promotion engine retrieves the preceding 10 seconds of buffered segments (`preBufferSeconds`).
     - These pre-buffer segments are promoted to permanent storage and inserted into the `RecordingCatalog` / PostgreSQL `recordings` table.
     - All segments captured while motion continues are cataloged.
     - When motion ceases, recording continues for a cooldown window (`postBufferSeconds`, default 30 seconds).
     - Once the cooldown timer expires, the incident closes and new segments return to rolling buffer queue.
3. **Key Integration Points**:
   - `src/recordings/motion-ring-buffer.ts`: The ring buffer manager and promotion coordinator.
   - `src/recordings/recording-engine.ts`: Ingest routing based on camera mode (`CONTINUOUS` vs `MOTION_ONLY` vs `SCHEDULED`).
   - `src/events/event-bus.ts`: Subscribing to `motion.detected`.
   - `src/settings/`: Adding `preBufferSeconds` and `postBufferSeconds` to operational settings.
