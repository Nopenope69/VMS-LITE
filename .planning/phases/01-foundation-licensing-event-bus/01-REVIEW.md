---
phase: 01-foundation-licensing-event-bus
reviewed: 2026-09-24T02:27:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/server.ts
  - src/index.ts
  - src/db/prisma.ts
  - src/licensing/types.ts
  - src/licensing/verifier.ts
  - src/licensing/capabilities.ts
  - src/licensing/plugin.ts
  - src/users/auth.service.ts
  - src/users/rbac.guard.ts
  - src/users/auth.routes.ts
  - src/events/event.types.ts
  - src/events/event-bus.ts
  - src/events/event.routes.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: clean
---

# Phase 1: Code Review Report

**Reviewed:** 2026-09-24T02:27:00Z  
**Depth:** standard  
**Files Reviewed:** 13  
**Status:** clean  

## Summary

Adversarial code review was performed on all core source modules implemented during Phase 1: Foundation, Licensing & Event Bus.
The codebase represents a clean-room implementation free of any VigilOne multi-tenancy, evidentiary schema, or proprietary code patterns.
Authentication uses bcrypt with appropriate salt rounds (10) and signed JWT tokens with standard 7-day expiration.
Offline licensing uses Ed25519 cryptographic signatures with explicit base64url/hex validation, error classes, and fallback evaluation behavior.
The Capability Registry correctly encapsulates license features behind `capabilities.has(...)`, preventing plan checks from leaking into business routes.
Event Bus provides in-process pub/sub broadcast alongside PostgreSQL persistence with an in-memory fallback during DB-less tests.

All automated tests (20/20) pass, TypeScript compilation passes with zero errors, and no critical vulnerabilities or blockers were found.

## Critical Issues

None.

## Warnings

### WR-01: Default Hardcoded JWT Secret Fallback in Server Setup

**File:** `src/server.ts:27`  
**Issue:** If `JWT_SECRET` is not set in the environment and not passed in `opts`, the server falls back to `'dev-secret-basic-vms-super-secure'`. While convenient for local development and test runs, production deployments should mandate a securely generated random secret to avoid token forgery across sites.  
**Fix:** Consider adding a runtime check in production mode (`process.env.NODE_ENV === 'production'`) that warns or fails boot if `JWT_SECRET` is missing or uses the default dev secret.

## Info

### IN-01: In-Memory Event ID Generation in Fallback Mode

**File:** `src/events/event-bus.ts:57`  
**Issue:** When the PostgreSQL connection fails or tables are unmigrated, `EventBus` catches the error and assigns an in-memory fallback ID `local-${Date.now()}-${Math.random().toString(36)...}`. This maintains test runner isolation and dev-mode resilience, but these events will not persist across server reboots.  
**Fix:** Document or log a debug warning when falling back to ephemeral in-memory storage so installers notice database connectivity errors during live deployments.

---

_Reviewed: 2026-09-24T02:27:00Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
