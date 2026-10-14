# Techvisk P02: Inventory I — The Stock Ledger

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict_Mode-blue.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-12.0.1-red.svg)](https://nestjs.com/)
[![Angular](https://img.shields.io/badge/Angular-22.2.0-dd0031.svg)](https://angular.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.6-336791.svg)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45.4-C5F74F.svg)](https://orm.drizzle.team/)
[![Zod](https://img.shields.io/badge/Zod-Strict_Validation-3068b7.svg)](https://zod.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-Unit_&_E2E-green.svg)](https://vitest.dev/)
[![Autocannon](https://img.shields.io/badge/Autocannon-1M_Benchmark-orange.svg)](https://github.com/mcollina/autocannon)

An enterprise-grade, auditable double-entry inventory engine and stock ledger inspired by **Odoo Inventory**. Built for the **Techvisk Month 1 Internship Program (P02 — Inventory I: The Stock Ledger)**.

---

## Live Deployments

- **Frontend Dashboard (Vercel)**: [https://stock-ledger-6ye1.vercel.app](https://stock-ledger-6ye1.vercel.app)
- **Backend API (Render)**: [https://stock-ledger-api.onrender.com](https://stock-ledger-api.onrender.com)
- **API Health Check**: [https://stock-ledger-api.onrender.com/health/db](https://stock-ledger-api.onrender.com/health/db)
- **Database**: Neon Serverless PostgreSQL (`ep-blue-dust-aomr6rgt-pooler.c-2.ap-southeast-1.aws.neon.tech`)

---

## Table of Contents

1. [Project Title & Summary](#1-project-title--summary)
2. [Business Problem & Motivation](#2-business-problem--motivation)
3. [Project Objectives](#3-project-objectives)
4. [Main Features & Supported Workflows](#4-main-features--supported-workflows)
5. [Technology Stack](#5-technology-stack)
6. [High-Level Architecture](#6-high-level-architecture)
7. [Repository Directory Structure](#7-repository-directory-structure)
8. [Prerequisites & Software Versions](#8-prerequisites--software-versions)
9. [Local Installation & Quickstart (< 10 Minutes)](#9-local-installation--quickstart--10-minutes)
10. [Environment Variable Configuration](#10-environment-variable-configuration)
11. [Database Setup & Migrations](#11-database-setup--migrations)
12. [Startup Commands](#12-startup-commands)
13. [API Endpoints & Example Responses](#13-api-endpoints--example-responses)
14. [Validation & Error Handling Approach](#14-validation--error-handling-approach)
15. [Database Constraints & Consistency Invariants](#15-database-constraints--consistency-invariants)
16. [Running Automated Tests](#16-running-automated-tests)
17. [Seeding Test Data & Load Testing](#17-seeding-test-data--load-testing)
18. [Deployment Architecture](#18-deployment-architecture)
19. [Documentation Index (`docs/`)](#19-documentation-index-docs)
20. [Known Limitations & Troubleshooting](#20-known-limitations--troubleshooting)

---

## 1. Project Title & Summary

**Project:** Techvisk P02: Inventory I — The Stock Ledger  
**Core Purpose:** High-performance, auditable stock ledger system for Cora ERP based on the double-entry vector movement model. Eliminates mutable inventory counters by enforcing that every physical inventory change is backed by an immutable ledger transaction.

---

## 2. Business Problem & Motivation

In traditional retail databases, stock is represented as a single mutable scalar column: `product.stock_quantity = 31`. When physical counts diverge (e.g. shelf has 27 units, computer says 31), operators cannot identify **when** the variance occurred, **which** transaction caused it, or **who** authorized the deduction.

The Stock Ledger eliminates mutable counters. Every change is an immutable vector transfer:
$$(SourceLocation \xrightarrow{Quantity} DestinationLocation)$$
Stock snapshots (`inv_stock_quants`) are continuously reconciled against the auditable movement ledger (`inv_stock_moves`), guaranteeing zero untracked shrinkage, zero negative stock, and 100% mathematical auditability.

---

## 3. Project Objectives

1. Implement an auditable, immutable double-entry movement ledger.
2. Deliver sub-millisecond stock-on-hand lookups via a real-time snapshot cache (`inv_stock_quants`).
3. Enforce **Zero Negative Stock** at both application and database engine levels.
4. Prevent overselling under high concurrency via PostgreSQL pessimistic row locking (`FOR UPDATE`).
5. Guarantee mathematical consistency via automated ledger-to-quant reconciliation.
6. Provide a modern, responsive Angular 22 SPA dashboard for warehouse operators.

---

## 4. Main Features & Supported Workflows

- **Goods Receipt (GRN)**: Inward inventory from virtual `SUPPLIER` locations to physical `INTERNAL` warehouse bins.
- **Internal Transfers**: Relocate goods between aisles, shelves, and packing docks with conservation of mass ($\Delta Q_{src} + \Delta Q_{dest} = 0$).
- **Customer Deliveries (`SALE`)**: Dispatch stock from `INTERNAL` bins to virtual `CUSTOMER` counterparties.
- **Operational Stock Reservations**: Soft-allocate units for pending orders with live Available calculation:
  $$\text{Available} = \text{On-Hand} - \text{Reserved} \ge 0$$
- **Cycle Count Adjustments & Scrap**: Record damaged goods to `SCRAP` or inventory variances to `LOSS`.
- **Nightly Reconciliation Audit**: Compare snapshot quants against historical movement sums with 0-drift verification.

---

## 5. Technology Stack

- **Frontend**: Angular 22.2.0 (Standalone Components, Zoneless Change Detection, Strict TypeScript).
- **Backend**: NestJS 12.0.1 (Strict mode enabled, `noImplicitAny`, zero `any`).
- **ORM & Migrations**: Drizzle ORM 0.45.4, Drizzle Kit migrations.
- **Database**: PostgreSQL 18.6 (Hosted on Neon Serverless / Localhost).
- **Request Validation**: Zod 4.x (`z.infer<T>`) for every body, query, and route parameter.
- **Background Processing**: BullMQ with Redis for asynchronous ledger reconciliation.
- **Testing**: Vitest 4.1.2, Supertest for E2E concurrency suites.
- **Load Testing**: Autocannon 8.0.0 for 1,000,000+ movement benchmarks.
- **Diagrams**: Mermaid.

---

## 6. High-Level Architecture

```mermaid
flowchart LR
    SPA["Angular 22 SPA\n(Vercel)"] -->|REST API / JSON| API["NestJS Backend\n(Render / Port 3000)"]
    API -->|Zod Validation| PIPES["ZodValidationPipe"]
    PIPES --> SVC["InventoryService\n(ACID Domain Logic)"]
    SVC -->|Drizzle ORM| DB[("PostgreSQL 18\n(Neon Serverless)")]
    API -->|BullMQ Queue| REDIS[("Redis 7.x")]
    REDIS --> WORKER["ReconciliationWorker"]
    WORKER --> SVC
```

---

## 7. Repository Directory Structure

```text
P02-Stock-Ledger/
├── README.md                          # Master project documentation (this file)
├── render.yaml                        # Render Cloud deployment blueprint
├── docs/                              # Formal engineering reports
│   ├── 01-domain.md                   # Retail domain brief & 20-term glossary
│   ├── 02-data-dictionary.md          # Complete data dictionary for all 4 tables
│   ├── 03-benchmark.md                # Odoo Inventory benchmark analysis
│   ├── 04-diagrams.md                 # 7 Mermaid architecture & sequence diagrams
│   ├── 05-load-report.md              # 1M row load report (Underload, Peak, Overload)
│   ├── 06-cost-model.md               # Infrastructure cost analysis in INR (S, M, L)
│   ├── 07-alternative.md              # CQRS / Event-Sourcing alternative trade-offs
│   └── 08-decisions.md                # 8 ADRs, AI collaboration log, "What is not done"
├── api/                               # NestJS Backend Application
│   ├── src/
│   │   ├── database/                  # Drizzle schema (4 tables) & connection pool
│   │   ├── inventory/                 # Controllers, services, Zod schemas, pipes
│   │   ├── jobs/                      # BullMQ background reconciliation workers
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── drizzle/                       # Drizzle Kit SQL migrations
│   ├── test/                          # Vitest E2E & 200-concurrent-sale test suites
│   ├── drizzle.config.ts
│   ├── package.json
│   ├── .env.example                   # Backend environment template
│   └── .env                           # Local environment config (git-ignored)
├── web/                               # Angular 22 Frontend Application
│   ├── src/
│   │   ├── app/                       # Components, templates, models, services
│   │   ├── environments/              # Local & production API URLs
│   │   └── main.ts
│   ├── package.json
│   └── .env.example                   # Frontend environment template
└── load/                              # Performance & Scale Benchmarking
    ├── scripts/
    │   └── benchmark-api.cjs          # Autocannon 4-endpoint benchmark harness
    ├── seed/
    │   └── seed-benchmark-data.cjs    # PostgreSQL 1M generate_series bulk seeder
    ├── benchmark-results.json         # Raw benchmark results
    └── README.md                      # Load testing instructions
```

---

## 8. Prerequisites & Software Versions

- **Node.js**: `v24.21.0` or higher
- **npm**: `v11.19.0` or higher
- **PostgreSQL**: `v18.6` (Local or Neon Serverless connection)
- **Redis**: `v7.x` (Optional: required only for background BullMQ jobs; disabled by default via `REDIS_ENABLED=false`)

---

## 9. Local Installation & Quickstart (< 10 Minutes)

Follow these steps to run the complete stack locally in under 10 minutes:

```powershell
# 1. Clone repository
git clone https://github.com/pjkorba1256-cmd/stock_ledger.git
cd stock_ledger

# 2. Install backend dependencies
cd api
npm install

# 3. Configure environment
copy .env.example .env
# Edit api/.env with your PostgreSQL DATABASE_URL

# 4. Run database migrations
npx drizzle-kit migrate

# 5. Start NestJS Backend
npm run start:dev
# Backend boots at http://localhost:3000

# 6. In a new terminal, install frontend and start
cd ../web
npm install
npm start
# Frontend boots at http://localhost:4200
```

---

## 10. Environment Variable Configuration

### Backend (`api/.env`)
```env
# PostgreSQL Database Connection URL (Replace with your credentials)
DATABASE_URL=postgresql://user:password@localhost:5432/p02_stock_ledger

# HTTP Server Port
PORT=3000

# Redis Connection (BullMQ background reconciliation)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_ENABLED=false
```

### Frontend (`web/.env.example`)
```env
# API Endpoint URL
API_URL=http://localhost:3000/inventory
```

---

## 11. Database Setup & Migrations

If running locally:
```sql
CREATE DATABASE p02_stock_ledger;
```

Run Drizzle Kit migrations:
```powershell
cd api
npm run db:migrate
```

To seed initial sample warehouses, locations, and products:
```powershell
curl -X POST http://localhost:3000/inventory/seed
```

---

## 12. Startup Commands

| Service | Development Mode | Production Build |
| :--- | :--- | :--- |
| **Backend API (`api/`)** | `npm run start:dev` | `npm run build` then `node dist/main.js` |
| **Frontend SPA (`web/`)** | `npm start` | `npm run build` (outputs to `dist/web`) |
| **Database Studio** | `npm run studio` | Interactive visual Drizzle Studio at `https://local.drizzle.team` |

---

## 13. API Endpoints & Example Responses

All endpoints are prefixed with `/inventory`.

### 1. `GET /inventory/stock-on-hand`
Fetches paginated physical stock balances from `inv_stock_quants`.
- **Query Params**: `page` (default 1), `limit` (default 20), `productId` (optional), `locationId` (optional).
- **Response `200 OK`**:
```json
{
  "data": [
    {
      "id": "9c0a48f5-4ba4-4579-b87b-0e86bba4ee13",
      "productId": "22222222-2222-4222-8222-222222222222",
      "locationId": "5571a122-f657-452c-ae2f-7387005512a4",
      "quantity": "100.000",
      "reservedQuantity": "20.000",
      "costPricePaise": null,
      "updatedAt": "2026-10-14T10:10:38.857Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 8, "totalPages": 1 }
}
```

### 2. `PATCH /inventory/quants/:id/reserve`
Soft-reserves stock for an order.
- **Body**: `{ "reservedQuantity": 20 }`
- **Response `200 OK`**: Returns updated quant object with new `reservedQuantity`.

### 3. `POST /inventory/stock-moves`
Creates a new draft movement.
- **Body**:
```json
{
  "referenceType": "TRANSFER",
  "productId": "11111111-1111-4111-8111-111111111111",
  "sourceLocationId": "7172f4fd-8c7c-4115-adff-9fd36ff84ecd",
  "destinationLocationId": "5571a122-f657-452c-ae2f-7387005512a4",
  "quantity": 5,
  "performedBy": "operator-1",
  "notes": "Internal transfer to picking rack"
}
```
- **Response `201 Created`**: Returns move record in `DRAFT` state.

### 4. `POST /inventory/stock-moves/:id/post`
Atomically executes and commits a confirmed movement in an ACID database transaction.
- **Response `201 Created`**: Returns move record with `state: "DONE"`.

### 5. `GET /inventory/reconcile`
Audits mathematical parity between historical movements and quants.
- **Response `200 OK`**:
```json
{
  "status": "RECONCILED",
  "discrepanciesCount": 0,
  "totalLocationsAudited": 4,
  "auditDetails": [
    {
      "productId": "11111111-1111-4111-8111-111111111111",
      "locationId": "7172f4fd-8c7c-4115-adff-9fd36ff84ecd",
      "quantQuantity": "161.000",
      "calculatedLedgerQuantity": "161.000",
      "discrepancy": "0.000",
      "isReconciled": true
    }
  ]
}
```

---

## 14. Validation & Error-Handling Approach

- **Strict Request Validation**: Every endpoint routes inputs through [`ZodValidationPipe`](file:///d:/P02-Stock-Ledger/api/src/inventory/zod-validation.pipe.ts). Malformed types, non-UUID strings, or negative quantities are rejected immediately with `400 Bad Request` before invoking business logic.
- **Consistent Error Structure**:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [{ "field": "quantity", "message": "Number must be greater than 0" }]
}
```
- **Zero `any` Policy**: TypeScript strict mode (`noImplicitAny`, strict null checks) is enforced across the entire repository.

---

## 15. Database Constraints & Consistency Invariants

The database strictly enforces six physical invariants:

1. **Non-Negative Physical Stock**: `CHECK (quantity >= 0)` on `inv_stock_quants`.
2. **Reservation Limit**: `CHECK (reserved_quantity <= quantity)` and `CHECK (reserved_quantity >= 0)`.
3. **Strict Inward/Outward Direction**: `CHECK (source_location_id <> destination_location_id)` on `inv_stock_moves`.
4. **Strictly Positive Transfer Quantity**: `CHECK (quantity > 0)`.
5. **No Self-Parenting Locations**: `CHECK (id <> parent_location_id)` on `inv_locations`.
6. **Unique Quant Partition**: `UNIQUE NULLS NOT DISTINCT (product_id, variant_id, location_id, lot_id)`.

---

## 16. Running Automated Tests

```powershell
cd api

# 1. Run unit tests
npm run test

# 2. Run E2E and 200-concurrent-sale contention suite
npm run test:e2e
```

**Test Coverage Highlights**:
- Identical source/destination rejection (`400`).
- Non-positive quantity rejection (`400`).
- Movement state transitions (`DRAFT` $\rightarrow$ `CONFIRMED` $\rightarrow$ `DONE`).
- Overdraft rejection when stock is insufficient (`400`).
- Idempotency check when re-posting completed movements.
- Concurrency contention test: **200 simultaneous sales against 1 SKU verified with 0 deadlocks and exact mass conservation**.

---

## 17. Seeding Test Data & Load Testing

```powershell
# 1. Seed 1,000,000 movements via high-speed PostgreSQL generate_series
node load/seed/seed-benchmark-data.cjs 1000000

# 2. Execute Autocannon benchmark across 4 endpoints
node load/scripts/benchmark-api.cjs
```

Detailed results and percentile latency distributions are published in [`docs/05-load-report.md`](docs/05-load-report.md).

---

## 18. Deployment Architecture

```mermaid
flowchart TD
    GITHUB["GitHub Repository (main branch)"] -->|Auto Deploy| VERCEL["Vercel SPA Hosting\n(Angular 22)"]
    GITHUB -->|Auto Deploy| RENDER["Render Web Service\n(NestJS API)"]
    RENDER -->|TLS 1.3 Pool| NEON[("Neon Serverless PostgreSQL\n(AWS ap-southeast-1)")]
```

- **Frontend**: Hosted on Vercel Edge Network with HTML5 push-state routing (`vercel.json`).
- **Backend API**: Hosted on Render as a containerized Node.js service running `npm run start:prod`.
- **Database**: Serverless PostgreSQL 18.6 on Neon with connection pooling.

---

## 19. Documentation Index (`docs/`)

| Document | Purpose & Key Content |
| :--- | :--- |
| **[`docs/01-domain.md`](docs/01-domain.md)** | Retail domain brief, rice-bag example, 20-term glossary, and verbal interview Q&A. |
| **[`docs/02-data-dictionary.md`](docs/02-data-dictionary.md)** | Complete dictionary for all 4 tables with verdicts (`core`, `derived`, etc.) and design rationale. |
| **[`docs/03-benchmark.md`](docs/03-benchmark.md)** | Odoo Inventory benchmark analysis, 5 advanced capabilities, 3 anti-patterns, and comparison matrix. |
| **[`docs/04-diagrams.md`](docs/04-diagrams.md)** | 7 Mermaid diagrams: Context, Component, ERD, Success & Failure Sequences, State Machine, and Process Flow. |
| **[`docs/05-load-report.md`](docs/05-load-report.md)** | 1M row load report covering Underload, Peak-Hour, Overload breaking point, and index optimizations. |
| **[`docs/06-cost-model.md`](docs/06-cost-model.md)** | AWS Mumbai monthly cost models in INR for S (₹2,839), M (₹22,462), and L (₹1,72,428) tiers. |
| **[`docs/07-alternative.md`](docs/07-alternative.md)** | Trade-off analysis of Event-Sourced CQRS vs. Dual-Layer model and zero-downtime migration strategy. |
| **[`docs/08-decisions.md`](docs/08-decisions.md)** | 8 ADRs, build timings, AI collaboration log, and exact section titled `What is not done`. |

---

## 20. Known Limitations & Troubleshooting

1. **Cold Starts on Render Free Tier**:
   - Render's free tier spins down backend web services after 15 minutes of inactivity. The first HTTP request after idle takes ~30–50 seconds to boot the container. Subsequent requests execute in $< 50\text{ ms}$.
2. **Local Port In Use**:
   - If port 3000 is occupied: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force` on Windows PowerShell.
3. **Redis Connection in Development**:
   - If Redis is not installed locally, keep `REDIS_ENABLED=false` in `api/.env`. The backend automatically skips BullMQ initialization while keeping core inventory ledger operations fully functional.
