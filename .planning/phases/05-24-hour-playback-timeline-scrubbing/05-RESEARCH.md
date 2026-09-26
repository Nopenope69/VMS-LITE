# Phase 5: 24-Hour Playback & Timeline Scrubbing - Research

**Researched:** 2026-09-24  
**Domain:** MediaMTX playback server (`/list`, `/get`), 24-hour visual timeline scrubber, fMP4 streaming, frame seek, and playback controls  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from ROADMAP.md & PROJECT.md)

### Locked Decisions
- **MediaMTX playback server**: MediaMTX provides native recording playback server on port 9996 exposing `/list` and `/get` endpoints.
- **Visual 24-Hour Activity Timeline**: User must see a 24-hour visual activity bar showing recording intervals for any selected camera (`PLAY-01`).
- **Timeline Scrubbing & Seeking**: Clicking or dragging along the timeline scrubs and seeks to that point in time (`PLAY-02`).
- **Media Streaming via MediaMTX**: System streams recorded video segments via MediaMTX playback endpoints without re-encoding (`PLAY-03`).
- **Playback Controls**: Standard VCR/DVR controls: pause, resume, frame/seconds step, and variable speed (`PLAY-04`).
- **Zero VigilOne Domain Entanglement**: Fresh, clean-room React timeline component and Fastify playback routes.
- **Permissive Licensing**: 100% MIT or Apache-2.0 dependencies.

### Discretionary Decisions
- **Catalog Integration**: Utilize PostgreSQL `recordings` catalog (indexed in Phase 3) for fast indexed interval queries, supplemented by MediaMTX `/list` for live sync.
- **Playback URL Resolution**: Fastify endpoint `GET /api/playback/cameras/:cameraId` returns 24-hour recording spans and direct playback stream URLs.
- **Time Representation**: Standard ISO-8601 timestamps and local time display matching installer expectations.

### Deferred Ideas (OUT OF SCOPE)
- Synchronized multi-camera playback (Package 2 Extended: EXT-05)
- Watermarked evidentiary MP4 export with SHA-256 hash certificate (Package 2 Extended: EXT-06)
- AI event timeline filtering (Package 3 AI: AI-03)
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 24h Recording Catalog Queries | API/Database | MediaMTX /list | PostgreSQL `recordings` table stores indexed start/end times and file metadata |
| Segment fMP4 Streaming | MediaMTX (:9996) | Fastify proxy/redirect | MediaMTX `/get` serves packet-preserving fMP4 bytes with HTTP range support |
| 24h Timeline Visualization | Web Frontend (React) | SVG / Canvas / CSS | Responsive visual bar rendering recorded chunks, tick marks, and current playhead |
| Playback Controls & Seeking | Web Frontend (React) | HTML5 `<video>` | Native video element handles pause, resume, playbackRate, and currentTime |
</architectural_responsibility_map>

<research_summary>
## Research Summary

### 1. MediaMTX Playback Server API (PLAY-03)
MediaMTX includes a dedicated HTTP playback server enabled by default on port `9996`.
- **Query Recorded Segments**:
  `GET http://<mediamtx-host>:9996/list?path=<mediaMtxPath>`
  Returns array of recorded segments with ISO-8601 start timestamp and duration.
- **Stream Recorded Video**:
  `GET http://<mediamtx-host>:9996/get?path=<mediaMtxPath>&start=<isoTimestamp>&duration=<seconds>`
  Returns fMP4 container with H.264/H.265 video packets. HTML5 `<video>` elements can consume this directly or via Media Source Extensions.
- **Database Catalog Synergy**:
  Because Phase 3 implemented the `runOnRecordSegmentComplete` webhook, our PostgreSQL database already contains indexed `Recording` entries (`startTime`, `endTime`, `duration`, `sizeBytes`, `filePath`).
  Fastify can query the 24h window directly from PostgreSQL with sub-millisecond latency:
  `WHERE cameraId = :id AND startTime >= :dayStart AND endTime <= :dayEnd`

### 2. 24-Hour Timeline Scrubber Component (PLAY-01, PLAY-02)
CCTV operators expect an intuitive CP Plus / Hikvision style timeline:
- **Time Ruler**: 24-hour horizontal bar (00:00 to 24:00) with tick marks every hour and minor marks every 15 minutes.
- **Recorded Spans**: Shaded green blocks overlaid across the timeline indicating recorded intervals.
- **Playhead**: Vertical indicator cursor reflecting current video time.
- **Interaction**:
  - Click on any point of the timeline to seek to that timestamp.
  - Drag the playhead to scrub continuously.
  - Zoom controls: 24h full day, 6h window, 1h window.
  - Date selector to jump to previous days.

### 3. VCR/DVR Playback Controls (PLAY-04)
- **Play / Pause**: Toggles `<video>.play()` and `<video>.pause()`.
- **Step Forward / Backward**: Steps 5 seconds or single frame (`video.currentTime += 5`).
- **Speed Multiplier**: Adjusts `video.playbackRate` between 0.5x, 1x, 2x, 4x, 8x.
- **Time Display**: Displays current playback timestamp in `YYYY-MM-DD HH:mm:ss` format.
</research_summary>

<threat_model>
## Threat Model & Mitigations

| Threat ID | Severity | Description | Mitigation Strategy |
|-----------|----------|-------------|---------------------|
| **T-05-01** | High | Unauthorized access to historical video footage | All playback metadata and stream URL endpoints require JWT authentication. |
| **T-05-02** | High | Path traversal via camera or segment query parameters | Validate camera ID against database/memory records; sanitize query parameters; reject `..` and null bytes. |
| **T-05-03** | Medium | Denial of service via excessive historical query ranges | Restrict timeline queries to a maximum 24-hour window per request; cap results at 500 segments. |
</threat_model>
