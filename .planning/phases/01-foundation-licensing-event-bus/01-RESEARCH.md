# Phase 1: Foundation, Licensing & Event Bus - Research

**Researched:** 2026-09-24  
**Domain:** Node.js/Fastify control plane, PostgreSQL database schema, Ed25519 offline licensing, 2-role RBAC, and unified Event bus  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from PROJECT.md & REQUIREMENTS.md)

### Locked Decisions
- **Zero VigilOne Domain Entanglement**: Fresh clean-room repo, fresh minimal database schema. Do NOT share VigilOne's Prisma schema, multi-tenant hierarchy, or evidentiary chain models.
- **Licensing Clean Boundary**: License verifies at boot using `@noble/ed25519` into a Capability Registry (`capabilities.has(...)`). Modules and route namespaces mount conditionally. No tier checks in business logic or controllers.
- **2-Role RBAC**: Admin and Viewer roles only for single-site deployment.
- **Unified Event Model**: Single `events` table (`id`, `camera_id`, `timestamp`, `type`, `source`, `severity`, `metadata`, `created_at`).
- **Core Event Types**: `camera.offline/online`, `recording.started/stopped`, `storage.warning/full`.

### the agent's Discretion
- Fastify plugin architecture for route modularity.
- Database access pattern (Prisma client with PostgreSQL).
- In-process event emitter syncing to PostgreSQL `events` table.
- JWT session management with HTTP-only cookies and Authorization headers.

### Deferred Ideas (OUT OF SCOPE)
- Multi-tenancy (tenants, organizations, cross-tenant RBAC).
- Operator role with per-camera permissions (Package 2).
- Evidentiary audit logs or Section 63 BSA certificate generation (VigilOne only).
- AI event ingestion or computer vision detection (Package 3).
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ed25519 License Verification | API/Backend (`src/licensing`) | System Boot | Offline token verification and capability resolution must happen before route registration. |
| Capability Registry | API/Backend (`src/licensing`) | Route Guard / Fastify Plugin | Gates namespace registration and API handlers declaratively. |
| User Auth & 2-Role RBAC | API/Backend (`src/users`) | Database | Issues JWT sessions and enforces Admin vs Viewer role scopes. |
| Event Bus Logging | API/Backend (`src/events`) | Database (`events` table) | In-process bus dispatches lifecycle events and immediately records to durable relational storage. |
| Database Schema & Migrations | Database/Storage (PostgreSQL) | API/Backend | Relational storage for users, cameras, recordings, and events. |
</architectural_responsibility_map>

<research_summary>
## Summary

Phase 1 lays the architectural and security foundation for Basic VMS. It establishes a high-performance Fastify HTTP server in TypeScript, backed by PostgreSQL, with a clean-room modular domain structure.

The two core architectural pillars built in this phase are the **Ed25519 Capability Registry** and the **Unified Event Bus**. The licensing subsystem is completely decoupled from any VigilOne enterprise code: it cryptographically verifies offline Ed25519 signed license tokens (product, edition, camera limit, expiration) and converts them into an in-memory capability set. Controllers check `capabilities.has("feature")`, ensuring Package 1 Core runs cleanly while providing the foundation for Package 2 and 3 modular plug-ins. The Event Bus provides a standardized pub/sub interface that writes directly to the PostgreSQL `events` table, ready for video lifecycle events and future AI detections.

**Primary recommendation:** Build `src/licensing` as an isolated pure library with zero database or domain dependencies, instantiate Fastify with a modular plugin architecture that registers routes based on resolved capabilities, and implement a strongly typed `EventEmitter`-backed Event Bus that persists to PostgreSQL.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | v20+ LTS | Runtime environment | Native WebCrypto, ESM/CommonJS support, stable performance. |
| TypeScript | 5.x | Language & Type Safety | Eliminates runtime type errors across domain models and event schemas. |
| Fastify | 4.x / 5.x | HTTP Application Framework | High throughput, schema-based serialization, clean encapsulation via plugins. |
| PostgreSQL | 16+ | Relational Database | ACID transactions, robust JSONB support for event metadata, high concurrency. |
| Prisma | 5.x / 6.x | Database ORM & Migrations | Type-safe query generation, automated migrations, zero boilerplate for schema updates. |
| `@noble/ed25519` | 2.x | Cryptographic Verification | Dependency-free, audited, standards-compliant Ed25519 implementation. |
| `@fastify/jwt` | Latest | JWT Auth Plugin | Seamless Fastify request decoration and token verification. |
| `zod` | 3.x | Runtime Validation | Type-safe validation of license documents, event payloads, and API requests. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bcrypt` | 5.x | Password Hashing | Secure salting and hashing for Admin and Viewer credentials. |
| `@fastify/cors` | Latest | CORS Support | Enables web frontend communication in development and deployment. |
| `dotenv` | Latest | Configuration Management | Local environment variable loading. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Prisma | Kysely / Raw SQL | Kysely has smaller runtime footprint, but Prisma accelerates initial schema modeling and migration management. |
| `@noble/ed25519` | Node `crypto.verify` | Node native crypto can verify Ed25519, but `@noble/ed25519` provides identical cross-platform and browser verification ergonomics. |
| EventEmitter | Redis Pub/Sub | Redis adds an external service dependency; in-process event emitter with Postgres logging is simpler and self-contained for single-node NVR. |

**Installation:**
```bash
npm install fastify @fastify/jwt @fastify/cors @noble/ed25519 zod bcrypt @prisma/client
npm install -D typescript @types/node @types/bcrypt prisma tsx vitest
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### System Architecture Diagram

```
[System Boot]
     │
     ▼
[Load License Token] ──(Ed25519 Verify)──> [Capability Registry]
                                                   │
     ┌─────────────────────────────────────────────┴───────────────────────┐
     ▼                                                                     ▼
[Fastify Core Server]                                         [Module Mounting Gate]
     │                                                                     │
     ├── /api/auth (Login, Me, Refresh)                                    ├── /api/core (Package 1: Always Active)
     ├── /api/events (Query, Stream)                                       ├── /api/extended (Package 2: Gated)
     │                                                                     └── /api/ai (Package 3: Gated)
     ▼
[Core Event Bus] ──(emit)──> [PostgreSQL: events table]
```

### Recommended Project Structure
```
vms/
├── prisma/
│   └── schema.prisma        # Minimal clean-room schema (Users, Events)
├── src/
│   ├── licensing/           # Standalone clean-room licensing library
│   │   ├── verifier.ts      # Ed25519 offline token verification
│   │   ├── capabilities.ts  # Capability Registry interface & implementation
│   │   └── types.ts         # License document and payload types
│   ├── users/               # Authentication & RBAC (Admin, Viewer)
│   │   ├── auth.service.ts
│   │   ├── auth.routes.ts
│   │   └── rbac.guard.ts
│   ├── events/              # Unified Core Event Bus
│   │   ├── event-bus.ts     # In-process pub/sub with typed event emitters
│   │   ├── event.types.ts   # Unified Event schema & standard event types
│   │   └── event.routes.ts  # Query & subscription endpoints
│   ├── server.ts            # Fastify application bootstrap & plugin registration
│   └── index.ts             # Entrypoint
└── tests/
    ├── licensing.test.ts
    ├── rbac.test.ts
    └── event-bus.test.ts
```

### Pattern 1: Standalone Ed25519 Capability Registry
**What:** Decouples licensing verification from business logic. The license file or token is read at boot, verified against an embedded public key, and converted into an immutable `CapabilityRegistry`.
```typescript
export interface CapabilityRegistry {
  has(capability: string): boolean;
  getLimit(limitKey: string): number;
  getExpiresAt(): Date | null;
}
```

### Pattern 2: Unified Event Dispatcher
**What:** Central event dispatcher that guarantees every system event is both broadcast in real-time and written to the database.
```typescript
export interface SystemEvent<T = Record<string, unknown>> {
  id: string;
  cameraId?: string | null;
  type: string;
  source: string;
  severity: "info" | "warning" | "critical";
  metadata: T;
  timestamp: Date;
}
```

### Anti-Patterns to Avoid
- **Scattering plan checks:** Never write `if (user.plan === 'CORE')` or check tier names in controllers. Always check `capabilities.has(...)`.
- **Inheriting VigilOne database models:** Never copy `Tenant`, `Organization`, `EvidenceFile`, or `BsaCertificate` into `schema.prisma`.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ed25519 Signature Verification | Custom crypto math | `@noble/ed25519` | Subtle side-channel attacks, signature malleability, and curve edge cases. |
| Password Storage | SHA-256 / MD5 hashing | `bcrypt` (or `argon2`) | Fast hashes allow trivial dictionary cracking of camera NVR credentials. |
| Auth Tokens | Custom session strings | `@fastify/jwt` / signed JWT | Standard expiry handling, claims verification, and stateless validation. |
| Schema Validation | Handcrafted `typeof` checks | `zod` | Guarantees exact runtime typing and structural validation of license documents. |
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Leaking Secrets from Past Repositories
**What goes wrong:** Reusing sample `.env` files or committing private Ed25519 signing keys.  
**Why it happens:** Copying boilerplate from prior internal prototypes.  
**How to avoid:** Generate fresh, isolated public/private key pairs for Basic VMS development. Embed only the public verification key in the application binary/code.

### Pitfall 2: Blocking Fastify Startup on Missing License
**What goes wrong:** Server crashes entirely if no license token is found on first run.  
**Why it happens:** Overzealous validation during local developer setup or initial installation.  
**How to avoid:** If no license token is provided, default gracefully to a localized Community/Evaluation capability set (e.g. 2 cameras, Package 1 Core, 30-day evaluation) or mount a dedicated Setup/Activation route.

### Pitfall 3: Database Connection Contention in Event Logging
**What goes wrong:** High event rates starve HTTP request handlers of database connections.  
**Why it happens:** Each event emission opening an unmanaged database transaction.  
**How to avoid:** Use Prisma's connection pool properly and log events asynchronously with error handling without blocking request processing.
</common_pitfalls>

<code_examples>
## Code Examples

### Ed25519 License Verification
```typescript
import * as ed from '@noble/ed25519';
import { z } from 'zod';

const LicensePayloadSchema = z.object({
  product: z.literal('basic-vms'),
  edition: z.enum(['core', 'extended', 'ai']),
  capabilities: z.array(z.string()),
  cameraLimit: z.number().int().positive(),
  expiresAt: z.string().datetime().nullable(),
  issuedAt: z.string().datetime(),
});

export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

export async function verifyLicenseToken(
  token: string,
  publicKeyHex: string
): Promise<LicensePayload> {
  const [headerB64, payloadB64, signatureHex] = token.split('.');
  if (!headerB64 || !payloadB64 || !signatureHex) {
    throw new Error('Malformed license token');
  }

  const message = `${headerB64}.${payloadB64}`;
  const messageBytes = new TextEncoder().encode(message);
  const isValid = await ed.verifyAsync(signatureHex, messageBytes, publicKeyHex);

  if (!isValid) {
    throw new Error('Invalid license signature');
  }

  const payloadJson = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  return LicensePayloadSchema.parse(payloadJson);
}
```

### Capability Registry
```typescript
export class CapabilityRegistry {
  private capabilities: Set<string>;
  private cameraLimit: number;
  private expiresAt: Date | null;

  constructor(payload: LicensePayload) {
    this.capabilities = new Set(payload.capabilities);
    this.cameraLimit = payload.cameraLimit;
    this.expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  }

  has(capability: string): boolean {
    if (this.expiresAt && this.expiresAt < new Date()) {
      return false;
    }
    return this.capabilities.has(capability);
  }

  getCameraLimit(): number {
    return this.cameraLimit;
  }
}
```
</code_examples>

<open_questions>
## Open Questions
1. **License Ingestion:** Should the initial installation accept license via environment variable (`BASIC_VMS_LICENSE`) or file path (`/etc/basic-vms/license.lic`)?
   - *Recommendation:* Support both: check `BASIC_VMS_LICENSE` env first, fall back to file path, and fall back to 2-camera evaluation mode.
2. **Initial Admin User:**
   - *Recommendation:* Seed initial admin user (`admin` / `admin`) on first migration with `forcePasswordChange: true` flag in database.
</open_questions>

<metadata>
## Metadata
**Research scope:** Fastify, TypeScript, Prisma, PostgreSQL, `@noble/ed25519`, Event Bus, RBAC  
**Confidence breakdown:**
- Standard stack: HIGH
- Architecture: HIGH
- Pitfalls: HIGH
- Code examples: HIGH  
**Valid until:** 2026-10-24  
</metadata>

---
*Phase: 01-foundation-licensing-event-bus*  
*Research completed: 2026-09-24*  
*Ready for planning: yes*  
