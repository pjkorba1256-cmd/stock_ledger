# Techvisk P02: Inventory I — The Stock Ledger

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-12.0.1-red.svg)](https://nestjs.com/)
[![Angular](https://img.shields.io/badge/Angular-22.2.0-dd0031.svg)](https://angular.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.6-336791.svg)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45.4-C5F74F.svg)](https://orm.drizzle.team/)
[![Zod](https://img.shields.io/badge/Zod-Strict_Validation-3068b7.svg)](https://zod.dev/)
[![Tests](https://img.shields.io/badge/Vitest-20_Passed-green.svg)](https://vitest.dev/)

An enterprise-grade, auditable double-entry inventory management and stock ledger system inspired by Odoo Inventory. Built for the **Techvisk Backend & Full-Stack Internship Program**.

---

## 1. Project Background & Business Problem

In traditional inventory architectures, a product's current stock is represented as a single mutable integer column. When stock counters drift from physical inventory (e.g. 40 units starting balance, database shows 31, physical shelf shows 27), operators cannot identify **when** the variance occurred, **which** transaction caused it, or **who** performed the change.

**The Stock Ledger** eliminates mutable counters. Every inventory change is modeled as an immutable vector transfer $(source \rightarrow destination, quantity)$. Stock snapshots (`inv_stock_quants`) are continuously reconciled against the auditable movement ledger (`inv_stock_moves`).

### Key Invariants
- **Double-Entry Transfers**: Every move has distinct source and destination locations.
- **State Machine**: Only completed (`DONE`) movements alter inventory quants.
- **Strict Immutability**: `DONE` movements cannot be altered, cancelled, or re-posted.
- **Zero Negative Stock**: Physical (`INTERNAL`) locations reject negative balances at both application and database engine levels (`CHECK (quantity >= 0)`).
- **Atomic Transactions**: Both source deduction and destination credit commit or roll back together.
- **Idempotency**: Retried posting requests return existing completed records without double-deduction.
- **Concurrency Safety**: Pessimistic row locking (`FOR UPDATE`) cleanly serializes simultaneous requests under high contention (verified under 200 concurrent sales).

---

## 2. Technology Stack

- **Backend**: NestJS v12.0.1, TypeScript with strict mode enabled (`noImplicitAny`, zero `any`).
- **Database & ORM**: PostgreSQL 18.6, Drizzle ORM, Drizzle Kit migrations.
- **Validation**: Zod for all request bodies, query parameters, and route parameters (`z.infer<T>`).
- **Frontend**: Angular 22.2.0 SPA with standalone components, clean Odoo-inspired UI.
- **Background Jobs**: BullMQ with Redis for asynchronous ledger reconciliation and failure alerting.
- **Testing**: Vitest for unit tests, Supertest + Vitest for e2e and concurrency test suites.
- **Benchmarking**: Autocannon for load testing under 1,000,000+ movement rows.

---

## 3. Repository Structure

```
d:\P02-Stock-Ledger
├── api/                           # NestJS Backend Application
│   ├── drizzle/                   # Drizzle Kit SQL migrations
│   │   └── 0000_jittery_the_fury.sql
│   ├── src/
│   │   ├── database/              # Drizzle PostgreSQL schema & module
│   │   │   ├── schema.ts          # Core 4 tables: warehouses, locations, moves, quants
│   │   │   └── database.module.ts
│   │   ├── inventory/             # Stock ledger controllers, services, Zod schemas
│   │   │   ├── inventory.controller.ts
│   │   │   ├── inventory.service.ts
│   │   │   ├── stock-move.schema.ts
│   │   │   ├── location.schema.ts
│   │   │   ├── warehouse.schema.ts
│   │   │   ├── inventory-query.schema.ts
│   │   │   └── zod-validation.pipe.ts
│   │   ├── jobs/                  # BullMQ background workers and queues
│   │   │   ├── jobs.module.ts     # Dynamic module with conditional Redis loading
│   │   │   ├── jobs.service.ts    # Queue producer
│   │   │   ├── jobs.controller.ts
│   │   │   └── reconciliation.processor.ts # WorkerHost processor
│   │   ├── app.module.ts
│   │   └── main.ts                # App boot with CORS enabled
│   └── test/                      # Vitest test suites
│       ├── app.e2e-spec.ts
│       └── inventory-ledger.e2e-spec.ts # Full Stage G concurrency & lifecycle suite
├── web/                           # Angular 22 Frontend Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── models/            # TypeScript domain models
│   │   │   ├── services/          # InventoryApiService HTTP client
│   │   │   ├── app.ts             # Main dashboard controller
│   │   │   ├── app.html           # 4-tab dashboard UI
│   │   │   └── app.css            # Enterprise styling
├── load/                          # Performance & Load Testing
│   ├── seed-benchmark-data.cjs    # PostgreSQL generate_series bulk seeder
│   ├── benchmark-api.cjs          # Autocannon benchmark runner
│   └── benchmark-results.json     # Measured empirical benchmark output
├── docs/                          # Comprehensive Technical Documentation
│   ├── 01-domain.md               # Domain rules & Odoo double-entry model
│   ├── 02-data-dictionary.md      # Complete database dictionary for 4 tables
│   ├── 03-benchmark.md            # 1M rows empirical benchmark report
│   ├── 04-diagrams.md             # Mermaid diagrams (Architecture, ERD, Sequences)
│   ├── 05-load-report.md          # Load testing report & latency percentiles
│   ├── 06-cost-model.md           # Cloud infrastructure cost models (Small, Med, Large)
│   ├── 07-alternative.md          # Trade-off analysis & architectural alternatives
│   └── 08-decisions.md            # 8 Architecture Decision Records (ADRs)
└── README.md                      # Project master documentation
```

---

## 4. Local Setup & Installation

### Prerequisites
- Windows 10/11
- Node.js `v24.21.0` or higher
- npm `11.19.0` or higher
- PostgreSQL `18.6` running locally with database `p02_stock_ledger`

### 1. Database Setup
Ensure PostgreSQL has the target database:
```sql
CREATE DATABASE p02_stock_ledger;
```

In `api/.env`:
```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/p02_stock_ledger
PORT=3000
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_ENABLED=false
```

Generate and run migrations:
```powershell
cd D:\P02-Stock-Ledger\api
npx drizzle-kit migrate
```

### 2. Start the Backend API
```powershell
cd D:\P02-Stock-Ledger\api
npm install
npm run start:dev
```
Server boots at `http://localhost:3000`. Test database health:
```powershell
curl http://localhost:3000/health/db
# Returns: {"status":"ok","database":"connected"}
```

### 3. Start the Angular Dashboard
```powershell
cd D:\P02-Stock-Ledger\web
npm install
npm start
```
Navigate to `http://localhost:4200` to interact with the inventory dashboard.

---

## 5. Automated Tests Execution

Run the complete test suites from `api/`:

```powershell
cd D:\P02-Stock-Ledger\api

# 1. Run Unit Tests
npm test

# 2. Run Integration, Lifecycle, & 200 Concurrent Sales Suite
npm run test:e2e
```

**Test Verification Summary**:
- `test/app.e2e-spec.ts`: 1 passed
- `test/inventory-ledger.e2e-spec.ts`: 15 passed (including 200 simultaneous sales against 1 SKU in 1.7s)
- Total: **16 e2e tests + 4 unit tests = 20 tests passing (100% success)**.

---

## 6. Benchmarking & Load Testing (1 Million Rows)

To reproduce the 1 Million row benchmark:

```powershell
cd D:\P02-Stock-Ledger

# 1. Seed 1,000,000 rows into PostgreSQL (using fast generate_series)
node load/seed-benchmark-data.cjs 1000000

# 2. Run Autocannon Load Benchmark Suite
node load/benchmark-api.cjs
```

### Measured Performance Summary (Autocannon on 1,000,638 Rows)
- **Stock-on-Hand Lookups (Quants Snapshot)**: **399.2 req/sec**, $p50 = 124\text{ ms}$, $p90 = 143\text{ ms}$, **0 errors**.
- **Audit Ledger History (Filtered 1M Rows)**: $p50 = 5,822\text{ ms}$ (demonstrates why bounded quants are essential for production scale).
- **200 Concurrent Sales Under Contention**: Completed in **1,776 ms** with zero overdrafts and exact mass conservation ($250 - 200 = 50.000$).

---

## 7. Documentation Index

Comprehensive project documentation is available in `docs/`:

1. [**01-domain.md**](file:///d:/P02-Stock-Ledger/docs/01-domain.md): Domain rules, invariant definitions, and Odoo double-entry transfer model.
2. [**02-data-dictionary.md**](file:///d:/P02-Stock-Ledger/docs/02-data-dictionary.md): Complete data dictionary, constraints, and indexes across all 4 tables.
3. [**03-benchmark.md**](file:///d:/P02-Stock-Ledger/docs/03-benchmark.md): Empirical benchmark report across 1,000,000 rows with latency percentiles.
4. [**04-diagrams.md**](file:///d:/P02-Stock-Ledger/docs/04-diagrams.md): Mermaid architecture diagrams, ERDs, sequence diagrams, and transaction flows.
5. [**05-load-report.md**](file:///d:/P02-Stock-Ledger/docs/05-load-report.md): In-depth load test analysis, bottleneck profiling, and concurrency contention.
6. [**06-cost-model.md**](file:///d:/P02-Stock-Ledger/docs/06-cost-model.md): Infrastructure cost models for Small, Medium, and Large cloud deployments.
7. [**07-alternative.md**](file:///d:/P02-Stock-Ledger/docs/07-alternative.md): Architectural alternatives, trade-offs (Event Sourcing vs Quants), and failure modes.
8. [**08-decisions.md**](file:///d:/P02-Stock-Ledger/docs/08-decisions.md): Eight Architecture Decision Records (ADRs) explaining technical choices.

---

## 8. License & Internship Attribution
Developed as part of the **Techvisk Internship Program — Track P02: Inventory I: The Stock Ledger**.
All architectural principles, schemas, and test proofs conform strictly to the Techvisk engineering handbook.
