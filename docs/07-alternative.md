# Architectural Alternatives & Trade-Off Analysis

## 1. Overview

During the design and engineering of **Techvisk P02: The Stock Ledger**, multiple architectural patterns and storage strategies were evaluated. This document details the architectural alternatives, trade-offs, failure modes, and the rationale behind the chosen design.

---

## 2. Comparison Matrix of Core Architectural Choices

| Decision Area | Chosen Approach | Alternative Considered | Trade-off Rationale |
| :--- | :--- | :--- | :--- |
| **Stock Storage Model** | **Dual-Layer (Ledger + Quants Snapshot)** | Pure Event Sourcing (Aggregate on Read) | Pure event sourcing guarantees auditability but degrades read performance ($O(N)$ query cost). The dual-layer design provides sub-millisecond $O(1)$ reads with reconciliation audits. |
| **Concurrency Control** | **Pessimistic Row Locking (`FOR UPDATE`)** | Optimistic Concurrency (`version` column) | Under high flash-sale contention (200 sales on 1 SKU), optimistic concurrency causes massive retry storms and high client abort rates. Pessimistic locks serialize writes cleanly with zero retries. |
| **Posting Pipeline** | **Synchronous Database Transaction** | Fully Asynchronous Posting via Queue | Asynchronous posting creates phantom stock visibility lags and eventual consistency risks. Synchronous posting guarantees that once an order returns 200/201, the physical stock is deducted. |
| **Database Engine** | **PostgreSQL 18 + Drizzle ORM** | MongoDB / NoSQL Document Stores | Inventory requires ACID transactions, foreign key restrictions, check constraints (`quantity >= 0`), and unique partial indexes. NoSQL lacks database-enforced relational integrity. |
| **Background Processing** | **BullMQ with Redis for Reconciliation** | In-Process Background Timers (`setInterval`) | Node.js timers fail across multiple horizontally scaled containers and lose job progress on server restarts. BullMQ provides durable queues with persistent retries. |

---

## 3. Deep Dive: Pure Event Sourcing vs Dual-Layer Quant Snapshot

### Alternative A: Pure Event Sourcing
In pure event sourcing, there is no `inv_stock_quants` table. Whenever stock on hand is requested:
```sql
SELECT
  product_id,
  location_id,
  SUM(CASE WHEN destination_location_id = $loc THEN quantity ELSE -quantity END) AS on_hand
FROM inv_stock_moves
WHERE state = 'DONE'
GROUP BY product_id, location_id;
```
- **Pros**: Zero possibility of mathematical drift between ledger and stock counter. Perfect purity.
- **Cons & Failure Mode**:
  As proven by our 1 Million row benchmark (`load/benchmark-api.cjs`), aggregating over 1,000,000 rows took **~5,800 ms** and throughput plummeted to **3.8 req/sec**. Under production traffic of 100 concurrent checkout requests, the database CPU reaches 100% and crashes.

### Chosen Pattern: The Dual-Layer Architecture
We store the authoritative immutable ledger in `inv_stock_moves` and maintain real-time snapshot balances in `inv_stock_quants`:
- **Read Path**: Reads query `inv_stock_quants` directly, achieving **399.2 req/sec** at **124ms p50**.
- **Write Path**: Posting updates both the movement and the quant inside an atomic transaction.
- **Auditing**: The reconciliation engine regularly verifies mathematical equivalence:
  $$\text{Quant Quantity} = \sum \text{Credits} - \sum \text{Debits}$$

---

## 4. Deep Dive: Concurrency Control Under Contention

### Alternative B: Optimistic Concurrency Control (OCC)
In OCC, each quant has a `version` integer:
```sql
UPDATE inv_stock_quants
SET quantity = quantity - $qty, version = version + 1
WHERE id = $quantId AND version = $currentVersion;
```
If two requests execute concurrently, one succeeds, and the other fails with a `VersionConflictException` requiring application-level retries.
- **Why rejected for this project**:
  In flash sales or holiday promotions where 200 orders hit the same product in 2 seconds, 199 requests would fail and enter exponential backoff loops, leading to database connection pool exhaustion and severe latency spikes.

### Chosen Pattern: Pessimistic Row Locking (`SELECT ... FOR UPDATE`)
By locking the source quant row during the transaction:
1. First transaction acquires the lock and decrements stock.
2. Subsequent concurrent transactions queue cleanly at the database lock manager.
3. Each transaction reads the committed deducted balance and evaluates `available >= required`.
- **Validation**: Our automated test `test/inventory-ledger.e2e-spec.ts` processed **200 concurrent sales against the exact same product and location in 1,776 ms with 0 errors and exact mass conservation (250 - 200 = 50.000)**.
