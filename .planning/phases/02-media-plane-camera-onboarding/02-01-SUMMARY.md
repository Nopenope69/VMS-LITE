# Phase 2 Plan 01: Media Plane Client, CameraProvider Adapter & Schema Extension Summary

**Executed:** 2026-09-24  
**Plan:** `02-01-PLAN.md`  
**Status:** COMPLETE  

## Accomplishments

1. **Clean-Room Database Schema Extension**:
   - Extended `prisma/schema.prisma` with `Camera` model (`id`, `name`, `ip`, `port`, `username`, `password`, `rtspUrl`, `subStreamUrl`, `onvifUrl`, `profileToken`, `manufacturer`, `model`, `serialNumber`, `status`, `mediaMtxPath`, `createdAt`, `updatedAt`).
   - Ran `npx prisma generate` to recompile client types.
   - Pinned `node-onvif` package (MIT license) for ONVIF WS-Discovery and SOAP services.

2. **MediaMTX v3 Control Client**:
   - Implemented `MediaMtxClient` in `src/mediamtx/mediamtx.client.ts` interacting with MediaMTX v3 REST endpoints (`/v3/config/paths/*`).
   - Built robust RTSP URI credentials sanitizer and URL encoder (`sanitizeRtspUrl`), properly escaping passwords containing `@`, `:`, `#` (mitigating T-02-01).
   - Supported dynamic path creation (`addPath`), updates (`replacePath`), removal (`removePath`), and queries (`getPath`, `listPaths`) with built-in mock fallback for test resilience.

3. **Vendor-Neutral CameraProvider Abstraction**:
   - Created `ICameraProvider` interface in `src/cameras/camera-provider.interface.ts` hiding all ONVIF vendor/SOAP internals behind standard TypeScript interfaces (CAM-04).
   - Created `OnvifCameraProvider` in `src/cameras/onvif.provider.ts` implementing WS-Discovery UDP multicast probes and Profile T/S profile resolution.
   - Built profile sorting prioritizing high-resolution profiles for Main Stream (`isMainStream: true`) with low-resolution profiles allocated as Sub Streams (CAM-02).
   - Added TypeScript module declaration `src/types/node-onvif.d.ts`.

## Verification Evidence

- `tests/mediamtx-client.test.ts`: 7/7 unit tests passing.
- `tests/camera-provider.test.ts`: 8/8 unit tests passing.
- Full Vitest suite: 35/35 passing.
- TypeScript build (`npm run build`): 0 errors.

---
*Created by GSD Executor*
