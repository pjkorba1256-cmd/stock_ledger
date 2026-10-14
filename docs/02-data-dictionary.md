# Data Dictionary: PostgreSQL Inventory Schema

Database: `p02_stock_ledger`  
ORM: Drizzle ORM  
Migration Engine: Drizzle Kit (`drizzle/0000_jittery_the_fury.sql`)

---

## 1. Table: `inv_warehouses`

Represents a merchant's physical fulfillment center or warehouse building.

| Column | Data Type | Nullable | Default | Constraints & Indexes | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | `PRIMARY KEY` | Globally unique warehouse identifier |
| `merchant_id` | `uuid` | No | None | Partial unique index | Merchant identifier owning this warehouse |
| `name` | `varchar(200)` | No | None | None | Human-readable name (e.g. `Main Fulfillment Hub`) |
| `code` | `varchar(20)` | No | None | `UNIQUE` | Unique short business identifier (e.g. `WA-MAIN`) |
| `address` | `jsonb` | Yes | `NULL` | None | Structured address (street, city, zip, geo) |
| `is_active` | `boolean` | No | `true` | None | Active status flag |
| `is_default` | `boolean` | No | `false` | None | Indicates merchant's primary warehouse |
| `created_at` | `timestamptz` | No | `NOW()` | None | Record creation timestamp |
| `updated_at` | `timestamptz` | No | `NOW()` | None | Record update timestamp |

### Indexes & Constraints:
- `inv_warehouses_code_unique`: `UNIQUE (code)`
- `inv_warehouses_one_default_per_merchant`: `CREATE UNIQUE INDEX ... ON inv_warehouses (merchant_id) WHERE is_default = true` (enforces at most one default warehouse per merchant).

---

## 2. Table: `inv_locations`

Represents physical or logical zones within a warehouse (shelves, racks, docks, supplier counterparties).

| Column | Data Type | Nullable | Default | Constraints & Indexes | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | `PRIMARY KEY` | Globally unique location identifier |
| `warehouse_id` | `uuid` | No | None | `FK -> inv_warehouses(id) ON DELETE RESTRICT` | Warehouse to which this zone belongs |
| `parent_location_id` | `uuid` | Yes | `NULL` | `FK -> inv_locations(id) ON DELETE RESTRICT`, Index | Parent zone for hierarchical locations |
| `name` | `varchar(200)` | No | None | None | Display name (e.g. `Aisle 4, Shelf B`) |
| `code` | `varchar(50)` | No | None | Unique per warehouse | Zone code (e.g. `AISLE-04-B`) |
| `type` | `varchar(20)` | No | None | `CHECK (type IN (...))` | Location domain classification |
| `barcode` | `varchar(100)` | Yes | `NULL` | None | Scannable location barcode |
| `sort_order` | `integer` | No | `0` | None | Custom picking path sort order |
| `is_active` | `boolean` | No | `true` | None | Active status flag |
| `created_at` | `timestamptz` | No | `NOW()` | None | Creation timestamp |
| `updated_at` | `timestamptz` | No | `NOW()` | None | Update timestamp |

### Indexes & Constraints:
- `inv_locations_warehouse_code_unique`: `UNIQUE (warehouse_id, code)`
- `inv_locations_no_self_parent`: `CHECK (id <> parent_location_id)`
- `inv_locations_type_check`: `CHECK (type IN ('INTERNAL', 'SUPPLIER', 'CUSTOMER', 'LOSS', 'SCRAP', 'TRANSIT'))`
- `inv_locations_parent_idx`: `CREATE INDEX ON inv_locations (parent_location_id)`

---

## 3. Table: `inv_stock_moves`

The immutable audit ledger recording every inventory transfer.

| Column | Data Type | Nullable | Default | Constraints & Indexes | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | `PRIMARY KEY` | Movement UUID |
| `reference_id` | `varchar(100)` | Yes | `NULL` | None | Upstream document ID (e.g. PO, SO, Return ID) |
| `reference_type` | `varchar(20)` | Yes | `NULL` | `CHECK (reference_type IN (...))` | Business category of movement |
| `product_id` | `uuid` | No | None | Composite Index `(product_id, done_date)` | Product identifier |
| `variant_id` | `uuid` | Yes | `NULL` | None | Optional SKU variant identifier |
| `lot_id` | `uuid` | Yes | `NULL` | None | Optional batch/lot identifier |
| `source_location_id` | `uuid` | No | None | `FK -> inv_locations(id)`, Index | Origin location |
| `destination_location_id` | `uuid` | No | None | `FK -> inv_locations(id)`, Index | Destination location |
| `quantity` | `numeric(14,3)` | No | None | `CHECK (quantity > 0)` | Quantity transferred (milli-unit precision) |
| `unit_cost_paise` | `bigint` | Yes | `NULL` | None | Unit cost in paise for FIFO/WAC valuation |
| `state` | `varchar(12)` | No | `'DRAFT'` | `CHECK (state IN (...))` | Current lifecycle state |
| `scheduled_date` | `timestamptz` | Yes | `NULL` | None | Expected execution date |
| `done_date` | `timestamptz` | Yes | `NULL` | None | Exact timestamp when posted to `DONE` |
| `transferId` | `uuid` | Yes | `NULL` | None | Optional parent transfer grouping |
| `performed_by` | `varchar(100)` | No | None | None | Operator username or service identifier |
| `notes` | `text` | Yes | `NULL` | None | Human-readable audit remarks |
| `created_at` | `timestamptz` | No | `NOW()` | None | Record creation timestamp |
| `updated_at` | `timestamptz` | No | `NOW()` | None | Record update timestamp |

### Indexes & Constraints:
- `inv_stock_moves_distinct_locations`: `CHECK (source_location_id <> destination_location_id)`
- `inv_stock_moves_quantity_positive`: `CHECK (quantity > 0)`
- `inv_stock_moves_reference_type_check`: `CHECK (reference_type IS NULL OR reference_type IN ('GRN', 'SALE', 'RETURN', 'TRANSFER', 'ADJUSTMENT', 'SCRAP'))`
- `inv_stock_moves_state_check`: `CHECK (state IN ('DRAFT', 'CONFIRMED', 'DONE', 'CANCELLED'))`
- `inv_stock_moves_product_idx`: `INDEX (product_id, done_date)`
- `inv_stock_moves_source_idx`: `INDEX (source_location_id)`
- `inv_stock_moves_destination_idx`: `INDEX (destination_location_id)`

---

## 4. Table: `inv_stock_quants`

High-speed physical stock snapshot table.

| Column | Data Type | Nullable | Default | Constraints & Indexes | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | `PRIMARY KEY` | Quant snapshot UUID |
| `product_id` | `uuid` | No | None | Unique Key | Product identifier |
| `variant_id` | `uuid` | Yes | `NULL` | Unique Key | Optional SKU variant identifier |
| `location_id` | `uuid` | No | None | `FK -> inv_locations(id)`, Unique Key | Physical storage location identifier |
| `lot_id` | `uuid` | Yes | `NULL` | Unique Key | Optional batch/lot identifier |
| `quantity` | `numeric(14,3)` | No | `'0'` | `CHECK (quantity >= 0)` | Physical on-hand stock quantity |
| `reserved_quantity` | `numeric(14,3)` | No | `'0'` | `CHECK (reserved_quantity >= 0)` | Soft-allocated stock for pending orders |
| `cost_price_paise` | `bigint` | Yes | `NULL` | None | Weighted average unit cost in paise |
| `last_count_date` | `timestamptz` | Yes | `NULL` | None | Date of most recent physical cycle count |
| `created_at` | `timestamptz` | No | `NOW()` | None | Creation timestamp |
| `updated_at` | `timestamptz` | No | `NOW()` | None | Update timestamp |

### Indexes & Constraints:
- `inv_stock_quants_product_variant_location_lot_unique`: `UNIQUE NULLS NOT DISTINCT (product_id, variant_id, location_id, lot_id)`
- `inv_stock_quants_quantity_nonneg`: `CHECK (quantity >= 0)`
- `inv_stock_quants_reserved_nonneg`: `CHECK (reserved_quantity >= 0)`
- `inv_stock_quants_reserved_le_quantity`: `CHECK (reserved_quantity <= quantity)`
