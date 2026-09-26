# Phase 17: Motion Recording with Rolling Ring Buffer - Validation

## Validation Gates

### Automated Integration & Unit Tests
1. **Rolling FIFO Queue & Auto-Discard**:
   - Short segments arriving for a camera in `MOTION_ONLY` mode are added to the ring buffer.
   - When no motion events occur, segments older than the buffer TTL (e.g. 30 seconds) are automatically deleted from disk and unlinked from the queue.
   - Database remains completely empty of recording rows during quiet/idle periods.
2. **Pre-Buffer Promotion on Motion Detection**:
   - Emitting `motion.detected` for `cameraId` on `EventBus` triggers the promotion engine.
   - Segments from the preceding 10 seconds (`preBufferSeconds`) are atomically promoted to permanent storage and cataloged in PostgreSQL.
3. **Active Motion & Post-Buffer Cooldown**:
   - Segments arriving while motion is active are cataloged immediately.
   - When motion ceases, the 30-second post-event timer ensures subsequent segments continue to be promoted.
   - Subsequent motion triggers extend the post-event timer.
   - When the post-event timer expires, the incident closes and future segments return to the rolling buffer queue.
4. **REST APIs & Status**:
   - `GET /api/recordings/motion-buffer/status` returns active buffer queue lengths and incident states.
   - Settings API allows configuring `preBufferSeconds` and `postBufferSeconds`.
5. **UI & Build Gates**:
   - `npm run build:client` (Vite) passes with zero errors.
   - `npm run build` (tsc) passes with zero errors.
   - Full test suite passes 100%.
