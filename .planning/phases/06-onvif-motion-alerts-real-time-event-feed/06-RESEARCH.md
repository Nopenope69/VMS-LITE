# Phase 6: ONVIF Motion Alerts & Real-Time Event Feed - Research

**Researched:** 2026-09-24  
**Domain:** ONVIF Profile T PullPoint subscriptions, WS-BaseNotification, Core event bus dispatch, WebSocket streaming, and React live alert notification drawer  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from ROADMAP.md & PROJECT.md)

### Locked Decisions
- **Native ONVIF Profile T Events**: Camera motion alerting is powered by native camera ONVIF Profile T PullPoint subscriptions (`EVT-03`), avoiding heavyweight computer vision models or CPU-intensive pixel analysis in Package 1 Core.
- **Core Event Bus Dispatch**: Motion triggers emit `motion.detected` events to the Core event bus (`EVT-04`), persisting records to the PostgreSQL `events` table and notifying in-process subscribers.
- **Real-Time Client Notification via WebSockets**: Web clients receive real-time notifications via a WebSocket stream (`EVT-05`), including timestamp, camera name, and visual alerts.
- **Zero VigilOne Domain Entanglement**: Fresh, clean-room implementation with zero compliance-grade multi-tenancy or audit chain dependencies.
- **Permissive Licensing**: 100% MIT or Apache-2.0 dependencies (`ws`, `@types/ws`).

### Discretionary Decisions
- **SOAP / PullPoint Client**: Build a robust, lightweight SOAP client for `CreatePullPointSubscription` and `PullMessages` with WS-Security digest/token authentication. Support mock mode for deterministic CI/CD testing.
- **WebSocket Protocol & Route**: Mount WebSocket server at `/api/events/feed` requiring JWT authentication via query string `?token=...` or Authorization header.
- **Event Notification UI**: Provide a persistent header notification badge with unread count and a slide-out `EventNotificationDrawer` displaying the real-time event stream.

### Deferred Ideas (OUT OF SCOPE)
- Custom computer vision / OpenCV object detection (Package 3 AI: AI-01)
- Exclusion motion zones and polygon masks (Package 2 Extended: EXT-02)
- External WhatsApp / SMS alert dispatch (Package 2 Extended: EXT-07)
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ONVIF PullPoint Subscription | Node.js Backend (`OnvifEventService`) | Camera Provider | Maintains long-lived HTTP PullPoint sessions with ONVIF Profile T cameras |
| Motion Event Dispatch | Core Event Bus (`EventBus`) | PostgreSQL (`Event` table) | In-process pub/sub broadcast and durable database logging |
| Real-Time Client Push | WebSocket Server (`ws`) | Fastify HTTP Server | Low-overhead bidirectional WebSocket streaming for browser clients |
| Alert UI & Notification Drawer | React Frontend | Lucide Icons / Audio | Real-time badge counter, alert sounds/toasts, and event log drawer |
</architectural_responsibility_map>

<research_summary>
## Research Summary

### 1. ONVIF Profile T Event Subscription (EVT-03)
Under the ONVIF Core Specification and Profile T:
- Camera exposes an Events service endpoint (typically `http://<camera-ip>:<port>/onvif/event_service`).
- To receive events, the client invokes `CreatePullPointSubscription` with initial termination time (e.g. `PT60S` or `PT10M`).
- The response returns a `SubscriptionReference` Address URL (e.g., `http://<camera-ip>:<port>/onvif/Subscription?Idx=0`).
- The client periodically calls `PullMessages` on that Subscription URL with a `Timeout` (e.g., `PT5S` or `PT10S`) and `MessageLimit`.
- The camera returns messages matching topics such as:
  - `tns1:RuleEngine/CellMotionDetector/Motion`
  - `tns1:VideoSource/MotionAlarm`
  - `tns1:RuleEngine/TamperDetector/Tamper`
- If the subscription expires or the camera reboots, the client automatically re-subscribes.

### 2. Event Bus Integration (EVT-04)
When a `wsnt:NotificationMessage` contains motion state `true`:
- Fastify backend formats an `EmitEventInput`:
  ```ts
  {
    cameraId: camera.id,
    type: CoreEventType.MOTION_DETECTED, // 'motion.detected'
    source: 'onvif.motion',
    severity: 'warning',
    metadata: {
      topic: 'tns1:RuleEngine/CellMotionDetector/Motion',
      state: true,
      cameraName: camera.name
    }
  }
  ```
- Calls `eventBus.emitEvent(...)` which emits `'*'` and `'motion.detected'` and saves to PostgreSQL.

### 3. WebSocket Real-Time Push (EVT-05)
- Standard WebSocket connection at `/api/events/feed`.
- Client passes `?token=<jwt>`.
- Server validates JWT before upgrading or during initial message.
- Upon connection, server sends recent events (`eventBus.queryEvents({ limit: 20 })`).
- Subscribes to `eventBus.subscribe('*')` and pushes new events to all connected clients.
- Implements ping/pong heartbeat (30s) to keep connections alive and prune stale clients.

### 4. React Notification UI
- `MotionAlertBadge`: Displayed in application header with pulse animation on active motion.
- `EventNotificationDrawer`: Displays recent alerts, categorized by severity (warning, info, critical). Clicking an alert can focus the camera or seek playback.
</research_summary>
