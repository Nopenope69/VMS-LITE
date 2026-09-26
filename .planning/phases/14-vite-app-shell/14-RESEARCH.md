# Phase 14: Vite App Shell & Production Serving - Research

## Context & Problem Statement
Currently, `client/src` contains high-quality individual React page and modal components (`LiveViewPage`, `PlaybackPage`, `LiveGrid`, `TimelineScrubber`, `ClipExportModal`, `BookmarkModal`, `NotificationSettingsModal`, `MotionZoneEditorModal`, `PtzControlsOverlay`, `UserManagementModal`, `OperatorBanner`, `EventNotificationDrawer`). However, there is no root application shell or bundler configuration to run the frontend as a standalone web application.

To achieve deployable MVP status (per Workstream 1.3 in `.planning/MVP-ROADMAP.md`), the application requires:
1. Vite bundler toolchain (`client/index.html`, `client/vite.config.ts`, `client/src/main.tsx`).
2. Unified `App.tsx` operator shell featuring:
   - Login screen for unauthenticated visitors.
   - Persistent top header (branding, system clock, user badge with role, logout).
   - Collapsible navigation sidebar.
   - 6 primary operator views:
     - **Dashboard**: System health status, storage gauge, camera health telemetry tally, recent event feed.
     - **Live View**: Integrated `LiveViewPage` with multi-grid and PTZ controls.
     - **Playback**: Integrated `PlaybackPage` with 24h scrubber, clip exporter, bookmarks.
     - **Cameras**: Onboarded camera roster with stream status, latency/bitrate, and management actions.
     - **Events & Alerts**: Filterable audit and motion event log.
     - **Settings**: Recording policies, storage quotas, notification settings, user management, and license capabilities.
3. Canonical production serving architecture:
   - Edge reverse-proxy configuration via `Caddyfile` for appliance deployments.
   - Built-in `@fastify/static` fallback in `src/server.ts` to serve `client/dist` directly in single-container mode.

## Architectural Findings

### 1. Client Toolchain & Bundler
- Root `package.json` has React 19, Lucide React, and `@vitejs/plugin-react` installed.
- Vite 5 is installed in `node_modules` and runs builds cleanly.
- `client/tsconfig.json` targets `ES2022` with `moduleResolution: "bundler"`, `jsx: "react-jsx"`, and `strict: true`.
- Adding `client/vite.config.ts` allows building to `client/dist` with proxying of `/api` and `/ws` to `localhost:3000` during local development (`npm run dev:client`).

### 2. Operator Navigation & View Routing
- Instead of introducing heavyweight external routing dependencies that complicate offline packaging, a lightweight, type-safe hash/state router or path router seamlessly manages views:
  `'dashboard' | 'live' | 'playback' | 'cameras' | 'events' | 'settings'`.
- `AuthContext` provides `user`, `role`, `token`, `login()`, and `logout()`. Unauthenticated state cleanly gates access and renders the login interface.

### 3. Production Serving & Ingress
- **Appliance Mode**: Caddy acts as the unified reverse proxy:
  - Serves static files from `client/dist` with gzip/zstd.
  - Proxies `/api/*` and `/ws` (with WebSocket upgrade) to Fastify on `127.0.0.1:3000`.
  - Proxies `/whep/*` and `/hls/*` to MediaMTX on `127.0.0.1:8889`.
- **Fastify Static Fallback**:
  - `@fastify/static` is registered conditionally if `client/dist` exists on disk.
  - A fallback route or `setNotFoundHandler` serves `index.html` for client-side navigation requests while preserving 404s for API requests.

### 4. Dependency & Licensing Constraints
- `@fastify/static`: MIT.
- `vite` & `@vitejs/plugin-react`: MIT.
- 100% permissive licensing confirmed via `npm run audit:licenses`.
