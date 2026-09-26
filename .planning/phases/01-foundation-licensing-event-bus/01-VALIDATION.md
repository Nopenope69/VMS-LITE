---
phase: 1
slug: foundation-licensing-event-bus
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-24
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` (installed in Wave 0) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm run test:all` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm run test:all`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | AUTH-01 | T-01-01 | TypeScript builds cleanly with fastify/prisma | build | `npm run build` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | EVT-01 | T-01-02 | Database schema generates client and types | schema | `npx prisma generate` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | LIC-01 | T-01-03 | Valid Ed25519 token verifies successfully | unit | `npx vitest run tests/licensing.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | LIC-02 | T-01-04 | Tampered/expired license rejects with clear error | unit | `npx vitest run tests/licensing.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | LIC-03 | T-01-05 | Gated route returns 403 when capability missing | integration | `npx vitest run tests/capability-gate.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | AUTH-01 | T-01-06 | Admin can access all endpoints, Viewer restricted | integration | `npx vitest run tests/rbac.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 2 | AUTH-02 | T-01-07 | Invalid/expired JWT rejected with 401 | unit | `npx vitest run tests/rbac.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 2 | EVT-01 | T-01-08 | Emitted event persists to PostgreSQL events table | integration | `npx vitest run tests/event-bus.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-04 | 03 | 2 | EVT-02 | T-01-09 | Standard lifecycle events queryable via API | integration | `npx vitest run tests/event-bus.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` with Fastify, Prisma, `@noble/ed25519`, Vitest dependencies
- [ ] `vitest.config.ts` configured for TypeScript module resolution
- [ ] `tests/licensing.test.ts` test fixture with test Ed25519 keypair
- [ ] `tests/rbac.test.ts` test fixture for Admin vs Viewer authentication
- [ ] `tests/event-bus.test.ts` test fixture for event bus publishing and logging

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Offline Cold Boot | LIC-04 | Verify node starts without internet connection | Disconnect network adapter, start server with offline license, verify capability registry initializes |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Approved 2026-09-24
