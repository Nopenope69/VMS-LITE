---
phase: 05-24-hour-playback-timeline-scrubbing
plan_count: 2
total_tasks: 6
requirements:
  - PLAY-01
  - PLAY-02
  - PLAY-03
  - PLAY-04
---

# Phase 5: Validation Strategy

## Test Coverage Matrix

| Requirement | Test File | Test Case | Target State |
|-------------|-----------|-----------|--------------|
| **PLAY-01** | `tests/playback.test.ts` | Queries 24-hour recorded timeline spans for a camera | PASS |
| **PLAY-02** | `client` typecheck & tests | Timeline scrubber converts click/drag coordinates to timestamps | PASS |
| **PLAY-03** | `tests/playback.test.ts` | Generates MediaMTX fMP4 playback streaming URLs | PASS |
| **PLAY-04** | `client` typecheck & tests | PlaybackControls handles play, pause, step, and speed multiplier | PASS |

## Automated Gates

- `npm test` runs all backend suites and exits 0.
- `npm run build` verifies backend TypeScript compilation with 0 errors.
- `npx tsc -p client/tsconfig.json --noEmit` verifies client TypeScript compilation with 0 errors.
- Playback routes enforce JWT authentication and 24-hour query limits.
