# Phase 14: Vite App Shell & Production Serving - Validation Contract

## Quality Gates & Acceptance Criteria

### Gate 1: Client Toolchain & Bundling
- [ ] `client/index.html` is present and targets `/src/main.tsx`.
- [ ] `client/vite.config.ts` configures React plugin, build output to `client/dist`, and dev proxy for `/api` and `/ws`.
- [ ] `npm run build:client` executes cleanly and outputs valid HTML/JS/CSS assets to `client/dist`.
- [ ] `npx tsc --project client/tsconfig.json` executes with 0 errors.

### Gate 2: Operator App Shell & View Routing
- [ ] `client/src/App.tsx` provides seamless state/URL routing for:
  - `login` (when unauthenticated): Form with username/password, error feedback, and submit button.
  - `dashboard`: Quick system health, storage indicator, camera telemetry cards, recent event stream.
  - `live`: `LiveViewPage` with grid layouts (1x1, 2x2, 3x3) and PTZ overlay.
  - `playback`: `PlaybackPage` with 24h scrubber, calendar, bookmarks, and export modal.
  - `cameras`: List of onboarded cameras with online/degraded/offline status badges, latency, and actions.
  - `events`: System and motion events feed with severity filtering and bookmarks view.
  - `settings`: Overview of recording policies, storage limits, license capabilities, plus modals for user management and notifications.
- [ ] Header includes Basic VMS branding, current time/clock, active user role badge, and logout action.
- [ ] Collapsible sidebar allows quick switching between all views.

### Gate 3: Canonical Production Serving
- [ ] Root `Caddyfile` provides reverse-proxy rules for appliance deployments:
  - Serves static assets from `client/dist`.
  - Proxies `/api/*` and `/ws` to Fastify on port 3000.
  - Proxies `/whep/*` and `/hls/*` to MediaMTX on port 8889.
- [ ] `src/server.ts` integrates `@fastify/static` to serve `client/dist` when present, providing SPA routing fallback for web paths while preserving API routes.
- [ ] Automated integration test in `tests/production-serving.test.ts` validates:
  - `GET /` serves HTML index.
  - `GET /live` or arbitrary non-API routes return `index.html` (SPA fallback).
  - `GET /health` and `/api/*` continue to return JSON API responses.

### Gate 4: Test Suite Non-Regression & License Compliance
- [ ] All 24 existing test suites pass cleanly (`npm test`).
- [ ] License audit (`npm run audit:licenses`) passes with 100% permissive licensing.
