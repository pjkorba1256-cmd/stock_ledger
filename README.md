# Techvisk P03: Inventory II — Lots, Reservations, Transfers and Counts

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict_Mode_(No_Any)-blue.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11.0.14-red.svg)](https://nestjs.com/)
[![Angular](https://img.shields.io/badge/Angular-22.2.0-dd0031.svg)](https://angular.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16.3-336791.svg)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.36.0-C5F74F.svg)](https://orm.drizzle.team/)
[![BullMQ](https://img.shields.io/badge/BullMQ-Redis_Queue-orange.svg)](https://bullmq.io/)
[![Zod](https://img.shields.io/badge/Zod-Strict_Validation-3068b7.svg)](https://zod.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-Invariant_&_E2E-green.svg)](https://vitest.dev/)

An enterprise-grade, auditable double-entry inventory engine and stock ledger extending **P02 — The Stock Ledger** for **FreshMart** (a 25-store multi-category grocery retailer). Built for the **Techvisk Month 1 Internship Program (P03 — Inventory II)**.

---

## 1. Project Overview & Business Domain

FreshMart operates 25 grocery stores across India, selling milk, dairy, packaged foods, medicines, and household staples. 

In basic inventory systems (P01/P02), stock is tracked merely as a scalar number at a location. In multi-store grocery operations, knowing that *100 units exist* is insufficient:
- Which batch does each unit belong to?
- What are its manufacturing and expiration dates?
- Which stock is physically on hand vs. reserved for online quick-commerce delivery?
- Which stock can legally be sold (FEFO: First Expired, First Out)?
- Which units are travelling between locations in transit trucks?
- Why did a stock discrepancy occur and who approved the correction?

**The Core Principle:** Every stock change must have a valid business reason and an traceable, double-entry inventory movement. Arbitrary edits to stock numbers are strictly prohibited.

---

## 2. Core Business Invariants Enforced

1. **Available Stock Conservation:**
   $$\text{Available} = \text{On Hand} - \text{Reserved}$$
   Creating a reservation increments `reserved_quantity` atomically. Releasing or expiring decrements `reserved_quantity`. Stock cannot be reserved beyond available limits.
2. **Transit Custody Isolation:**
   When goods are dispatched between stores, stock moves from origin shelf into a `TRANSIT` location. Transit stock belongs to neither store's sellable stock and cannot be sold.
3. **Shortage Reconciliation Preservation:**
   When 30 units are dispatched and 28 arrive, the system never alters historical dispatch records. It records:
   $$\text{30 Dispatched} = \text{28 Received} + \text{2 Shortage (Carrier Loss)}$$
   balancing transit to exactly `0.000`.
4. **FEFO & Perishable Integrity:**
   The allocation engine automatically sorts eligible stock by earliest expiration date. Expired lots are strictly rejected from sales and reservations.
5. **Exactly-Once Release & Concurrency Safety:**
   Competing confirmations, cancellations, or worker expirations resolve deterministically with zero double releases and zero overselling under heavy load.
6. **Independent Two-Person Control for Scrap:**
   An employee who requests a scrap write-off is cryptographically prevented from approving their own request ($\text{approved\_by} \neq \text{requested\_by}$).

---

## 3. Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Frontend** | Angular | `22.2.0` | Standalone components, responsive store-grouped expiring stock dashboard |
| **Backend** | NestJS | `11.0.14` | Modular ERP backend architecture, strict DI, interceptors |
| **Type Safety** | TypeScript | `~5.7.0` | Strict mode enabled; **zero `any` across the entire codebase** |
| **ORM** | Drizzle ORM | `^0.36.0` | Type-safe SQL query builder, migrations, composite relational schemas |
| **Database** | PostgreSQL | `16.3` | Relational ACID database with row-level locks (`FOR UPDATE`) |
| **Background Jobs** | BullMQ & Redis | `^5.69.0` | Distributed reservation expiry workers and scheduled sweeps (with in-memory fallback) |
| **Validation** | Zod | `^3.24.2` | Runtime schema validation and TypeScript type inference |
| **Testing** | Vitest & Supertest | `^4.1.11` | Invariant tests, E2E concurrency suites, multi-tenant security audits |
| **Load Testing** | Autocannon | `^8.0.0` | High-throughput flash-sale simulation (2,000 attempts / 10s) |
| **Diagrams** | Mermaid | Markdown | System context, component, ER, and sequence diagrams committed as Markdown source |

---

## 4. Repository Structure

```text
d:\P02-Stock-Ledger\
├── api/                             # NestJS Backend API
│   ├── drizzle/                     # Drizzle SQL migration files
│   │   ├── 0000_init_stock_ledger.sql
│   │   └── 0001_p03_inventory_ii.sql
│   ├── src/
│   │   ├── database/schema.ts       # Database schema (11 tables with relational constraints)
│   │   ├── inventory/               # P03 Core Domain Modules (Services, Controllers, Schemas)
│   │   │   ├── inventory.service.ts # FEFO, reservations, transfers, scrap, counts
│   │   │   ├── inventory.controller.ts
│   │   │   ├── lot.schema.ts
│   │   │   ├── reservation.schema.ts
│   │   │   ├── transfer.schema.ts
│   │   │   ├── scrap.schema.ts
│   │   │   └── count.schema.ts
│   │   ├── jobs/                    # BullMQ Reservation Expiry Workers & Schedulers
│   │   └── main.ts
│   └── test/                        # Vitest E2E & Invariant Test Suites
│       ├── inventory-ledger.e2e-spec.ts (15 original P02 tests)
│       └── inventory-p03.e2e-spec.ts    (21 P03 Invariant & Concurrency tests)
├── web/                             # Angular 22 Frontend Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── app.ts               # Root component & multi-store state handlers
│   │   │   ├── app.html             # Responsive expiring stock dashboard & workflow views
│   │   │   ├── app.css              # Custom styling, status badges, modal overlays
│   │   │   ├── models/              # Strongly-typed TypeScript domain models
│   │   │   └── services/            # Inventory API client service
│   │   └── main.ts
├── load/                            # Performance & Load Testing
│   ├── scripts/
│   │   ├── benchmark-p03.cjs        # Flash-sale concurrency, abandoned carts & expiry sweep
│   │   └── benchmark-api.cjs        # Autocannon HTTP load testing
│   └── benchmark-p03-results.json   # Empirical benchmark output metrics
├── docs/                            # 9 Required Submission Deliverables
│   ├── 01-domain.md                 # Business primer, FreshMart context, glossary, 7 questions
│   ├── 02-data-dictionary.md        # Full schema dictionary, nullability, constraints, roles
│   ├── 03-benchmark.md              # Oracle NetSuite teardown, citations, comparative analysis
│   ├── 04-diagrams.md               # 13 Mermaid diagrams (Context, Component, ER, State, Sequence)
│   ├── 05-load-report.md            # Empirical load report (Flash-sale, abandoned carts, sweep)
│   ├── 06-cost-model.md             # Infrastructure OpEx in INR (S/M/L) & locked inventory cost
│   ├── 07-alternative.md            # 5 Architectural decision trade-off evaluations
│   └── 08-decisions.md              # Decision log, time log, AI usage log, deferred items
└── README.md                        # This setup guide
```

---

## 5. Local Setup & Quickstart (< 10 Minutes)

All commands are formatted for **Windows PowerShell**.

### Prerequisites
- Node.js `v20.x` or higher (verified on `v24.21.0`)
- PostgreSQL 16 (running locally on port 5432)
- Git

### Step 1: Clone Repository
```powershell
git clone <approved-techvisk-repo-url> P03-Stock-Ledger
cd P03-Stock-Ledger
```

### Step 2: Configure Local Database
Ensure local PostgreSQL is running and set `DATABASE_URL` in `api/.env`:
```env
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/stock_ledger
```
*(Optionally set `REDIS_ENABLED=true` and `REDIS_HOST=localhost` if BullMQ background job processing is desired).*

### Step 3: Install Backend Dependencies & Run Migrations
```powershell
cd api
npm install

# Apply P02 + P03 schema migrations to PostgreSQL
npx drizzle-kit migrate
```

### Step 4: Run Automated Invariant & E2E Tests
Verify that all 36 tests pass (15 P02 tests + 21 P03 invariant tests):
```powershell
# Run P03 Invariant Suite (All 21 pass)
npm run test:e2e -- test/inventory-p03.e2e-spec.ts

# Run original P02 Suite (All 15 pass)
npm run test:e2e -- test/inventory-ledger.e2e-spec.ts
```

### Step 5: Start Backend API Server
```powershell
npm run start:dev
```
The NestJS API server will boot on `http://localhost:3000`.

### Step 6: Install & Start Angular Frontend
In a new terminal:
```powershell
cd web
npm install
npm start
```
Navigate to `http://localhost:4200` to access the **FreshMart Expiring Stock Dashboard**. Click **"Seed FreshMart Demo Data"** to load sample multi-store stores and perishable batches.

---

## 6. Running Load & Concurrency Benchmarks

To execute the automated flash-sale benchmark (100 units, 2,000 attempts in 10s), abandoned reservations comparison, and expiry sweep:

```powershell
# Ensure API server is running on http://localhost:3000
node load/scripts/benchmark-p03.cjs
```

### Empirical Benchmark Output:
```text
=============================================================
1. FLASH-SALE RESERVATION BENCHMARK (CONCURRENCY & SAFETY)
=============================================================
Scenario: 100 units available of a flash-sale item.
Attempting 2,000 concurrent reservations within 10 seconds...

--- FLASH-SALE BENCHMARK RESULTS ---
Total Attempts:       2000
Duration:             4.29s
Throughput:           465.8 req/sec
Successful (201):     100 (Expected: 100)
Rejected (400):       1900 (Expected: 1900)
Server Errors (500):  0 (Expected: 0)
Deadlocks Detected:   0 (Expected: 0)
Quant Reserved Qty:   100 units
Quant Available Qty:  0 units
Overselling Drift:    0 units
Latency p50:          94.04 ms
Latency p95:          188.85 ms
Latency p99:          350.89 ms
```

---

## 7. Submission Documentation Index (`docs/`)

All required written deliverables are available in `docs/`:

1. [`docs/01-domain.md`](docs/01-domain.md): Business primer, FreshMart context, 20 domain terms, and answers to the 7 core retail questions.
2. [`docs/02-data-dictionary.md`](docs/02-data-dictionary.md): Exhaustive data dictionary for all 11 tables and columns with business roles and audit verdicts.
3. [`docs/03-benchmark.md`](docs/03-benchmark.md): Oracle NetSuite Advanced Inventory teardown, 5 missing features, 3 design anti-patterns, and official citations.
4. [`docs/04-diagrams.md`](docs/04-diagrams.md): 13 Mermaid diagrams (Context, Component, ER, Transfer state machine, Reservation state machine, Sequence flows, 7-day 4-line graph).
5. [`docs/05-load-report.md`](docs/05-load-report.md): Empirical load report detailing flash-sale concurrency, abandoned cart economics, expiry sweep query plans, and optimizations.
6. [`docs/06-cost-model.md`](docs/06-cost-model.md): Monthly cloud infrastructure cost model in INR (S/M/L tiers) and economic cost of locked inventory.
7. [`docs/07-alternative.md`](docs/07-alternative.md): Trade-off analysis of 5 core architectural decisions.
8. [`docs/08-decisions.md`](docs/08-decisions.md): Architecture Decision Records (ADR-01 to ADR-10), engineering time log, AI usage log, and deferred features.
