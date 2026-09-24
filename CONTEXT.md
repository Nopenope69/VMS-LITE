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

## 2. Camera & Ingest Domain

### Camera
A physical or virtual video capture device communicating via ONVIF Profile T/S or standard RTSP.

### Media Plane
The streaming and media ingestion infrastructure (MediaMTX) handling RTSP pull, WebRTC/WHEP publishing, HLS packaging, and fMP4 segment recording.

---

## 3. Events & Security Domain

### Event Bus
The decoupled pub/sub event distribution seam within the control plane, broadcasting core events (`recording.started`, `recording.stopped`, `storage.warning`, `storage.critical`, `storage.rollover`) to in-process subscribers and WebSocket clients.
