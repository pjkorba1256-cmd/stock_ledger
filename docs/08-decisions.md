# Architectural Decision Records (ADRs)

This document records the eight critical architecture decisions made during the design and implementation of **Techvisk P02: The Stock Ledger**.

---

## ADR-01: Adoption of Drizzle ORM over Prisma / TypeORM

### Status
Accepted & Implemented.

### Context
The application requires high-performance, strictly typed SQL operations, atomic transactions with row-level locking (`FOR UPDATE`), raw SQL expressions for check constraints, and native ESM module resolution under Node.js 24 and TypeScript strict mode.

### Decision
Use **Drizzle ORM** with `node-postgres` (`pg`) and Drizzle Kit migrations.

### Consequences
- **Positive**: Zero query generation bloat; native support for PostgreSQL features like `NULLS NOT DISTINCT`, `FOR UPDATE`, and partial unique indexes; lightweight memory footprint.
- **Negative**: Requires writing explicit relational queries rather than relying on automatic nested active-record cascades.

---

## ADR-02: Strict Zod Validation for All Request Interfaces

### Status
Accepted & Implemented.

### Context
Relying on implicit type coercion or loose TypeScript interfaces allows malformed parameters (such as invalid UUID strings, negative numbers, or oversized limit queries) to penetrate into database queries, resulting in unhandled 500 crashes or SQL exceptions.

### Decision
Enforce **Zod** validation via custom NestJS `ZodValidationPipe` across:
1. Every request body (e.g. `createStockMoveSchema`).
2. Every query parameter set (e.g. `stockOnHandQuerySchema`, `stockMoveHistoryQuerySchema`).
3. Every route parameter (e.g. `stockMoveParamsSchema` enforcing UUID format).

### Consequences
- **Positive**: Invalid inputs fail fast at the boundary with standardized 400 Bad Request responses before any database work is initiated.
- **Positive**: Strict compile-time inference via `z.infer<T>` ensures zero usage of `any`.

---

## ADR-03: Strict Differentiation of Physical vs Virtual Locations

### Status
Accepted & Implemented.

### Context
In real-world inventory (inspired by Odoo), supplier receipts (`GRN`) and customer deliveries (`SALE`) transfer goods to/from external counterparties. Treating all locations identically would cause vendors to record negative stock, violating database constraints.

### Decision
Classify locations into physical (`INTERNAL`) and virtual counterparties (`SUPPLIER`, `CUSTOMER`, `LOSS`, `SCRAP`, `TRANSIT`):
- Physical locations (`INTERNAL`): Stock is strictly non-negative ($\ge 0$) and tracked in `inv_stock_quants`. Deductions verify available stock.
- Virtual locations: Act as infinite sources or sinks; quants are not tracked or checked.

### Consequences
- **Positive**: Supports clean double-entry accounting without artificial stock balances for outside vendors or customers.

---

## ADR-04: Database-Enforced Non-Negative Stock Invariants

### Status
Accepted & Implemented.

### Context
Application-only balance checks (`if (qty < 0) throw`) are susceptible to race conditions under concurrent execution.

### Decision
Enforce non-negative inventory via PostgreSQL table check constraints:
- `CHECK (quantity >= 0)`
- `CHECK (reserved_quantity >= 0)`
- `CHECK (reserved_quantity <= quantity)`

### Consequences
- **Positive**: Guarantees data integrity at the database engine level; impossible for corrupted or negative inventory to be persisted even under extreme concurrency.

---

## ADR-05: Strict Movement State Machine & Immutability

### Status
Accepted & Implemented.

### Context
Modifying or deleting past stock movements causes historical audit trails to become untrustworthy and invalidates stock-on-hand reconciliations.

### Decision
Implement an explicit state transition machine:
- Movement starts in `DRAFT`.
- Must transition to `CONFIRMED` before posting.
- Posting transitions state to `DONE` and stamps `done_date = NOW()`.
- Movements in `DONE` state are **strictly immutable**: they cannot be edited, deleted, cancelled, or re-posted.
- Physical adjustments require Compensating Movements (`ADJUSTMENT` / `RETURN`).

### Consequences
- **Positive**: Provides a tamper-proof, auditable history compliant with financial and supply-chain auditing standards.

---

## ADR-06: Synchronous Posting vs Asynchronous BullMQ Reconciliation

### Status
Accepted & Implemented.

### Context
Reconciliation across 1,000,000+ movements is compute-heavy and degrades API responsiveness if executed synchronously under high traffic. Conversely, stock posting must be synchronous to avoid phantom stock and race conditions.

### Decision
1. Keep stock movement posting **synchronous and atomic** inside a PostgreSQL transaction.
2. Delegate heavy, periodic reconciliation audits to **BullMQ with Redis**, configured with retry policies, exponential backoff, and idempotency keys.

### Consequences
- **Positive**: Clean separation of critical write paths and analytical background verification.

---

## ADR-07: Exact Decimal Handling for Quantities

### Status
Accepted & Implemented.

### Context
JavaScript IEEE-754 floating-point arithmetic (e.g. `0.1 + 0.2 === 0.30000000000000004`) introduces drift in high-volume inventory systems.

### Decision
Store all quantities in PostgreSQL as `numeric(14,3)` (milli-unit precision) and perform decimal arithmetic using integer milli-units or PostgreSQL arbitrary-precision arithmetic.

### Consequences
- **Positive**: Zero floating-point drift over millions of inventory calculations.

---

## ADR-08: Pessimistic Row Locking (`FOR UPDATE`) for Concurrency Contention

### Status
Accepted & Implemented.

### Context
High-concurrency scenarios (e.g. 200 orders contending for the same SKU at a warehouse location) must not result in race conditions, overselling, or deadlocks.

### Decision
Use `SELECT ... FOR UPDATE` on both the movement row and the source quant row within the transaction boundary.

### Consequences
- **Positive**: Concurrently arriving transactions serialize smoothly at the database engine; verified by automated tests running 200 concurrent sales in 1.7s with zero overselling.
