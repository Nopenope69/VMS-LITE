# Phase 6 Plan 01 Summary: ONVIF Event Listener & Motion Dispatch

## Overview
Implemented the ONVIF Profile T event listener service and PullPoint subscription manager that captures camera motion and tampering alerts and dispatches them to the Core event bus, fulfilling requirements `EVT-03` and `EVT-04`.

## Deliverables
1. **ONVIF Event Types & Constants (`src/events/onvif-events.types.ts`)**:
   - `OnvifEventSubscription`, `ParsedOnvifEvent`, `OnvifPullMessagesOptions`.
   - Topics: `ONVIF_TOPIC_CELL_MOTION`, `ONVIF_TOPIC_VIDEO_SOURCE_MOTION`, `ONVIF_TOPIC_TAMPER`.
2. **ONVIF Event Listener Service (`src/events/onvif-events.service.ts`)**:
   - `subscribeCamera()`: Initiates ONVIF Profile T `CreatePullPointSubscription` SOAP call and tracks active subscriptions.
   - `unsubscribeCamera()`: Halts polling worker and cleans up timers.
   - `buildCreatePullPointEnvelope()` & `buildPullMessagesEnvelope()`: Generates compliant SOAP 1.2 envelopes with WS-Security UsernameToken (PasswordDigest + Nonce).
   - `parseSoapNotification()`: Safe XML regex parser extracting NotificationMessage topic and SimpleItem name/value pairs (`IsMotion`, `State`, etc.), mitigating XXE threats (`T-06-02`).
   - `processEvents()`: Emits `CoreEventType.MOTION_DETECTED` (`motion.detected`) to `eventBus` (`EVT-04`) with `warning` severity and camera metadata.
   - Exponential backoff with jitter on network disconnects (`T-06-01`).
   - Mock mode support for fast, deterministic unit and integration testing.
3. **Unit & Integration Test Suite (`tests/onvif-events.test.ts`)**:
   - 8 unit tests verifying SOAP envelope generation, XML response parsing, subscription lifecycle, and `motion.detected` emission.

## Verification
- `npx vitest run tests/onvif-events.test.ts`: 8/8 tests passed.
- `npm test`: 102/102 tests passed across 15 test suites.
- `npm run build`: TypeScript compiled cleanly with 0 errors.
