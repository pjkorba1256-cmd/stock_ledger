# System Architecture & Technical Diagrams — P02 Stock Ledger

This document contains seven architectural diagrams modeling the verified implementation of **The Stock Ledger**.

---

## 1. System Context Diagram (C4 Level 1)

```mermaid
flowchart TD
    subgraph Users ["Actors & External Stakeholders"]
        OPERATOR["Warehouse Storekeeper"]
        ADMIN["Shop Owner / Admin"]
        AUDITOR["Financial Auditor"]
        COMMERCE["E-Commerce Checkout / ERP"]
    end

    subgraph SystemBoundary ["Techvisk P02: The Stock Ledger System"]
        STOCK_LEDGER["Stock Ledger Platform\n(NestJS API + Angular 22 SPA)"]
    end

    subgraph ExternalServices ["Data & Infrastructure Stores"]
        POSTGRES[("PostgreSQL 18 Database\n(Neon Serverless / Local)")]
        REDIS[("Redis 7.x Queue Store\n(BullMQ Asynchronous Workers)")]
    end

    OPERATOR -->|"Record GRN, Transfers, Adjustments"| STOCK_LEDGER
    ADMIN -->|"Configure Warehouses & Locations"| STOCK_LEDGER
    AUDITOR -->|"Run Ledger Reconciliation & Audit"| STOCK_LEDGER
    COMMERCE -->|"Check Stock & Reserve Units"| STOCK_LEDGER

    STOCK_LEDGER -->|"Double-Entry Ledger & Quants"| POSTGRES
    STOCK_LEDGER -->|"Enqueue Reconciliation Jobs"| REDIS
    REDIS -->|"Execute Background Audits"| STOCK_LEDGER
```

---

## 2. Component Diagram (C4 Level 2)

```mermaid
flowchart TD
    subgraph Frontend ["Angular 22 Client (SPA)"]
        UI_DASH["Dashboard & Widgets"]
        UI_TABLE["Stock Snapshot Table (Quants)"]
        UI_LEDGER["Movement Ledger Table"]
        UI_FORM["Record Movement Form"]
        UI_RECON["Reconciliation Audit Panel"]
        API_SVC["InventoryApiService (HttpClient)"]

        UI_DASH --> API_SVC
        UI_TABLE --> API_SVC
        UI_LEDGER --> API_SVC
        UI_FORM --> API_SVC
        UI_RECON --> API_SVC
    end

    subgraph BackendAPI ["NestJS Application (Port 3000)"]
        GATEWAY["HTTP Server (Express + CORS)"]
        ZOD_PIPE["ZodValidationPipe (Strict Schema Enforcement)"]
        
        INV_CTRL["InventoryController"]
        JOBS_CTRL["JobsController"]
        APP_CTRL["AppController (Health & DB Metrics)"]

        INV_SRV["InventoryService (Domain Engine & ACID Logic)"]
        JOBS_SRV["JobsService (BullMQ Producer)"]
        RECON_PROC["ReconciliationProcessor (BullMQ Worker)"]

        GATEWAY --> ZOD_PIPE
        ZOD_PIPE --> INV_CTRL
        ZOD_PIPE --> JOBS_CTRL
        GATEWAY --> APP_CTRL

        INV_CTRL --> INV_SRV
        JOBS_CTRL --> JOBS_SRV
        JOBS_SRV -.->|"Job Event"| RECON_PROC
        RECON_PROC --> INV_SRV
    end

    subgraph Persistence ["Data & Queue Layer"]
        DRIZZLE["Drizzle ORM (Connection Pool)"]
        PG_DB[("PostgreSQL 18\n(4 Core Tables)")]
        REDIS_DB[("Redis Store\n(BullMQ Queue)")]

        INV_SRV --> DRIZZLE
        DRIZZLE --> PG_DB
        JOBS_SRV --> REDIS_DB
        REDIS_DB --> RECON_PROC
    end

    API_SVC -->|"REST API / JSON"| GATEWAY
```

---

## 3. Entity-Relationship Diagram (ERD)

```mermaid
erDiagram
    INV_WAREHOUSES ||--o{ INV_LOCATIONS : "contains (1:N)"
    INV_LOCATIONS ||--o{ INV_LOCATIONS : "parent_zone (1:N)"
    INV_LOCATIONS ||--o{ INV_STOCK_MOVES : "source_location (1:N)"
    INV_LOCATIONS ||--o{ INV_STOCK_MOVES : "destination_location (1:N)"
    INV_LOCATIONS ||--o{ INV_STOCK_QUANTS : "holds_stock (1:N)"

    INV_WAREHOUSES {
        uuid id PK "gen_random_uuid()"
        uuid merchant_id "Tenant owner"
        varchar code UK "Unique short code"
        varchar name "Facility name"
        jsonb address "Structured address"
        boolean is_active "Active flag"
        boolean is_default "At most one default per merchant"
        timestamptz created_at "NOW()"
        timestamptz updated_at "NOW()"
    }

    INV_LOCATIONS {
        uuid id PK "gen_random_uuid()"
        uuid warehouse_id FK "REFERENCES inv_warehouses(id)"
        uuid parent_location_id FK "REFERENCES inv_locations(id)"
        varchar code "Unique per warehouse"
        varchar name "Shelf / Rack / Vendor"
        varchar type "CHECK: INTERNAL, SUPPLIER, CUSTOMER, LOSS, SCRAP, TRANSIT"
        varchar barcode "Scannable tag"
        integer sort_order "Picker walk order"
        boolean is_active "Active flag"
        timestamptz created_at "NOW()"
        timestamptz updated_at "NOW()"
    }

    INV_STOCK_MOVES {
        uuid id PK "gen_random_uuid()"
        varchar reference_id "PO / SO / Invoice"
        varchar reference_type "CHECK: GRN, SALE, RETURN, TRANSFER, ADJUSTMENT, SCRAP"
        uuid product_id "Product identifier"
        uuid variant_id "SKU variant identifier"
        uuid lot_id "Batch / Lot identifier"
        uuid source_location_id FK "REFERENCES inv_locations(id)"
        uuid destination_location_id FK "REFERENCES inv_locations(id)"
        numeric quantity "CHECK: quantity > 0"
        bigint unit_cost_paise "Valuation in paise"
        varchar state "CHECK: DRAFT, CONFIRMED, DONE, CANCELLED"
        timestamptz scheduled_date "Scheduled date"
        timestamptz done_date "Timestamp when posted"
        varchar performed_by "Auditable user"
        text notes "Audit remarks"
        timestamptz created_at "NOW()"
        timestamptz updated_at "NOW()"
    }

    INV_STOCK_QUANTS {
        uuid id PK "gen_random_uuid()"
        uuid product_id "Product identifier"
        uuid variant_id "SKU variant identifier"
        uuid location_id FK "REFERENCES inv_locations(id)"
        uuid lot_id "Batch / Lot identifier"
        numeric quantity "CHECK: quantity >= 0"
        numeric reserved_quantity "CHECK: 0 <= reserved <= quantity"
        bigint cost_price_paise "WAC unit cost"
        timestamptz last_count_date "Last physical cycle count"
        timestamptz created_at "NOW()"
        timestamptz updated_at "NOW()"
    }
```

---

## 4. Successful Stock Movement Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Warehouse Storekeeper
    participant Web as Angular Dashboard (SPA)
    participant Ctrl as InventoryController
    participant Pipe as ZodValidationPipe
    participant Srv as InventoryService
    participant DB as PostgreSQL (ACID Transaction)

    Operator->>Web: Click "Post Movement" (ID: move-123)
    Web->>Ctrl: POST /inventory/stock-moves/move-123/post
    Ctrl->>Pipe: Validate Route Param (UUID format)
    Pipe-->>Ctrl: Valid UUID confirmed
    Ctrl->>Srv: postStockMove(move-123)
    
    Srv->>DB: BEGIN TRANSACTION (Pessimistic Mode)
    Srv->>DB: SELECT * FROM inv_stock_moves WHERE id = 'move-123' FOR UPDATE
    DB-->>Srv: Return movement row (Locked against concurrent posts)
    
    Note over Srv: Verification: State == 'CONFIRMED'
    Srv->>DB: SELECT type FROM inv_locations WHERE id IN (source, dest)
    DB-->>Srv: Source: INTERNAL, Destination: INTERNAL
    
    Srv->>DB: SELECT * FROM inv_stock_quants WHERE product_id = ... AND location_id = source FOR UPDATE
    DB-->>Srv: Source Quant Row (Locked: on_hand=100.000, reserved=20.000)
    
    Note over Srv: Invariant Check: (100.000 - 20.000) >= 30.000 [VALID]
    
    Srv->>DB: UPDATE inv_stock_quants SET quantity = 70.000 WHERE id = source_quant_id
    Srv->>DB: INSERT INTO inv_stock_quants (product, location, qty=30.000) ON CONFLICT DO UPDATE SET quantity = quantity + 30.000
    Srv->>DB: UPDATE inv_stock_moves SET state = 'DONE', done_date = NOW() WHERE id = 'move-123'
    
    Srv->>DB: COMMIT TRANSACTION
    DB-->>Srv: Transaction Committed Successfully
    Srv-->>Ctrl: Return updated Movement record (State: DONE)
    Ctrl-->>Web: HTTP 201 Created (JSON Payload)
    Web-->>Operator: Display floating green toast: "Movement posted successfully"
```

---

## 5. Failure-Midway Sequence Diagram (Overdraft / DB Disconnect)

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as Cashier / API Client
    participant Ctrl as InventoryController
    participant Srv as InventoryService
    participant DB as PostgreSQL Transaction

    Cashier->>Ctrl: POST /inventory/stock-moves/sale-999/post (Request 50 units)
    Ctrl->>Srv: postStockMove(sale-999)
    Srv->>DB: BEGIN TRANSACTION
    Srv->>DB: SELECT * FROM inv_stock_moves WHERE id = 'sale-999' FOR UPDATE
    DB-->>Srv: Move Locked (Qty: 50.000, Source: Shelf A-01)

    Srv->>DB: SELECT * FROM inv_stock_quants WHERE location_id = 'Shelf A-01' FOR UPDATE
    DB-->>Srv: Quant Locked (Quantity: 30.000, Reserved: 0.000)

    Note over Srv: Invariant Failure: Requested (50) > Available (30)
    
    critical Atomic Rollback on Rule Violation
        Srv->>DB: ROLLBACK TRANSACTION
        DB-->>Srv: Transaction Aborted cleanly
    end

    Note over DB: Guaranteed State: Source Quant remains 30.000; Move remains CONFIRMED; Zero Partial Updates!
    
    Srv-->>Ctrl: Throw BadRequestException ("Insufficient stock: available is 30.000, requested 50.000")
    Ctrl-->>Cashier: HTTP 400 Bad Request { error: "Insufficient stock...", status: 400 }
```

---

## 6. State Machine Diagram: Movement Lifecycle (`inv_stock_moves.state`)

```mermaid
stateDiagram-v2
    [*] --> DRAFT : createStockMove() [Initial State]
    
    DRAFT --> CONFIRMED : confirmStockMove() [Order Confirmed / Allocated]
    DRAFT --> CANCELLED : cancelStockMove() [Discarded Order]
    
    CONFIRMED --> DONE : postStockMove() [Atomic DB Transfer Committed]
    CONFIRMED --> CANCELLED : cancelStockMove() [Cancelled Before Dispatch]
    
    DONE --> [*] : Immutable Terminal State (Cannot Edit, Cancel, or Re-post)
    CANCELLED --> [*] : Terminal State (Cannot Confirm or Post)

    note right of DRAFT
        Draft movements represent intention.
        They do NOT alter physical quants.
    end note

    note right of CONFIRMED
        Movement is locked for execution.
        Units may be soft-reserved in quants.
    end note

    note right of DONE
        Physical stock has transferred.
        Strictly immutable forever.
        Corrections require an ADJUSTMENT move.
    end note
```

---

## 7. End-to-End Business Process Flow Diagram

```mermaid
flowchart TD
    START([Vendor Goods Arrive]) --> STEP1[1. Inward Supplier Goods Receipt Note]
    STEP1 --> GRN_POST[POST /inventory/stock-moves: SUPPLIER -> Receiving Dock]
    GRN_POST --> GRN_DONE[Move Marked DONE: Receiving Dock Quant Incremented]
    
    GRN_DONE --> STEP2[2. Internal Shelf Put-Away Transfer]
    STEP2 --> PUT_POST[POST /inventory/stock-moves: Receiving Dock -> Pallet Rack A-01]
    PUT_POST --> PUT_DONE[Move Marked DONE: Stock Balanced Across Internal Locations]
    
    PUT_DONE --> STEP3[3. Customer Places Order]
    STEP3 --> RESERVE[Soft Reservation: PATCH /inventory/quants/:id/reserve]
    RESERVE --> CHECK_ATP{Available >= Order Qty?}
    
    CHECK_ATP -->|No| REJECT[Reject Sale: Prevent Overselling]
    CHECK_ATP -->|Yes| HOLD[Reserved Stock Incremented: Available Decremented]
    
    HOLD --> STEP4[4. Storekeeper Picks & Packs Goods]
    STEP4 --> DISPATCH[POST /inventory/stock-moves: Pallet Rack A-01 -> CUSTOMER]
    DISPATCH --> POST_DONE[Move Marked DONE: Physical Quant Decremented, Reservation Released]
    
    POST_DONE --> STEP5[5. Nightly Automated Reconciliation Audit]
    STEP5 --> BULLMQ[BullMQ Asynchronous Job: reconcileLedger]
    BULLMQ --> VERIFY{SUM Movements == Current Quant?}
    VERIFY -->|Match| PASS[Status: RECONCILED / 0 Discrepancy]
    VERIFY -->|Drift| ALERT[Status: DISCREPANCY_DETECTED / Operator Alert]
    
    PASS --> END([Audit Complete: 100% Invariant Conserved])
    ALERT --> END
```
