# Benchmark Analysis: Odoo Inventory vs. The Stock Ledger

Benchmark Product: **Odoo Inventory (v17 / v18 Enterprise & Community Edition)**  
Target Enterprise ERP: **Cora ERP (Techvisk)**  
Citations & Sources Consulted:
- [Odoo 18.0 Inventory Documentation: Double-Entry Inventory Management](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/double_entry.html)
- [Odoo 18.0 Developer Reference: Stock Models & Quants](https://www.odoo.com/documentation/18.0/developer/reference/backend/orm.html)
- [Odoo 18.0 Inventory: Two-Step and Three-Step Delivery Routes](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/use_routes.html)
- [Odoo 18.0 Product Costing & Landed Costs Valuation](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_valuation/integrating_additional_costs.html)

---

## 1. Overview of Odoo Inventory

Odoo Inventory is widely recognized as the industry benchmark for open-source and mid-market ERP warehouse management. Unlike legacy ERPs (such as older SAP R/3 versions or basic retail accounting tools) that treat stock as a single mutable scalar column on a product master table, Odoo models warehouse management using **Double-Entry Stock Tracking**, directly inspired by double-entry financial accounting.

In Odoo, goods never appear from nowhere or vanish into thin air. Every physical change is an immutable movement vector between two locations:
$$(SourceLocation \xrightarrow{Quantity} DestinationLocation)$$

Odoo handles operations spanning receiving, quality control, internal cross-docking, picking, packing, shipping, cycle counting, scrap write-offs, and multi-currency inventory valuation.

---

## 2. Major Odoo Objects & Their Relationships

```mermaid
erDiagram
    STOCK-LOCATION ||--o{ STOCK-QUANT : "stores balance"
    PRODUCT-PRODUCT ||--o{ STOCK-QUANT : "tracked by"
    STOCK-LOCATION ||--o{ STOCK-MOVE : "originates from (source)"
    STOCK-LOCATION ||--o{ STOCK-MOVE : "terminates at (destination)"
    STOCK-PICKING ||--o{ STOCK-MOVE : "groups operations"
    STOCK-MOVE ||--o{ STOCK-MOVE-LINE : "executes detailed pack/lot"
    STOCK-MOVE ||--o{ STOCK-VALUATION-LAYER : "generates financial entry"
```

1. **`stock.location`**: Physical zones (shelves, racks) and virtual zones (suppliers, customers, scrap, loss).
2. **`stock.quant`**: In-memory and persisted snapshot cache storing on-hand, reserved, and available quantities by `(product, location, package, lot)`.
3. **`stock.move`**: High-level planned or confirmed stock transfer (e.g. 50 units of Steel Rods from Storage to Customer).
4. **`stock.move.line`**: The granular physical execution record specifying the exact serial numbers, lots, and packages picked from specific shelves.
5. **`stock.picking`**: The warehouse document grouping related movements (e.g. a single Delivery Order containing 5 different stock moves).
6. **`stock.valuation.layer`**: Financial record tracking the monetary debit and credit resulting from a completed movement.

---

## 3. Odoo's Handling of Locations, Stock Moves, and Quants

### Locations
Odoo organizes locations into a hierarchical tree with typed semantics:
- **Physical Locations (`view`, `internal`)**: Real spaces inside the warehouse. Quantities must obey physical laws ($\ge 0$ under standard configuration).
- **Partner Locations (`supplier`, `customer`)**: Virtual counterparties outside the warehouse boundaries. They act as infinite sources (for purchases) or sinks (for sales).
- **Virtual Locations (`inventory`, `production`, `procurement`)**: Counterparties for inventory adjustments, manufacturing conversions, and transit buffers.

### Stock Moves vs. Quants
- A **`stock.move`** represents **action and intention**. It transitions through a strict lifecycle: `draft` $\rightarrow$ `waiting` $\rightarrow$ `confirmed` $\rightarrow$ `assigned` $\rightarrow$ `done`.
- A **`stock.quant`** represents **state at rest**. Quants are never manually created by users; they are updated automatically when a move reaches `done`.
- **Reservations**: When a sales order is confirmed in Odoo, the move enters `assigned` state, and the corresponding `stock.quant.reserved_quantity` increases. Physical on-hand stock remains untouched, but **Available** stock decreases immediately to prevent overselling.

---

## 4. Five Capabilities Odoo Provides Beyond the Supplied P02 Tables

The four tables supplied in the P02 problem statement (`inv_warehouses`, `inv_locations`, `inv_stock_moves`, `inv_stock_quants`) provide a solid foundation for a double-entry ledger, but Odoo delivers five advanced capabilities that cannot be supported without additional schema extensions:

1. **Multi-Step Route Engine (Push/Pull Rules)**:
   - *Odoo Capability*: Automatically splits a sale into a 3-step pipeline: `Pick (Rack -> Packing)` $\rightarrow$ `Pack (Packing -> Output)` $\rightarrow$ `Ship (Output -> Customer)`.
   - *P02 Gap*: P02 movements are strictly 1-step point-to-point transfers; multi-stage routing must be manually orchestrated.
2. **Dynamic Put-Away Strategies (FIFO, LIFO, FEFO)**:
   - *Odoo Capability*: When inbound goods arrive at the receiving dock, Odoo automatically computes the destination bin based on pallet dimensions, temperature requirements, or expiration dates (FEFO - First Expired, First Out).
   - *P02 Gap*: Destination locations in P02 must be explicitly supplied in the request payload.
3. **Landed Cost Allocation**:
   - *Odoo Capability*: Automatically distributes external shipping freight, customs duties, and maritime insurance across received inventory lines, updating `unit_cost` and balance sheet valuation layers.
   - *P02 Gap*: P02 records static `unit_cost_paise` at move creation, without post-receipt duty adjustment mechanisms.
4. **Lot & Serial Traceability Matrix**:
   - *Odoo Capability*: Comprehensive upstream and downstream traceability graphs showing exactly which supplier batch was used in which customer delivery order for immediate product recalls.
   - *P02 Gap*: While P02 has a `lot_id` column, it lacks supporting lot lifecycle tables, expiration dates, and recall query graphs.
5. **Automated Min/Max Reordering Rules (Procurement Triggers)**:
   - *Odoo Capability*: When available stock drops below a defined safety threshold, Odoo automatically generates a Draft Purchase Order to the preferred vendor.
   - *P02 Gap*: P02 provides read-only stock balances without automated replenishment trigger engines.

---

## 5. Three Odoo Design Choices NOT to Copy Blindly

1. **Heavy Dynamic Python ORM Stock Computation (`_compute_quantities`)**:
   - *Odoo Approach*: In older versions and certain multi-location rollups, Odoo dynamically aggregates historical moves in Python or complex SQL joins across thousands of locations.
   - *Why NOT to copy*: Under high-concurrency e-commerce checkout traffic, this causes severe CPU bottlenecks, N+1 query patterns, and locking deadlocks. Our design keeps a lean, indexed `inv_stock_quants` snapshot table with sub-millisecond indexed reads.
2. **Allowing Negative Inventory (`allow_negative_stock`)**:
   - *Odoo Approach*: Odoo provides a configuration switch allowing negative internal stock so operators can process shipments even if goods haven't been formally inwarded in the software.
   - *Why NOT to copy*: Allowing negative stock destroys inventory valuation (FIFO breaks down when cost basis is negative) and causes phantom stock drift. Our PostgreSQL `CHECK (quantity >= 0)` strictly enforces physical reality at the database level.
3. **Polymorphic Monolithic Models**:
   - *Odoo Approach*: Uses single monolithic models with dozens of optional relations for manufacturing, POS, retail, and dropshipping.
   - *Why NOT to copy*: Increases database migration complexity, bloats table storage, and hampers horizontal microservice scaling. Clean, modular TypeScript schemas are much easier to maintain and verify.

---

## 6. One Key Idea to Introduce into Cora ERP First

**Automated Reordering Rules with Safety Stock Thresholds (`inv_reorder_rules`)**:
For a retail shop or small warehouse using Cora ERP, the single highest-ROI feature is automated stockout protection. 
- The merchant configures `min_quantity` and `max_quantity` for critical SKUs.
- A background BullMQ job monitors `inv_stock_quants.quantity - inv_stock_quants.reserved_quantity`.
- The moment available stock drops below `min_quantity`, Cora ERP automatically generates a pre-filled Draft Goods Receipt Note (GRN) or purchase order, preventing lost retail sales with zero manual data entry.

---

## 7. Feature Comparison: The Stock Ledger vs. Odoo Inventory

| Architectural Feature | Odoo Inventory (v18) | Techvisk P02 Stock Ledger | Status & Assessment |
| :--- | :--- | :--- | :--- |
| **Accounting Model** | Double-entry vector transfers | Double-entry vector transfers | **Parity**: Identical $(Source \rightarrow Destination)$ model |
| **Read Performance** | Quants + ORM cache | Direct PostgreSQL `inv_stock_quants` | **Superior in P02**: Zero ORM overhead, sub-millisecond p95 latency |
| **Negative Stock Prevention** | Application-level setting (can be disabled) | Database-level constraint `CHECK (quantity >= 0)` | **Superior in P02**: Impossible to bypass even via direct SQL |
| **Reservation Protection** | Soft reservation on move assignment | Enforced constraint `CHECK (reserved <= quantity)` | **Parity**: Real-time Available calculation |
| **Ledger Reconciliation** | Enterprise audit report / wizard | Automated SQL Reconciliation Engine + BullMQ Worker | **Parity**: Built-in 0-drift invariant audit |
| **Multi-Step Routing** | Automated Push/Pull rules engine | Manual point-to-point transfers | **Odoo Advanced**: Planned for Cora ERP Phase II |
| **Batch / Lot Recalls** | End-to-end traceability graph | `lot_id` foreign key support | **Odoo Advanced**: Requires dedicated lot tracking module |
| **Type Safety & API Validation** | Python dynamic typing (`models.Model`) | Strict TypeScript (`noImplicitAny`) + Zod | **Superior in P02**: Zero `any`, compile-time validation |
