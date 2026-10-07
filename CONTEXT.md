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
- `MOTION_ONLY`: Always recording into a Motion Buffer; only segments around motion are kept.

### Segment Ingest
The module that decides the fate of every Video Segment found on disk: catalogued as available, held in the Motion Buffer, or quarantined. It is the only way a segment enters the catalog.

### Quarantined Segment
A Video Segment that failed validation (truncated, empty, unreadable). It stays catalogued so FIFO Rollover can reclaim it and health can report it; it is never played back.
_Avoid_: corrupt recording, failed segment

### Motion Buffer
The rolling window of recent segments held for a `MOTION_ONLY` camera. Segments are kept when motion is detected nearby and expire otherwise.
_Avoid_: ring buffer, pre-buffer queue

### Schedule Window
A time interval bounded by start hour/minute and end hour/minute on a specified day of the week (0 = Sunday through 6 = Saturday). Supports overnight windows spanning midnight into the next day and wrapping across week boundaries.

### Storage Controller
The internal engine component responsible for monitoring disk capacity via filesystem metrics (`statfs`), detecting threshold violations, and executing FIFO rollover.

### Retention Policy
The one place that decides whether a Video Segment may be deleted: by its Retention Tier's lifetime, and never while it is on a Hold.

### Retention Tier
How long footage lives: `CONTINUOUS` (ordinary footage), `EVENT` (footage near motion), `INCIDENT` (footage linked to an incident). A longer-lived tier never expires sooner than a shorter one.

### Hold
A reason footage must stay whatever its age or the disk pressure: a Legal Hold, a bookmark (the segments within 2 minutes of it), or a queued or running export.

### Legal Hold
A permanent hold a person places on footage (`isProtected`). The system never places or lifts one by itself.
_Avoid_: lock, protected tier

### FIFO Rollover
The pruning of the oldest Video Segments not on a Hold when disk usage exceeds the critical threshold (`criticalThresholdPercent`), until usage drops to the target threshold (`targetThresholdPercent`). Quarantined Segments go first.

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

### Site
A physical location (branch, warehouse, home) whose cameras this central server pulls over LAN, VPN or port-forwarded RTSP. Cameras belong to at most one site; sites drive filtering and per-site health. They do not change recording or playback.

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
