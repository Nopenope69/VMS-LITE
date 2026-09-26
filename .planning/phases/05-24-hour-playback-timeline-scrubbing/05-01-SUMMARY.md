# Phase 5 Plan 01 Summary: Playback Service and 24-Hour Timeline API

## Overview
Implemented the backend playback service and REST API routes for 24-hour recording timeline interval queries and MediaMTX fMP4 stream resolution, satisfying requirements `PLAY-01` and `PLAY-03`.

## Deliverables
1. **Playback Types and Schemas (`src/playback/playback.types.ts`)**:
   - `TimelineQuerySchema`: Zod schema validating camera ID, ISO date / startTime / endTime, strictly rejecting query intervals exceeding 24 hours (`T-05-03`).
   - DTOs: `TimelineSpanDto`, `TimelineResponseDto`, `PlaybackStreamUrlDto`.
2. **Playback Service (`src/playback/playback.service.ts`)**:
   - `getTimelineSpans(query)`: Queries recording chunks for a camera within a 24-hour window, merges overlapping or contiguous spans, and provides seamless fallback to in-memory recording storage for standalone/test environments.
   - `getPlaybackStreamUrl(cameraId, startTime, duration)`: Resolves camera media path and formats MediaMTX fMP4 playback URL (`http://<host>:9996/get?path=<mediaMtxPath>&start=<isoTimestamp>&duration=<duration>`).
3. **Fastify Playback Routes (`src/playback/playback.routes.ts`)**:
   - `GET /api/playback/timeline`: Protected by JWT authentication hook; returns recorded spans for the requested 24-hour window.
   - `GET /api/playback/stream`: Protected by JWT authentication hook; returns the resolved fMP4 stream URL for the requested timestamp.
4. **Server Integration (`src/server.ts`)**:
   - Registered `playbackRoutes` under `/api/playback`.
5. **Recording Service Fix (`src/recordings/recording.service.ts`)**:
   - Added `cameraService.listCameras()` lookup fallback in `ingestSegment` when database is offline so camera ID matches onboarded camera media path.
6. **Integration Test Suite (`tests/playback.test.ts`)**:
   - 7 integration tests covering authentication, parameter validation, 24-hour range rejection, recorded span retrieval, and MediaMTX fMP4 URL generation.

## Verification
- `npx vitest run tests/playback.test.ts`: 7/7 tests passed.
- `npm test`: 94/94 tests passed across all 14 test suites.
- `npm run build`: TypeScript compiled cleanly with 0 errors.
