# Phase 6: ONVIF Motion Alerts & Real-Time Event Feed - Validation Plan

**Planned:** 2026-09-24  
**Scope:** Automated testing and verification strategy for ONVIF event subscription, event bus dispatch, and WebSocket streaming.

## Validation Criteria

1. **ONVIF Event Subscriptions (`EVT-03`)**:
   - `OnvifEventListenerService` connects to camera event endpoint.
   - Generates valid `CreatePullPointSubscription` and `PullMessages` SOAP envelopes.
   - Parses XML notification messages for motion detection topics (`CellMotionDetector`, `MotionAlarm`, `TamperDetector`).
   - Mock ONVIF event provider allows full unit and integration test coverage without physical cameras.

2. **Core Event Bus Integration (`EVT-04`)**:
   - Motion detected state triggers `eventBus.emitEvent()` with type `motion.detected`.
   - Event is persisted to database / in-memory store and emitted to bus listeners.

3. **WebSocket Real-Time Broadcast (`EVT-05`)**:
   - WebSocket server rejects unauthenticated connections (invalid or missing JWT token).
   - Authenticated client receives real-time JSON events when `eventBus` emits an event.
   - Heartbeat ping/pong keeps connections alive.

4. **React Client Components**:
   - `events-ws-client.ts` connects to WebSocket, parses messages, and handles reconnect.
   - `MotionAlertBadge` and `EventNotificationDrawer` render alerts with camera names and timestamps.
   - TypeScript compilation passes with zero errors.

## Test Suites
- `tests/onvif-events.test.ts`: Verifies SOAP generation, XML parsing, subscription lifecycle, and `motion.detected` emission.
- `tests/websocket-feed.test.ts`: Verifies WebSocket authentication, client handshake, real-time message streaming, and heartbeat.
