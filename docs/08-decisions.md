# Architectural Decision Log & ADRs — P02 Stock Ledger

This document records the architectural decision records (ADRs), trade-offs, deployment rationales, AI collaboration logs, and remaining gaps for **Techvisk P02: The Stock Ledger**.

---

## 1. Data-Model Decisions (ADR-01)
- **Decision**: Adopt Drizzle ORM (`drizzle-orm v0.45.4`) with `node-postgres` over Prisma or TypeORM.
- **Rationale**: Drizzle compiles to pure SQL with zero query-generator overhead. It natively supports advanced PostgreSQL dialect features required by P02: `NULLS NOT DISTINCT`, `SELECT ... FOR UPDATE` pessimistic locks, and table check constraints.
- **Alternatives Rejected**: Prisma (rejected due to query-engine binary overhead, inability to easily express `FOR UPDATE` on partial slices, and cold start latency on serverless containers).

---

## 2. Database Constraint Decisions (ADR-02)
- **Decision**: Enforce physical and business invariants directly in PostgreSQL rather than relying solely on TypeScript application logic:
  - `CHECK (quantity >= 0)` on `inv_stock_quants` (zero negative physical stock).
  - `CHECK (reserved_quantity >= 0)` and `CHECK (reserved_quantity <= quantity)` on `inv_stock_quants`.
  - `CHECK (quantity > 0)` and `CHECK (source_location_id <> destination_location_id)` on `inv_stock_moves`.
  - `UNIQUE NULLS NOT DISTINCT (product_id, variant_id, location_id, lot_id)` on `inv_stock_quants`.
- **Rationale**: Application-layer checks fail under race conditions. Database engine constraints make corrupted state mathematically impossible to persist.

---

## 3. Stock-Movement & Posting Decisions (ADR-03)
- **Decision**: Synchronous, atomic double-entry posting inside a single PostgreSQL transaction with pessimistic row locking (`SELECT ... FOR UPDATE`).
- **Rationale**: Stock movements must be immediate. If an order posts, available stock must deduct instantly to prevent double-selling to a concurrent buyer.
- **Alternatives Rejected**: Asynchronous queue-based movement posting (rejected due to phantom stock visibility lag and eventual consistency overselling risks during flash sales).

---

## 4. API & Validation Decisions (ADR-04)
- **Decision**: Enforce Zod schemas on every request body (`createStockMoveSchema`), query parameter set (`stockOnHandQuerySchema`), and route parameter (`stockMoveParamsSchema`) via a custom NestJS `ZodValidationPipe`.
- **Rationale**: Fails fast with standardized 400 Bad Request responses before any database work is initiated. Compile-time type inference (`z.infer<T>`) enforces zero usage of `any` across the backend.

---

## 5. Frontend Architecture Decisions (ADR-05)
- **Decision**: Standalone Angular 22 component architecture using `provideZonelessChangeDetection()` and `ChangeDetectorRef.markForCheck()`.
- **Rationale**: Modern Angular eliminates the performance overhead of legacy `zone.js`. Explicit change detection triggers ensure instant DOM updates and live real-time recalculation of the Available column ($\text{On-Hand} - \text{Reserved}$) as users type.
- **Alternatives Rejected**: React / Next.js (rejected to comply strictly with the handbook's Angular requirement).

---

## 6. Hosting & Deployment Decisions (ADR-06)
- **Decision**:
  - **Database**: Neon Serverless PostgreSQL (`ep-blue-dust-aomr6rgt-pooler.c-2.ap-southeast-1.aws.neon.tech`) in Singapore AWS region.
  - **Backend API**: Render Web Service (`https://stock-ledger-api.onrender.com`), deploying automatically from GitHub `main`.
  - **Frontend SPA**: Vercel (`https://stock-ledger-6ye1.vercel.app`), deploying automatically from GitHub `main`.
- **Rationale**: Zero fixed cost for internship evaluation; fully auditable live deployment URLs with instant CI/CD deployment on git push.

---

## 7. Performance Decisions (ADR-07)
- **Decision**: Dual-Layer architecture: immutable ledger in `inv_stock_moves` and real-time read-cache in `inv_stock_quants`.
- **Rationale**: In our 1-million-row load testing, summing movements on the fly took 5,822ms and collapsed throughput to 3.8 req/s. Reading from `inv_stock_quants` achieved **399.2 req/s at 124ms p50**.

---

## 8. Security & Tenant-Isolation Decisions (ADR-08)
- **Decision**: Tenant scoping via `merchant_id` on `inv_warehouses`. Parameterized SQL across all queries to prevent SQL injection.
- **Identified Gap & Recommendation**: In multi-tenant environments, future iterations should enforce PostgreSQL Row-Level Security (RLS) with session-scoped `SET LOCAL app.current_merchant_id` to prevent developer join bugs from leaking cross-tenant stock.

---

## 9. Trade-Offs & Rejected Alternatives Summary

| Proposed Alternative | Why Rejected | Chosen Approach |
| :--- | :--- | :--- |
| **Pure Event Sourcing** | Reading stock by summing historical moves collapsed throughput to 3.8 req/s on 1M rows. | Dual-Layer: Ledger for audit, Quants for sub-millisecond reads. |
| **Optimistic Concurrency (Version Column)** | 200 concurrent sales caused 199 aborts, retry storms, and connection pool exhaustion. | Pessimistic Locking (`SELECT ... FOR UPDATE`) serializes cleanly. |
| **Allowing Negative Stock** | Destroys FIFO inventory valuation and allows phantom inventory. | Hard database constraint `CHECK (quantity >= 0)`. |
| **Monolithic XML Models (Odoo style)** | Creates massive table bloat and high maintenance overhead. | Clean typed TypeScript schemas with Drizzle ORM. |

---

## 10. Actual Build & Development Timings

Based on git commit records and terminal execution logs:
- **Project Initialized**: October 13, 2026 ~14:15 IST
- **Stage G Concurrency & Test Suite Implemented**: October 13, 2026 ~21:00 IST
- **Neon PostgreSQL Cloud Migration**: October 14, 2026 ~13:30 IST
- **Render Backend API Deployment**: October 14, 2026 ~14:25 IST
- **Vercel Frontend Deployment**: October 14, 2026 ~14:40 IST
- **Zoneless Live Calculation & Audit Updates**: October 14, 2026 ~15:52 IST
- *Note on Offline Development*: Detailed offline coding hours prior to initial git commit need candidate verification.

---

## 11. AI Collaboration Log

In accordance with handbook guidelines, AI coding assistants (Google Antigravity / Gemini) were utilized transparently under engineering supervision:

1. **What AI Was Asked to Produce**:
   - Initial Drizzle ORM schema boilerplate and migration generation.
   - Comprehensive Vitest e2e suite covering 200 concurrent sales and overdraft scenarios (`inventory-ledger.e2e-spec.ts`).
   - Autocannon benchmark runner script (`load/scripts/benchmark-api.cjs`).
   - Angular UI styles and floating toast notification styling.
2. **How Output Was Verified**:
   - **Compilers**: Every generated file was verified through `nest build` and `ng build` (zero TypeScript errors, `noImplicitAny`).
   - **Automated Tests**: E2E test suites were executed against live PostgreSQL to confirm that 200 concurrent sales yielded exactly 50 units without overdraft.
   - **Database Checks**: Direct SQL inspection (`check-db.cjs`) verified that constraint violations (`CHECK quantity >= 0`) correctly rolled back transactions.
   - **Manual Review**: Architectural decisions, ADRs, and load testing analyses were reviewed and verified by the developer.

---

## 12. What is not done

To maintain absolute academic and professional honesty, the following features and extensions are documented as **not completed** in the current P02 submission:

1. **Multi-Step Route Engine (Push/Pull Rules)**:
   - Automated 3-step routing (`Pick -> Pack -> Ship`) is not implemented; all movements currently execute as direct point-to-point transfers.
2. **Dynamic Put-Away Automation**:
   - Destination locations must be explicitly specified by the client; automated destination selection based on bin dimensions or FEFO expiration dates is not built.
3. **Landed Cost Allocation Module**:
   - Inbound movements record static `unit_cost_paise`; there is no accounting interface to retrospectively apportion ocean freight or import customs tariffs across received inventory batches.
4. **Lot & Serial Tracking Graph UI**:
   - The schema includes a `lot_id` foreign key on moves and quants, but an interactive visual geneology tree for batch recalls is not implemented.
5. **Database Row-Level Security (RLS)**:
   - Multi-tenancy is enforced at the application query level via `merchant_id` on warehouses, rather than through PostgreSQL native Row-Level Security policies.
6. **Tier L Load Testing on Real Hardware**:
   - The 25,000,000 movement platform scale workload was mathematically modeled and costed using AWS Mumbai list prices, but was not executed on a multi-node Kubernetes cluster.
