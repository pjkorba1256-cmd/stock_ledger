# System Architecture & Technical Diagrams

## 1. High-Level System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer"]
        SPA["Angular 22 SPA Dashboard (Port 4200)"]
        CLI["API Clients / Thunder Client / Load Drivers"]
    end

    subgraph BackendLayer ["NestJS Backend Services (Port 3000)"]
        GATEWAY["Express HTTP Gateway with Zod Validation Pipes"]
        INV_CTRL["InventoryController"]
        JOBS_CTRL["JobsController"]
        INV_SRV["InventoryService (Core Domain Engine)"]
        JOBS_SRV["JobsService (BullMQ Producer)"]
        WORKER["ReconciliationProcessor (BullMQ Worker)"]
    end

    subgraph DataStorageLayer ["Data Storage & Queues"]
        POSTGRES[("PostgreSQL 18 Database: p02_stock_ledger")]
        REDIS[("Redis 7.x Queue Store: Port 6379")]
    end

    SPA -->|HTTP / JSON| GATEWAY
    CLI -->|HTTP / JSON| GATEWAY
    GATEWAY --> INV_CTRL
    GATEWAY --> JOBS_CTRL

    INV_CTRL --> INV_SRV
    JOBS_CTRL --> JOBS_SRV

    INV_SRV -->|Drizzle ORM Connection Pool| POSTGRES
    JOBS_SRV -->|Enqueue Jobs| REDIS
    REDIS -->|Dequeue Jobs| WORKER
    WORKER -->|Execute Reconciliation Audit| INV_SRV
```

---

## 2. Entity-Relationship Diagram (ERD)

```mermaid
erDiagram
    INV_WAREHOUSES ||--o{ INV_LOCATIONS : "contains (1:N)"
    INV_LOCATIONS ||--o{ INV_LOCATIONS : "parent_zone (1:N)"
    INV_LOCATIONS ||--o{ INV_STOCK_MOVES : "source_location (1:N)"
    INV_LOCATIONS ||--o{ INV_STOCK_MOVES : "destination_location (1:N)"
    INV_LOCATIONS ||--o{ INV_STOCK_QUANTS : "holds_stock (1:N)"

    INV_WAREHOUSES {
        uuid id PK
        uuid merchant_id
        varchar code UK
        varchar name
        jsonb address
        boolean is_active
        boolean is_default
        timestamptz created_at
        timestamptz updated_at
    }

    INV_LOCATIONS {
        uuid id PK
        uuid warehouse_id FK
        uuid parent_location_id FK
        varchar code
        varchar name
        varchar type
        varchar barcode
        integer sort_order
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    INV_STOCK_MOVES {
        uuid id PK
        varchar reference_id
        varchar reference_type
        uuid product_id
        uuid variant_id
        uuid lot_id
        uuid source_location_id FK
        uuid destination_location_id FK
        numeric quantity
        bigint unit_cost_paise
        varchar state
        timestamptz scheduled_date
        timestamptz done_date
        varchar performed_by
        text notes
        timestamptz created_at
        timestamptz updated_at
    }

    INV_STOCK_QUANTS {
        uuid id PK
        uuid product_id
        uuid variant_id
        uuid location_id FK
        uuid lot_id
        numeric quantity
        numeric reserved_quantity
        bigint cost_price_paise
        timestamptz last_count_date
        timestamptz created_at
        timestamptz updated_at
    }
```

---

## 3. Movement Posting Sequence & Transaction Boundary

```mermaid
sequenceDiagram
    autonumber
    actor Client as Warehouse Operator / API Client
    participant Controller as InventoryController
    participant Service as InventoryService
    participant DB as PostgreSQL Transaction (Drizzle)

    Client->>Controller: POST /inventory/stock-moves/:id/post
    Controller->>Controller: Zod Route Param Validation (Valid UUID)
    Controller->>Service: postStockMove(id)
    Service->>DB: BEGIN TRANSACTION
    Service->>DB: SELECT * FROM inv_stock_moves WHERE id = $1 FOR UPDATE
    DB-->>Service: Return movement row (Locked)

    alt Movement Already DONE
        Service-->>Controller: Return existing move (Idempotent 200)
    else Movement Not CONFIRMED
        Service-->>Controller: Throw 400 Bad Request
    else Movement is CONFIRMED
        Service->>DB: SELECT location types FROM inv_locations WHERE id IN (src, dest)
        DB-->>Service: Source & Destination location metadata

        alt Source is INTERNAL (Physical Location)
            Service->>DB: SELECT * FROM inv_stock_quants WHERE ... FOR UPDATE
            DB-->>Service: Source Quant row (Locked)
            Service->>Service: Check available = quantity - reserved >= move.quantity
            alt Insufficient Stock (Overdraft Prevention)
                Service->>DB: ROLLBACK TRANSACTION
                Service-->>Client: 400 Bad Request ("Insufficient stock at location...")
            else Sufficient Stock Available
                Service->>DB: UPDATE inv_stock_quants SET quantity = quantity - $qty
            end
        end

        alt Destination is INTERNAL (Physical Location)
            Service->>DB: INSERT INTO inv_stock_quants ... ON CONFLICT DO UPDATE
        end

        Service->>DB: UPDATE inv_stock_moves SET state = 'DONE', done_date = NOW()
        Service->>DB: COMMIT TRANSACTION
        Service-->>Controller: Return updated DONE move
        Controller-->>Client: 201 Created (State: DONE)
    end
```

---

## 4. Background Ledger Reconciliation Workflow (BullMQ)

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Admin / Cron Scheduler
    participant API as JobsController & Service
    participant Queue as Redis (reconciliation-queue)
    participant Worker as ReconciliationProcessor
    participant Engine as InventoryService
    participant DB as PostgreSQL Database

    Admin->>API: POST /inventory/jobs/reconcile
    API->>API: Zod Validation (productId, batchId)
    API->>Queue: queue.add('reconcile-ledger', payload, { attempts: 3, backoff: 2000 })
    Queue-->>API: Job Enqueued (Job ID)
    API-->>Admin: 202 Accepted { jobId: 'reconcile-123', status: 'waiting' }

    Note over Queue,Worker: Asynchronous Background Processing
    Queue->>Worker: Job Picked Up by WorkerHost
    Worker->>Engine: reconcileLedger(productId)
    Engine->>DB: SELECT * FROM inv_stock_moves WHERE state = 'DONE'
    Engine->>DB: SELECT * FROM inv_stock_quants
    Engine->>Engine: Calculate Expected Balances = SUM(In) - SUM(Out)
    Engine->>Engine: Cross-reference Expected vs Actual Quants

    alt Discrepancy Found
        Engine-->>Worker: Report { status: 'DISCREPANCY_DETECTED', diff: '-2.000' }
        Worker->>Worker: Logger.warn('DISCREPANCY ALERT')
    else Zero Discrepancy
        Engine-->>Worker: Report { status: 'RECONCILED', discrepancies: 0 }
    end

    Worker-->>Queue: Job Finished (Store Return Value)
    Admin->>API: GET /inventory/jobs/reconcile/:jobId
    API->>Queue: queue.getJob(jobId)
    Queue-->>API: Job Details & Result
    API-->>Admin: 200 OK { state: 'completed', returnvalue: report }
```
