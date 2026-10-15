# System Architecture & Workflow Diagrams: Inventory II

This document compiles the authoritative visual architecture and process diagrams for **Cora ERP — Inventory II (P03)** for FreshMart. All diagrams are committed as raw Markdown using standard Mermaid syntax.

---

## 1. System Context Diagram (C4 Level 1)

```mermaid
flowchart TD
    Customer["Online Shopper / Quick-Commerce App"]
    POSCashier["Store POS Cashier / Walk-in Shopper"]
    StorePicker["Store Order Picker / Warehouse Clerk"]
    StoreManager["Store Manager / Auditor"]
    LogisticsDriver["Inter-Store Freight Driver"]

    subgraph CoraERP["Cora ERP System Boundary"]
        InventoryApp["Cora ERP Inventory System (NestJS + Angular)"]
    end

    PostgreSQL[("PostgreSQL 16 Database (ACID Stock Ledger)")]
    RedisQueue[("Redis 7 + BullMQ (Timeout & Expiry Engine)")]
    SupplierOrg["External Suppliers & Vendor Hubs"]

    Customer -->|"Places orders / requests holds"| InventoryApp
    POSCashier -->|"Executes FEFO sales & receipts"| InventoryApp
    StorePicker -->|"Picks & packs reserved items"| InventoryApp
    StoreManager -->|"Approves scrap & reconciles cycle counts"| InventoryApp
    LogisticsDriver -->|"Dispatches & delivers store transfers"| InventoryApp

    InventoryApp -->|"Atomic transactions & double-entry moves"| PostgreSQL
    InventoryApp -->|"Schedules 15-min reservation timeouts"| RedisQueue
    RedisQueue -->|"Triggers background release of expired holds"| InventoryApp
    SupplierOrg -->|"Dispatches purchase orders & lots"| InventoryApp
```

---

## 2. Component Diagram (C4 Level 2)

```mermaid
flowchart TD
    subgraph Frontend["Angular 22 Single Page Application"]
        ExpiringDash["Expiring Stock Dashboard (7-Day Store View)"]
        ReservationUI["Reservations Management View"]
        TransferUI["Two-Step Transfer Management"]
        ScrapUI["Scrap & Dual-Approval Controls"]
        CountUI["Physical Cycle Count Audit View"]
    end

    subgraph BackendAPI["NestJS Backend Application"]
        InventoryController["Inventory Controller (REST Endpoints)"]
        ZodPipe["Zod Validation Pipe (Strict Schema Validation)"]
        InventoryService["Inventory Core Domain Service"]
        JobsService["Background Jobs Service"]

        subgraph CoreModules["Domain Logic Sub-engines"]
            FEFOEngine["FEFO & Perishable Allocation Engine"]
            ReservationEngine["Reservation & Lock Engine"]
            TransferEngine["Two-Step Transfer & Shortage Engine"]
            ScrapEngine["Dual-Authorization Scrap Engine"]
            CountEngine["Cycle Count & Baseline Engine"]
        end

        Worker["BullMQ Worker (Reservation Expiry & Sweep)"]
    end

    subgraph DataStore["Persistence & Messaging"]
        PostgresDB[("PostgreSQL 16 (Drizzle ORM)")]
        RedisStore[("Redis (Delayed Job Queue)")]
    end

    ExpiringDash & ReservationUI & TransferUI & ScrapUI & CountUI -->|"HTTP / REST API"| InventoryController
    InventoryController --> ZodPipe
    ZodPipe --> InventoryService
    InventoryService --> FEFOEngine & ReservationEngine & TransferEngine & ScrapEngine & CountEngine
    InventoryService --> JobsService
    JobsService -->|"Schedule Delayed Job"| RedisStore
    Worker -->|"Poll delayed jobs"| RedisStore
    Worker -->|"Expire reservation"| InventoryService
    FEFOEngine & ReservationEngine & TransferEngine & ScrapEngine & CountEngine -->|"Drizzle Transactions"| PostgresDB
```

---

## 3. Entity-Relationship Diagram (Complete Database Schema)

```mermaid
erDiagram
    inv_warehouses ||--o{ inv_locations : "contains"
    inv_warehouses ||--o{ inv_transfers : "originates"
    inv_warehouses ||--o{ inv_stock_counts : "audits"

    inv_locations ||--o{ inv_stock_quants : "stores"
    inv_locations ||--o{ inv_stock_moves : "source / dest"
    inv_locations ||--o{ inv_reservations : "held_at"

    inv_lots ||--o{ inv_stock_quants : "partitions"
    inv_lots ||--o{ inv_stock_moves : "tracks"
    inv_lots ||--o{ inv_reservations : "allocated_to"

    inv_transfers ||--o{ inv_stock_moves : "links_legs"
    inv_stock_counts ||--o{ inv_stock_count_lines : "contains"

    inv_stock_quants {
        uuid id PK
        uuid product_id
        uuid location_id FK
        uuid lot_id FK
        numeric quantity
        numeric reserved_quantity
        numeric cost_price_paise
    }

    inv_stock_moves {
        uuid id PK
        varchar reference_id
        varchar reference_type
        uuid product_id
        uuid lot_id FK
        uuid transfer_id FK
        uuid source_location_id FK
        uuid destination_location_id FK
        numeric quantity
        varchar state
    }

    inv_lots {
        uuid id PK
        uuid product_id
        varchar name
        date manufacturing_date
        date expiry_date
    }

    inv_transfers {
        uuid id PK
        varchar transfer_number
        varchar type
        uuid warehouse_id FK
        uuid source_location_id FK
        uuid destination_location_id FK
        varchar state
    }

    inv_reservations {
        uuid id PK
        uuid merchant_id
        varchar order_reference
        uuid product_id
        uuid location_id FK
        uuid lot_id FK
        numeric quantity
        varchar state
        timestamptz expires_at
    }

    inv_stock_scrap {
        uuid id PK
        uuid product_id
        uuid lot_id FK
        uuid source_location_id FK
        uuid scrap_location_id FK
        numeric quantity
        varchar reason
        varchar state
        varchar requested_by
        varchar approved_by
    }

    inv_stock_counts {
        uuid id PK
        varchar count_number
        uuid warehouse_id FK
        uuid location_id FK
        varchar state
        varchar counted_by
    }

    inv_stock_count_lines {
        uuid id PK
        uuid count_id FK
        uuid product_id
        uuid lot_id FK
        numeric system_quantity
        numeric counted_quantity
        numeric variance_quantity
    }
```

---

## 4. State Machine: Transfer Lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Create Transfer Order
    DRAFT --> CONFIRMED : Confirm Logistics Route
    DRAFT --> CANCELLED : Cancel Transfer
    CONFIRMED --> IN_PROGRESS : Dispatch Goods to Carrier (Move to TRANSIT)
    CONFIRMED --> CANCELLED : Cancel Before Dispatch
    IN_PROGRESS --> DONE : Receive at Destination (Balance TRANSIT to 0)
    DONE --> [*] : Immutable Completed Transfer
    CANCELLED --> [*] : Transfer Voided
```

---

## 5. State Machine: Reservation Lifecycle

```mermaid
stateDiagram-v2
    [*] --> RESERVED : E-commerce Hold (reserved_quantity += Qty)
    RESERVED --> CONFIRMED : Customer Payment Successful
    RESERVED --> EXPIRED : Timeout (15m elapsed without confirmation)
    RESERVED --> CANCELLED : Shopper Abandons Checkout

    CONFIRMED --> PICKED : Store Associate Picks Stock
    CONFIRMED --> CANCELLED : Customer Cancels Before Picking

    PICKED --> DELIVERED : Handed to Courier (Deduct from Shelf Quant)
    PICKED --> CANCELLED : Customer Cancels After Picking (Requires Disposition)

    EXPIRED --> [*] : Reserved Quantity Decremented
    CANCELLED --> [*] : Reserved Quantity Decremented
    DELIVERED --> [*] : Physical Stock Deducted Permanently
```

---

## 6. Sequence Diagram: Two-Step Inter-Store Transfer

```mermaid
sequenceDiagram
    autonumber
    actor Dispatcher as Store 01 Dispatcher
    actor Receiver as Store 04 Receiver
    participant API as Inventory API Service
    participant DB as PostgreSQL Database

    Note over Dispatcher,DB: Step 1: Dispatch from Origin into Transit
    Dispatcher->>API: POST /inventory/transfers/:id/dispatch
    API->>DB: Begin Transaction (Lock Source Quant)
    API->>DB: Check Available >= 30 units
    API->>DB: Decrement Store 01 Shelf Quant by 30
    API->>DB: Increment TRANSIT Location Quant by 30
    API->>DB: Insert inv_stock_moves (Store 01 -> TRANSIT, Qty: 30, State: DONE)
    API->>DB: Update inv_transfers (State: IN_PROGRESS)
    API->>DB: Commit Transaction
    API-->>Dispatcher: Transfer IN_PROGRESS (Goods in Transit)

    Note over Receiver,DB: Step 2: Receipt at Destination
    Receiver->>API: POST /inventory/transfers/:id/receive (30 units received)
    API->>DB: Begin Transaction (Lock TRANSIT Quant)
    API->>DB: Decrement TRANSIT Quant by 30 (Balance = 0)
    API->>DB: Increment Store 04 Shelf Quant by 30
    API->>DB: Insert inv_stock_moves (TRANSIT -> Store 04 Shelf, Qty: 30, State: DONE)
    API->>DB: Update inv_transfers (State: DONE)
    API->>DB: Commit Transaction
    API-->>Receiver: Transfer Complete (TRANSIT balanced to 0)
```

---

## 7. Sequence Diagram: Transfer with Shortage (30 Dispatched, 28 Received)

```mermaid
sequenceDiagram
    autonumber
    actor Receiver as Store 04 Receiver
    participant API as Inventory API Service
    participant DB as PostgreSQL Database

    Receiver->>API: POST /inventory/transfers/:id/receive<br/>{receivedQty: 28, shortageQty: 2, reason: 'TRANSIT_DAMAGE'}
    API->>DB: Begin Transaction
    API->>DB: Validate: 28 Received + 2 Shortage == 30 Dispatched (Pass)
    API->>DB: Lock TRANSIT Quant for Update
    API->>DB: Decrement TRANSIT Quant by full 30 units (Balance becomes 0.000)
    API->>DB: Increment Store 04 Shelf Quant by 28 units
    API->>DB: Post Move 1: TRANSIT -> Store 04 Shelf (Qty: 28, State: DONE)
    API->>DB: Post Move 2: TRANSIT -> Store 04 LOSS Location (Qty: 2, Ref: SHORTAGE, State: DONE)
    API->>DB: Update inv_transfers (State: DONE, Notes: 'Reconciled 2 shortage')
    API->>DB: Commit Transaction
    API-->>Receiver: Transfer Complete (28 on shelf, 2 recorded to carrier loss, Transit = 0)
```

---

## 8. Sequence Diagram: Reserve -> Pick -> Deliver

```mermaid
sequenceDiagram
    autonumber
    actor Shopper as App Shopper
    actor Picker as Store Picker
    actor Courier as Delivery Courier
    participant API as Inventory API
    participant BullMQ as Redis BullMQ
    participant DB as PostgreSQL

    Shopper->>API: POST /inventory/reservations (Qty: 2)
    API->>DB: Begin Tx: Lock Quant & Check Available >= 2
    API->>DB: Increment quant.reserved_quantity by 2
    API->>DB: Insert inv_reservations (State: RESERVED, ExpiresAt: +15m)
    API->>DB: Commit Tx
    API->>BullMQ: Schedule Expiry Job (Delay: 15m)
    API-->>Shopper: Reservation Created (201)

    Shopper->>API: POST /inventory/reservations/:id/confirm
    API->>DB: Update inv_reservations (State: CONFIRMED)
    API-->>Shopper: Confirmed (200)

    Picker->>API: POST /inventory/reservations/:id/pick
    API->>DB: Update inv_reservations (State: PICKED)
    API-->>Picker: Picked from Shelf (200)

    Courier->>API: POST /inventory/reservations/:id/deliver
    API->>DB: Begin Tx: Lock Shelf Quant
    API->>DB: Decrement quant.quantity by 2
    API->>DB: Decrement quant.reserved_quantity by 2
    API->>DB: Insert inv_stock_moves (Shelf -> CUSTOMER, Qty: 2, State: DONE)
    API->>DB: Update inv_reservations (State: DELIVERED)
    API->>DB: Commit Tx
    API-->>Courier: Order Delivered (Stock permanently deducted)
```

---

## 9. Sequence Diagram: Customer Cancellation After Picking

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Customer / Support Agent
    participant API as Inventory API
    participant DB as PostgreSQL

    Customer->>API: POST /inventory/reservations/:id/cancel<br/>{returnToOriginalLocation: true}
    API->>DB: Begin Transaction (Lock Reservation & Quant)
    API->>DB: Verify State == 'PICKED'
    API->>DB: Physical stock is still packed in dispatch tote
    API->>DB: Restock action: Decrement quant.reserved_quantity by 2
    API->>DB: Shelf available stock restored (Physical item returned to shelf bin)
    API->>DB: Update inv_reservations (State: CANCELLED, Notes: 'Restocked to shelf')
    API->>DB: Commit Transaction
    API-->>Customer: Reservation Cancelled & Restocked
```

---

## 10. Sequence Diagram: Reservation Timeout vs Concurrent Confirmation

```mermaid
sequenceDiagram
    autonumber
    actor Shopper as Shopper App
    participant Worker as BullMQ Expiry Worker
    participant API as Inventory Service
    participant DB as PostgreSQL

    par Race Condition Window
        Shopper->>API: POST /reservations/:id/confirm (At minute 14:59.900)
    and
        Worker->>API: expireReservation(id) (At minute 15:00.000)
    end

    Note over API,DB: Database Transaction Isolation with SELECT ... FOR UPDATE
    API->>DB: Begin Transaction (Confirmation Leg)
    API->>DB: SELECT * FROM inv_reservations WHERE id = :id FOR UPDATE
    Note over DB: Lock granted to Confirmation Leg first

    API->>DB: Check state == 'RESERVED' (Valid)
    API->>DB: UPDATE inv_reservations SET state = 'CONFIRMED'
    API->>DB: Commit Transaction
    API-->>Shopper: Reservation CONFIRMED (200)

    Note over API,DB: Expiry Leg now acquires lock
    Worker->>DB: SELECT * FROM inv_reservations WHERE id = :id FOR UPDATE
    API->>DB: Check state == 'RESERVED' (False, state is now CONFIRMED)
    API->>Worker: Idempotently abort release (Already confirmed, stock NOT released)
    Note over API,DB: Exactly-once invariant preserved: No double release!
```

---

## 11. Sequence Diagram: Physical Count with Active Store Operations

```mermaid
sequenceDiagram
    autonumber
    actor Auditor as Store Auditor
    actor POS as Active POS Cashier
    participant API as Inventory API
    participant DB as PostgreSQL

    Auditor->>API: POST /inventory/counts (Warehouse A, Shelf 1)
    API->>DB: Freeze snapshot of current quants (e.g. Milk: 40 units)
    API->>DB: Insert inv_stock_count_lines (system_quantity: 40)
    API-->>Auditor: Count DRAFT Initialized

    Note over POS,DB: Active Store Operations Continue Unblocked
    POS->>API: POST /inventory/lots/fefo-sale (Cashier sells 2 bottles)
    API->>DB: Normal sale posts: Shelf quant becomes 38 (Ledger move recorded)

    Note over Auditor,DB: Auditor finishes physical counting
    Auditor->>API: POST /inventory/counts/:id/record<br/>{countedQuantity: 38}
    API->>DB: Calculate variance: 38 Counted - 40 Snapshot = -2 variance
    API->>DB: System checks if sale was registered during audit window
    API-->>Auditor: Review Status (Discrepancy reconciled against concurrent POS moves)

    Auditor->>API: POST /inventory/counts/:id/reconcile
    API->>DB: Post ADJUSTMENT movement for unexplained drift only
    API-->>Auditor: Count POSTED
```

---

## 12. Sequence Diagram: Scrap Request & Independent Dual-Approval

```mermaid
sequenceDiagram
    autonumber
    actor Clerk as Store Clerk (Requester)
    actor Manager as Store Manager (Approver)
    participant API as Inventory API
    participant DB as PostgreSQL

    Clerk->>API: POST /inventory/scrap<br/>{productId, lotId, qty: 5, reason: 'EXPIRED_LOT', requestedBy: 'clerk-ramesh'}
    API->>DB: Insert inv_stock_scrap (State: PENDING_APPROVAL, requested_by: 'clerk-ramesh')
    Note over DB: Shelf stock remains untouched during pending review
    API-->>Clerk: Scrap Request Registered (201)

    Note over Clerk,API: Fraud Attempt: Clerk attempts to approve own request
    Clerk->>API: POST /inventory/scrap/:id/approve<br/>{approvedBy: 'clerk-ramesh'}
    API->>API: Check: approvedBy == requestedBy
    API-->>Clerk: 403 Forbidden ("Independent Dual-Authorization Required")

    Note over Manager,API: Legitimate Independent Approval
    Manager->>API: POST /inventory/scrap/:id/approve<br/>{approvedBy: 'manager-deshmukh'}
    API->>DB: Begin Transaction (Lock Quant)
    API->>DB: Verify manager-deshmukh != clerk-ramesh (Pass)
    API->>DB: Decrement Store Shelf Quant by 5
    API->>DB: Increment SCRAP Location Quant by 5
    API->>DB: Insert inv_stock_moves (Shelf -> SCRAP, Qty: 5, Ref: SCRAP, State: DONE)
    API->>DB: Update inv_stock_scrap (State: APPROVED, approved_by: 'manager-deshmukh')
    API->>DB: Commit Transaction
    API-->>Manager: Scrap Approved & Written Off (Stock moved to SCRAP bin)
```

---

## 13. 7-Day 4-Line Inventory Trajectory Graph

The diagram below illustrates the mathematical conservation of inventory across a 7-day period for a perishable product experiencing receipts, customer reservations, store transfers, and sales:

```mermaid
xychart-beta
    title "FreshMart Store 01: 7-Day Inventory Trajectory (Units)"
    x-axis ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"]
    y-axis "Quantity (Units)" 0 --> 160
    line [100, 140, 130, 110, 95, 80, 120]
    line [15, 30, 45, 25, 20, 15, 25]
    line [85, 110, 85, 85, 75, 65, 95]
    line [0, 0, 30, 30, 15, 0, 0]
```

### Legend & Curve Relationships:
1. **Line 1 (Blue — On-Hand Stock):** Total physical inventory present in store. Increases on Day 2 upon supplier GRN (+40 units), decreases as items are delivered or transferred.
2. **Line 2 (Orange — Reserved Stock):** Items held for online cart checkouts. Spikes on Days 2–3 during peak e-commerce promotions.
3. **Line 3 (Green — Available Stock):** Strictly adheres to the fundamental invariant:
   $$\text{Available} = \text{On-Hand} - \text{Reserved}$$
   Represents sellable stock for walk-in shoppers and new digital cart allocations.
4. **Line 4 (Purple — In-Transit Stock):** 30 units dispatched on Day 3 towards Store 04. Disappears on Day 6 once Store 04 completes physical goods receipt. Notice that transit inventory is never counted in either store's available curve!
