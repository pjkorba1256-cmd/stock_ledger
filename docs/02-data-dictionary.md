# Data Dictionary: Inventory II — Database Schema & Field Reference

This document provides an exhaustive reference for the database schema implementing **P03: Lots, Reservations, Transfers, and Counts** on PostgreSQL using Drizzle ORM.

---

## 1. Table: `inv_lots`

Catalog of production batches and traceable lots associated with products.

| Column | SQL Type | Nullable | Constraints & FK | Business Meaning & FreshMart Example | Read/Write Roles | Breaking Condition | Audit Verdict |
|---|---|---|---|---|---|---|---|
| `id` | `uuid` | No | PK, `gen_random_uuid()` | Immutable internal identifier for a lot batch. | R: All<br>W: Lot Receipt API | Null or duplicate causes primary key collision. | Verified |
| `product_id` | `uuid` | No | Unique composite with `name` | Catalog product identifier (e.g. Milk 1L). | R: All<br>W: Receipt | Orphaned lot without product reference. | Verified |
| `name` | `varchar(100)` | No | Unique composite `(product_id, name)` | Manufacturer batch code (e.g. `LOT-MILK-2026-A1`). | R: POS, WMS<br>W: Procurement | Duplicate batch code for same product corrupts lot tracking. | Verified |
| `vendor_id` | `uuid` | Yes | FK to `vendors(id)` | Supplier/manufacturer of origin (e.g. Amul Dairy Hub). | R: Audit<br>W: Procurement | Vendor deletion sets reference to NULL. | Verified |
| `manufacturing_date` | `date` | Yes | None | Date product was processed or packaged (e.g. `2026-10-01`). | R: QA<br>W: Procurement | Future date indicates mislabeling. | Verified |
| `expiry_date` | `date` | Yes | Indexed | Regulatory expiration date (e.g. `2026-10-18`). Basis for FEFO. | R: FEFO Engine<br>W: Procurement | Null implies non-perishable; past date blocks sales. | Verified |
| `reference` | `varchar(100)` | Yes | None | External invoice or bill of lading reference. | R: Accounting<br>W: Receipt | None (informational). | Verified |
| `notes` | `text` | Yes | None | Quality notes, inspection certificates, or storage guidelines. | R: Ops<br>W: Ops | None. | Verified |
| `created_at` | `timestamptz` | No | Default `now()` | Audit timestamp when batch was registered in ERP. | R: Audit<br>W: System | Clock skew on insert. | Verified |

---

## 2. Table: `inv_transfers`

Coordinates multi-step inter-store shipments, transfers, and receipts.

| Column | SQL Type | Nullable | Constraints & FK | Business Meaning & FreshMart Example | Read/Write Roles | Breaking Condition | Audit Verdict |
|---|---|---|---|---|---|---|---|
| `id` | `uuid` | No | PK, `gen_random_uuid()` | Immutable transfer identifier. | R: All<br>W: System | Non-UUID or duplicate PK. | Verified |
| `transfer_number` | `varchar(50)` | No | Unique, Indexed | Human-readable sequence number (e.g. `TR-20261015-0001`). | R: Logistics<br>W: Sequence Gen | Duplicate transfer number halts dispatch. | Verified |
| `type` | `varchar(10)` | No | Check `INTERNAL`, `INBOUND`, `OUTBOUND` | Directional category of stock movement. | R: All<br>W: Dispatcher | Invalid type causes routing failure. | Verified |
| `warehouse_id` | `uuid` | No | FK to `inv_warehouses(id)` | Originating store or facility (e.g. FreshMart Store 01). | R: All<br>W: Dispatcher | Missing warehouse violates multi-tenant ownership. | Verified |
| `source_location_id` | `uuid` | Yes | FK to `inv_locations(id)` | Source internal shelf location. | R: Warehouse<br>W: Dispatcher | Missing source in INTERNAL transfer. | Verified |
| `destination_location_id` | `uuid` | Yes | FK to `inv_locations(id)` | Destination internal shelf location. | R: Warehouse<br>W: Dispatcher | Same as source location causes self-transfer drift. | Verified |
| `partner_id` | `varchar(100)` | Yes | None | External logistics carrier or vendor identifier. | R: Freight<br>W: Dispatcher | None. | Verified |
| `partner_type` | `varchar(10)` | Yes | None | Partner classification (e.g. `CARRIER`, `SUPPLIER`). | R: Ops<br>W: Dispatcher | None. | Verified |
| `reference_id` | `varchar(100)` | Yes | None | Associated Purchase Order or Dispatch Manifest #. | R: All<br>W: Dispatcher | None. | Verified |
| `reference_type` | `varchar(30)` | Yes | None | Business document type (e.g. `STORE_REPLENISHMENT`). | R: Ops<br>W: Dispatcher | None. | Verified |
| `state` | `varchar(12)` | No | Default `DRAFT`, Check state | Lifecycle state: `DRAFT`, `CONFIRMED`, `IN_PROGRESS`, `DONE`, `CANCELLED`. | R: All<br>W: State Machine | Mutating state backwards from `DONE` violates immutability. | Verified |
| `scheduled_date` | `timestamptz` | Yes | None | Promised departure or delivery date. | R: Logistics<br>W: Planner | None. | Verified |
| `done_date` | `timestamptz` | Yes | None | Timestamp when destination completed goods receipt note. | R: Audit<br>W: System | Null on completed transfer indicates incomplete workflow. | Verified |
| `notes` | `text` | Yes | None | Driver instructions, seal numbers, or transit notes. | R: Logistics<br>W: Operator | None. | Verified |
| `created_at` | `timestamptz` | No | Default `now()` | Date record was created. | R: Audit<br>W: System | None. | Verified |
| `updated_at` | `timestamptz` | No | Default `now()` | Timestamp of last state change. | R: Audit<br>W: System | None. | Verified |

---

## 3. Table: `inv_transfer_counters`

Transactional counter maintaining atomic sequential numbering per date.

| Column | SQL Type | Nullable | Constraints & FK | Business Meaning & FreshMart Example | Read/Write Roles | Breaking Condition | Audit Verdict |
|---|---|---|---|---|---|---|---|
| `date_prefix` | `varchar(8)` | No | PK (e.g. `20261015`) | Calendar date bucket for daily sequence resetting. | R: System<br>W: System | Non-8 char format breaks parsing. | Verified |
| `last_number` | `integer` | No | Default `0` | Atomic integer incremented for each new transfer. | R: System<br>W: System | Counter collision under non-locked transaction. | Verified |

---

## 4. Table: `inv_reservations`

Active customer holds and order commitments with expiration timeouts.

| Column | SQL Type | Nullable | Constraints & FK | Business Meaning & FreshMart Example | Read/Write Roles | Breaking Condition | Audit Verdict |
|---|---|---|---|---|---|---|---|
| `id` | `uuid` | No | PK, `gen_random_uuid()` | Immutable reservation identifier. | R: All<br>W: System | Duplicate PK. | Verified |
| `merchant_id` | `uuid` | No | Indexed | Merchant tenant scoping (e.g. FreshMart Retail Org). | R: Auth<br>W: Order API | Cross-tenant leak if omitted. | Verified |
| `order_reference` | `varchar(100)` | No | Indexed | E-commerce or POS order number (e.g. `ORD-882319`). | R: Order<br>W: Order API | Empty string causes untraceable hold. | Verified |
| `product_id` | `uuid` | No | FK to product | Item reserved for order. | R: Pickers<br>W: Order API | Missing product reference. | Verified |
| `variant_id` | `uuid` | Yes | None | Specific product size/color variant if applicable. | R: Pickers<br>W: Order API | None. | Verified |
| `locationId` | `uuid` | No | FK to `inv_locations(id)` | Store shelf where stock is held. | R: Pickers<br>W: Order API | Non-INTERNAL location causes phantom reservation. | Verified |
| `lot_id` | `uuid` | Yes | FK to `inv_lots(id)` | Specific batch allocated (auto-assigned via FEFO). | R: Pickers<br>W: Order API | Assigning expired lot violates Invariant 4. | Verified |
| `quant_id` | `uuid` | Yes | FK to `inv_stock_quants(id)` | Specific stock quant bucket reserved. | R: Ledger<br>W: System | Quant mismatch causes double reservation. | Verified |
| `quantity` | `numeric(12,3)` | No | $> 0` | Quantity locked for order (e.g. `2.000` bottles). | R: Ledger<br>W: Order API | Zero or negative quantity breaks invariant. | Verified |
| `state` | `varchar(12)` | No | Default `RESERVED` | State: `RESERVED`, `CONFIRMED`, `PICKED`, `DELIVERED`, `CANCELLED`, `EXPIRED`. | R: All<br>W: State Engine | Releasing already delivered reservation creates phantom stock. | Verified |
| `expires_at` | `timestamptz` | No | Indexed | Timestamp when unconfirmed reservation will be released. | R: Worker<br>W: Order API | Missing timestamp creates indefinite ghost locks. | Verified |
| `created_by` | `varchar(100)` | No | None | System user, customer app ID, or cashier identifier. | R: Audit<br>W: Order API | Empty user breaks audit trail. | Verified |
| `created_at` | `timestamptz` | No | Default `now()` | Timestamp reservation was locked. | R: Audit<br>W: System | None. | Verified |
| `updated_at` | `timestamptz` | No | Default `now()` | Timestamp of state transition. | R: Audit<br>W: System | None. | Verified |

---

## 5. Table: `inv_stock_scrap`

Audited write-offs for damaged, expired, or spoiled goods requiring independent approval.

| Column | SQL Type | Nullable | Constraints & FK | Business Meaning & FreshMart Example | Read/Write Roles | Breaking Condition | Audit Verdict |
|---|---|---|---|---|---|---|---|
| `id` | `uuid` | No | PK, `gen_random_uuid()` | Immutable scrap record identifier. | R: All<br>W: System | Duplicate PK. | Verified |
| `product_id` | `uuid` | No | FK to product | Damaged product being written off. | R: QA, Audit<br>W: Requester | Missing product. | Verified |
| `lot_id` | `uuid` | Yes | FK to `inv_lots(id)` | Specific expired batch being scrapped. | R: QA, Audit<br>W: Requester | Null for non-lotted goods. | Verified |
| `source_location_id` | `uuid` | No | FK to `inv_locations(id)` | Physical shelf where damaged item was found. | R: Audit<br>W: Requester | Non-existent location. | Verified |
| `scrap_location_id` | `uuid` | No | FK to `inv_locations(id)` | Scrap disposal bin (`type = SCRAP`). | R: Audit<br>W: Requester | Internal location used as scrap hides loss. | Verified |
| `quantity` | `numeric(12,3)` | No | $> 0` | Physical units scrapped (e.g. `5.000` broken jars). | R: Audit<br>W: Requester | Quantity $> \text{Available}$ overdrafts shelf stock. | Verified |
| `reason` | `varchar(50)` | No | Check reason codes | Reason: `EXPIRED_LOT`, `DAMAGED_CARTON`, `TEMPERATURE_FAIL`. | R: Management<br>W: Requester | Invalid reason prevents insurance claims. | Verified |
| `state` | `varchar(20)` | No | Default `PENDING_APPROVAL` | `PENDING_APPROVAL`, `APPROVED`, `REJECTED`. | R: All<br>W: Manager | Auto-approving without second persona enables fraud. | Verified |
| `requested_by` | `varchar(100)` | No | None | Employee discovering damage (e.g. `clerk-ramesh`). | R: Audit<br>W: Requester | Empty user. | Verified |
| `approved_by` | `varchar(100)` | Yes | None | Store Manager signing off (must $\neq \text{requested\_by}$). | R: Audit<br>W: Manager | Same user approval violates anti-fraud invariant. | Verified |
| `rejected_by` | `varchar(100)` | Yes | None | Auditor rejecting write-off if stock is intact. | R: Audit<br>W: Auditor | None. | Verified |
| `stock_move_id` | `uuid` | Yes | FK to `inv_stock_moves(id)` | Double-entry movement created upon approval. | R: Audit<br>W: System | Null while in `APPROVED` state violates ledger audit. | Verified |
| `created_at` | `timestamptz` | No | Default `now()` | Timestamp request was initiated. | R: Audit<br>W: System | None. | Verified |
| `updated_at` | `timestamptz` | No | Default `now()` | Timestamp of manager decision. | R: Audit<br>W: System | None. | Verified |

---

## 6. Table: `inv_stock_counts`

Header record for physical cycle counts and inventory audits.

| Column | SQL Type | Nullable | Constraints & FK | Business Meaning & FreshMart Example | Read/Write Roles | Breaking Condition | Audit Verdict |
|---|---|---|---|---|---|---|---|
| `id` | `uuid` | No | PK, `gen_random_uuid()` | Immutable count audit identifier. | R: All<br>W: System | Duplicate PK. | Verified |
| `count_number` | `varchar(50)` | No | Unique, Indexed | Reference code (e.g. `CNT-20261015-001`). | R: Audit<br>W: System | Duplicate count number. | Verified |
| `warehouse_id` | `uuid` | No | FK to `inv_warehouses(id)` | Store being audited (e.g. FreshMart Store 02). | R: All<br>W: Auditor | Missing warehouse. | Verified |
| `location_id` | `uuid` | No | FK to `inv_locations(id)` | Specific aisle or cold room counted. | R: Auditor<br>W: Auditor | Missing location. | Verified |
| `counted_by` | `varchar(100)` | No | None | Physical auditor name (e.g. `auditor-sharma`). | R: Audit<br>W: Auditor | Anonymous count breaks accountability. | Verified |
| `state` | `varchar(15)` | No | Default `DRAFT` | `DRAFT` (counting), `REVIEW`, `POSTED`, `CANCELLED`. | R: All<br>W: Auditor | Modifying lines of `POSTED` count corrupts baseline. | Verified |
| `notes` | `text` | Yes | None | Audit scope description or shift notes. | R: Audit<br>W: Auditor | None. | Verified |
| `created_at` | `timestamptz` | No | Default `now()` | Snapshot generation timestamp. | R: Audit<br>W: System | None. | Verified |
| `updated_at` | `timestamptz` | No | Default `now()` | Decision timestamp. | R: Audit<br>W: System | None. | Verified |

---

## 7. Table: `inv_stock_count_lines`

Itemized comparison between system baseline and physical count.

| Column | SQL Type | Nullable | Constraints & FK | Business Meaning & FreshMart Example | Read/Write Roles | Breaking Condition | Audit Verdict |
|---|---|---|---|---|---|---|---|
| `id` | `uuid` | No | PK, `gen_random_uuid()` | Line item identifier. | R: All<br>W: System | Duplicate PK. | Verified |
| `count_id` | `uuid` | No | FK to `inv_stock_counts(id)` | Parent count header reference. | R: All<br>W: System | Orphaned line item. | Verified |
| `product_id` | `uuid` | No | FK to product | Item audited. | R: All<br>W: Auditor | Missing product. | Verified |
| `lot_id` | `uuid` | Yes | FK to `inv_lots(id)` | Batch identified on shelf during audit. | R: All<br>W: Auditor | Null for non-lotted products. | Verified |
| `system_quantity` | `numeric(12,3)` | No | Default `0.000` | Quant balance frozen at count initialization. | R: Audit<br>W: System | Mutating system quantity post-creation falsifies baseline. | Verified |
| `counted_quantity` | `numeric(12,3)` | No | Default `0.000` | Actual units physically discovered on shelf. | R: Audit<br>W: Auditor | Negative counted quantity. | Verified |
| `variance_quantity` | `numeric(12,3)` | No | Calculated: $\text{Counted} - \text{System}$ | Discrepancy units ($\Delta > 0$ gain, $\Delta < 0$ loss). | R: Audit<br>W: System | Manual tampering with variance formula. | Verified |
| `notes` | `text` | Yes | None | Explanatory note (e.g. `Box damaged behind shelf`). | R: Audit<br>W: Auditor | None. | Verified |

---

## 8. Modifications to Existing Tables (`inv_stock_moves` & `inv_stock_quants`)

### Columns Added to `inv_stock_moves`
- `lot_id`: `uuid` (Nullable, FK to `inv_lots(id)`, Indexed). Assigns movements to traceable product batches.
- `transfer_id`: `uuid` (Nullable, FK to `inv_transfers(id)`, Indexed). Links double-entry dispatch and receipt legs to the parent transfer order.

### Columns Added to `inv_stock_quants`
- `lot_id`: `uuid` (Nullable, FK to `inv_lots(id)`). Partitioning key: allows multiple distinct lots of the same product to coexist at a single location with separate balances and expiration dates.
- Constraint updated: `UNIQUE (product_id, location_id, lot_id, variant_id)` enforces strict quant uniqueness.
