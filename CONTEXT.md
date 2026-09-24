# Domain Model (CONTEXT.md)

This document establishes the canonical domain glossary and bounded context vocabulary for Basic VMS. All code, interfaces, tests, and documentation must adhere to these terms.

---

## 1. Video & Recording Domain

### Recording Engine
The authoritative deep module orchestrating segment ingestion, schedule evaluation, and storage retention. It presents a unified external seam to route handlers and server lifecycle hooks, encapsulating all background timers and internal workers.

### Video Segment (Segment)
A discrete fMP4 media file produced on disk by MediaMTX according to configured duration targets (e.g. 60s). Contains packet-preserving video streams without transcoding.

### Recording Mode
The high-level policy determining when a camera records video:
- `CONTINUOUS`: 24/7 uninterrupted recording.
- `SCHEDULED`: Recording activated only within defined schedule windows.
- `MANUAL_OFF`: Recording explicitly suppressed regardless of schedules.

### Schedule Window
A time interval bounded by start hour/minute and end hour/minute on a specified day of the week (0 = Sunday through 6 = Saturday). Supports overnight windows spanning midnight into the next day and wrapping across week boundaries.

### Storage Controller
The internal engine component responsible for monitoring disk capacity via filesystem metrics (`statfs`), detecting threshold violations, and executing FIFO rollover.

### FIFO Rollover
The deterministic pruning of the oldest recorded video segments when disk usage exceeds the critical threshold (`criticalThresholdPercent`), unlinking files and purging database catalog entries until usage drops to the target threshold (`targetThresholdPercent`).

---

## 2. Playback & Timeline Domain

### Timeline Span
A continuous playback interval computed by stitching contiguous video segments (gap tolerance <= 5s) for smooth visual scrubbing and continuous playback across segment boundaries.

### Playback Session
The headless client state machine (`usePlaybackSession`) encapsulating playhead synchronization, timeline range queries, playback rates (0.5x to 4x), stream selection, and error recovery without coupling to DOM presentation.

### Playhead
The active playback cursor represented in Unix epoch seconds across the 24-hour timeline scrubber.

### fMP4 Segment Stream
Direct media streaming served by MediaMTX's `/get` HTTP endpoint with millisecond-precision `start` and `duration` query parameters, enabling zero-transcode browser-native fMP4 playback.

---

## 3. Camera & Ingest Domain

### Camera
A physical or virtual video capture device communicating via ONVIF Profile T/S or standard RTSP.

### Camera Provider
A pluggable hardware adapter (`ICameraProvider`) isolating ONVIF/RTSP vendor implementations (Profile T/S) behind a clean domain interface, supporting automated discovery via WS-Discovery.

### Media Plane
The streaming and media ingestion infrastructure (MediaMTX) handling RTSP pull, WebRTC/WHEP publishing, HLS packaging, and packet-preserving fMP4 segment recording.

---

## 4. WebRTC & NAT Traversal Domain

### WHEP (WebRTC HTTP Egress Protocol)
A standard HTTP-based handshake protocol used by browsers to negotiate WebRTC peer connections with MediaMTX for ultra-low-latency (<500ms) live video viewing.

### Ephemeral ICE Credentials
RFC 5766 time-limited HMAC-SHA1 tokens dynamically issued to clients to authorize STUN/TURN media relay across restrictive NAT boundaries.

### Coturn
A permissively licensed (BSD-3-Clause) STUN/TURN server providing NAT traversal fallback for remote mobile clients outside the local network.

---

## 5. Events & Security Domain

### Event Bus
The decoupled pub/sub event distribution seam within the control plane, broadcasting core events (`recording.started`, `recording.stopped`, `storage.warning`, `storage.critical`, `storage.rollover`, `camera.*`) to in-process subscribers and WebSocket clients.

### Event Subscription Bridge
The automated lifecycle bridge listening to `camera.online`, `camera.offline`, and `camera.deleted` events on the Event Bus to manage persistent ONVIF pull-point subscriptions without tight coupling between camera and event services.

### Real-Time WebSocket Feed
A lightweight WebSocket endpoint (`/api/v1/events/feed`) broadcasting real-time motion and system alerts to connected desktop and mobile web clients.

---

## 6. Licensing & Entitlement Domain

### Capability Registry
A boot-time resolved set of system capabilities (`capabilities.has(...)`) decoupling Package 1 (Core), Package 2 (Extended), and Package 3 (AI) without scattering tier checks in business logic.

### Offline License Token
A cryptographically signed (Ed25519) offline license payload specifying tier, camera limits, and expiry dates, enabling air-gapped on-site deployments without internet access.
