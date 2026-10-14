# Performance Benchmark: 1 Million Movements Analysis

## 1. Test Environment & Machine Specifications

- **Operating System**: Windows 11 (win32 x64)
- **Node.js**: v24.21.0 (V8 engine)
- **Framework**: NestJS v12.0.1 on Express platform
- **Database Engine**: PostgreSQL 18.6
- **Connection Pool**: `node-postgres` (`pg`) via Drizzle ORM
- **Benchmark Driver**: `autocannon v8.0.0`
- **Active Dataset**: **1,000,638 stock movements** (`inv_stock_moves`), active warehouses, locations, and quants.

---

## 2. Empirical Benchmark Results (Autocannon)

All metrics were captured using reproducible load scripts in `load/benchmark-api.cjs` against the live NestJS server connected to the 1,000,638-row PostgreSQL database.

| Scenario | Target Endpoint | Concurrency | Duration | Throughput (req/s) | Total Requests | Latency p50 | Latency p90 | Latency p99 | Errors |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Quants Snapshot (Stock-on-Hand)** | `GET /inventory/stock-on-hand?limit=20` | 50 conns | 10s | **399.2** | 3,992 | **124 ms** | **143 ms** | **436 ms** | **0** |
| **Audit Ledger History (1M Rows)** | `GET /inventory/stock-moves?referenceType=GRN&limit=20` | 50 conns | 10s | **3.8** | 38 | **5,822 ms** | **9,185 ms** | **9,809 ms** | 12 |
| **Reconciliation Audit (1M Rows)** | `GET /inventory/reconcile` | 20 conns | 10s | Batch Audit | Single Tx | **4.2s (p50)** | **6.1s (p90)** | — | Timeout on 20 conns |

---

## 3. Critical Architectural Comparison: Quants vs Ledger Aggregation

Why does this system maintain `inv_stock_quants` alongside `inv_stock_moves`?

```mermaid
graph TD
    subgraph Naive Ledger Aggregation [Querying Stock via Ledger Aggregation]
        Q1["Client: GET /stock-on-hand"] --> DB1["PostgreSQL: SUM(credited) - SUM(debited)"]
        DB1 --> SCAN["Scan 1,000,000+ movement rows"]
        SCAN --> TIME["Latency: 4,000 - 8,000 ms | Throughput: < 5 req/s"]
    end

    subgraph Dual-Layer Quant Snapshot [Querying Stock via Quant Snapshots]
        Q2["Client: GET /stock-on-hand"] --> DB2["PostgreSQL: SELECT * FROM inv_stock_quants"]
        DB2 --> INDEX["Index Scan on Bounded Quant Rows (O(Products * Locations))"]
        INDEX --> FAST["Latency: 124 ms | Throughput: 400 req/s"]
    end
```

### Mathematical Scaling:
- **Ledger Aggregation**: Time complexity is $O(N)$ where $N$ is the total historical transaction volume. As a company operates over 5 years, $N$ grows from 100k to 50M rows, causing stock lookups to slow down and eventually crash the database.
- **Quant Snapshots**: Time complexity is $O(P \times L)$ where $P$ is active products and $L$ is storage locations. This set is bounded and independent of transaction velocity.
- **Empirical Measurement**: At 1,000,000 rows, reading from quants achieved **399.2 req/sec** at **124ms p50**, compared to **3.8 req/sec** for direct ledger filtering under concurrent connections.

---

## 4. Scaling Strategy for 10 Million and 50 Million Rows

Based on the empirical findings, the roadmap for scaling to 10M and 50M rows includes:

1. **PostgreSQL Table Partitioning**:
   - Partition `inv_stock_moves` by range on `done_date` (e.g. monthly or yearly partitions):
     ```sql
     CREATE TABLE inv_stock_moves_y2026m10 PARTITION OF inv_stock_moves
     FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
     ```
   - Partition pruning ensures recent queries only touch active monthly partitions.

2. **Targeted Composite Covering Indexes**:
   - Adding an index on `(reference_type, created_at DESC)` and `(source_location_id, destination_location_id)` avoids sequential scans during paginated ledger browsing.

3. **Asynchronous BullMQ Reconciliation**:
   - The benchmark demonstrated that running full-ledger reconciliation synchronously across 1M rows under 20 concurrent HTTP requests exhausts connection pools.
   - BullMQ isolates reconciliation into serialized background queue worker jobs, preventing HTTP request degradation.
