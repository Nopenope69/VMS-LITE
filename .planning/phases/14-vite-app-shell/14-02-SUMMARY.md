# Phase 14-02 Summary: Production Serving Architecture & Static Fallback

## Overview
Successfully configured the production serving architecture for Basic VMS, implementing Fastify static file serving with Single Page Application (SPA) fallback in `src/server.ts`, defining the canonical edge `Caddyfile` for appliance deployments, and establishing automated integration tests verifying serving and routing behavior.

## Changes Implemented

1. **Canonical Appliance Edge Ingress (`Caddyfile`)**:
   - Built root `Caddyfile` designed for zero-config appliance deployment on port 80 / 443:
     - Enabled Gzip and Zstandard compression.
     - Enforced security headers (`X-Content-Type-Options nosniff`, `X-Frame-Options SAMEORIGIN`, `Referrer-Policy strict-origin-when-cross-origin`).
     - Routed `/whep/*`, `/hls/*`, `/list*`, and `/get*` directly to MediaMTX media plane on `127.0.0.1:8889`.
     - Routed `/api/*`, `/ws`, and `/health` to Fastify Node control plane on `127.0.0.1:3000` with WebSocket upgrade preservation.
     - Configured static file serving from `./client/dist` with `try_files {path} /index.html` for client routing.

2. **Fastify Static Serving & SPA Fallback (`src/server.ts`)**:
   - Integrated `@fastify/static` (pinned version compatible with Fastify 4.x).
   - Conditionally registered static file serving if `client/dist/index.html` exists on disk.
   - Implemented custom `setNotFoundHandler`:
     - Retains explicit HTTP 404 JSON errors for unmatched `/api/*` and `/health` endpoints.
     - Serves `client/dist/index.html` on client web routes (`/live`, `/playback`, `/cameras`, etc.) for seamless client-side SPA navigation.

3. **Automated Integration Testing (`tests/production-serving.test.ts`)**:
   - Verified root `GET /` serves HTML index with `<div id="root">` and `Basic VMS`.
   - Verified client routes (`GET /live`, `GET /playback`, `GET /cameras/diagnostics`) trigger SPA fallback to `index.html`.
   - Verified API endpoints (`GET /health`) continue returning JSON and are not intercepted by static handlers.
   - Verified unmapped API routes (`GET /api/non-existent-subsystem`) return JSON 404.
   - Verified bundled static JS assets from `/assets/` are served with correct MIME types.

## Verification Results
- `tests/production-serving.test.ts` passed 7/7 tests.
- Entire test suite: **25/25 test files passed (238/238 tests passing)** in 6.71s.
- License compliance: **100% Permissive Licensing Verified** across 173 packages.
- CycloneDX SBOM generated cleanly at `sbom.json` and `dist/sbom.json`.
