# Load Testing & Performance Benchmarking — P02 Stock Ledger

This directory contains automated reproducible scripts for database scale seeding and API load testing using `autocannon`.

---

## 1. Directory Structure

```text
load/
├── scripts/
│   └── benchmark-api.cjs       # Autocannon load testing harness for 4 key endpoints
├── seed/
│   └── seed-benchmark-data.cjs # High-throughput PostgreSQL generate_series bulk seeder
├── benchmark-results.json      # Output metric report from empirical load testing
└── README.md                   # This instruction guide
```

---

## 2. Prerequisites

- Node.js `v24.21.0` or higher
- Running PostgreSQL database configured in `api/.env` (`DATABASE_URL`)
- Dependencies installed in `api/`:
  ```powershell
  cd api
  npm install
  ```

---

## 3. High-Throughput Database Seeding

To test query performance on large historical ledger tables, use `seed-benchmark-data.cjs`. It uses PostgreSQL's native `generate_series()` function to generate random double-entry stock movements directly inside the database engine without NodeJS HTTP overhead.

### Seeding Commands

```powershell
# Default: Seed 100,000 movements
node load/seed/seed-benchmark-data.cjs 100000

# Full Stage G / Large Workload: Seed 1,000,000 movements
node load/seed/seed-benchmark-data.cjs 1000000
```

Seeding throughput typically exceeds **20,000 to 50,000 rows per second**.

---

## 4. Running Autocannon API Benchmarks

The benchmark script tests 4 critical production access patterns:

1. **`GET /inventory/stock-on-hand`**: Validates sub-millisecond stock lookup using `inv_stock_quants` snapshot cache (50 concurrent connections).
2. **`GET /inventory/stock-moves`**: Tests filtered, paginated queries on historical movement ledger with indexes (50 concurrent connections).
3. **`GET /inventory/reconcile`**: Evaluates audit reconciliation engine performance across source and destination aggregates (20 concurrent connections).
4. **`POST /inventory/stock-moves`**: Measures write throughput for draft movement creation (20 concurrent connections).

### Execution Command

Ensure the NestJS API server is running on `http://localhost:3000` (or set `API_BASE_URL`):

```powershell
# Start NestJS backend in one terminal
cd api
npm run start:dev

# Run benchmark in another terminal
node load/scripts/benchmark-api.cjs
```

To target a remote deployment (e.g. Render):
```powershell
$env:API_BASE_URL="https://stock-ledger-api.onrender.com"
node load/scripts/benchmark-api.cjs
```

---

## 5. Workload Scenarios (Techvisk Month 1 Requirement)

| Workload Scenario | Target Requests | Concurrent Connections | Target Latency (p95) | Max Allowed Error Rate |
| :--- | :--- | :--- | :--- | :--- |
| **Scenario 1: Underload** | 50 req/sec | 10 VUs | $< 50\text{ ms}$ | $0.0\%$ |
| **Scenario 2: Peak Hour** | 300 - 450 req/sec | 50 VUs | $< 250\text{ ms}$ | $< 0.1\%$ |
| **Scenario 3: Overload / Stress** | 800+ req/sec | 100+ VUs | Push until p95 $> 1\text{s}$ or errors $> 1\%$ | Identifies system breaking point |

---

## 6. Output & Results

Benchmark runs write full percentile latency distributions (p50, p90, p99, average), request counts, and error tallies to `load/benchmark-results.json`.

Detailed architectural analysis and bottleneck investigations are published in [`docs/05-load-report.md`](../docs/05-load-report.md).
