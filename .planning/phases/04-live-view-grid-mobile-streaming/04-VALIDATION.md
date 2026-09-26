---
phase: 04-live-view-grid-mobile-streaming
plan_count: 2
total_tasks: 5
requirements:
  - LIVE-01
  - LIVE-02
  - LIVE-03
  - LIVE-04
---

# Phase 4: Validation Strategy

## Test Coverage Matrix

| Requirement | Test File | Test Case | Target State |
|-------------|-----------|-----------|--------------|
| **LIVE-01** | `tests/streaming-routes.test.ts` | Returns WHEP streaming URLs for cameras | PASS |
| **LIVE-02** | `tests/streaming-routes.test.ts` | Resolves HLS fallback stream URLs | PASS |
| **LIVE-03** | `client` component tests / type checks | 1x1, 2x2, 3x3 grid layouts render correctly | PASS |
| **LIVE-04** | `tests/ice-servers.test.ts` | Generates valid STUN and ephemeral TURN credentials | PASS |

## Automated Gates

- `npm test` runs all backend suites and exits 0.
- `npm run build` verifies full TypeScript compilation with 0 errors.
- RBAC verification: ensure `/api/streaming/config` and `/api/streaming/ice-servers` enforce JWT authentication.
