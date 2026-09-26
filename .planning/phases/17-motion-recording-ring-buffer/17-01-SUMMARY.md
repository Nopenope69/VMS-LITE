# Plan 17-01 Summary: Zero-Transcode Rolling Ring Buffer Engine

## Implemented Features
1. **`MotionRingBufferEngine` (`src/recordings/motion-ring-buffer.ts`)**:
   - Manages an in-memory queue of unpromoted short video segments (e.g. 2s) per camera in `MOTION_ONLY` mode.
   - Automatically unlinks expired unpromoted segments older than `bufferTtlSeconds` (30s) directly via injectable `fsUnlinkFn`.
   - Subscribes to `motion.detected` events on `EventBus`.
   - When motion is detected, atomically promotes the preceding pre-buffer segments (default 10s) to permanent recordings via `RecordingCatalog.ingestSegment`.
   - Maintains an active incident state with a post-buffer cooldown timer (default 30s) that is refreshed on successive motion triggers.
   - Incoming segments during active incident cooldown are directly promoted to the permanent catalog.
   - When cooldown expires without further motion, subsequent segments return to the unpromoted rolling ring buffer queue.

2. **Integration with `RecordingEngine` (`src/recordings/recording-engine.ts`)**:
   - Stores `this.repository` on `RecordingEngine` instance.
   - In `ingestSegment`, inspects the camera's recording schedule mode.
   - If `mode === 'MOTION_ONLY'`, routes segment ingestion through `this.motionRingBuffer.handleSegment`.
   - Added `getMotionRingBuffer()` getter to expose buffer engine diagnostics.

3. **Validation & Tests (`tests/motion-ring-buffer.test.ts`)**:
   - Verified 6 automated test scenarios:
     1. Rolling buffer ingestion during quiet periods without DB records.
     2. FIFO pruning and `fs.unlink` for unpromoted segments older than TTL.
     3. Atomic promotion of 10s pre-buffer segments on `motion.detected`.
     4. Direct promotion of incoming segments during active incident window.
     5. Incident closure and transition back to ring buffer after cooldown.
     6. Dynamic cooldown extension on repeated motion events.
   - All 28 test suites passing (268/268 tests).
