# Architectural Alternatives & Trade-off Analysis: Inventory II

This document evaluates five fundamental architectural decisions in the design and implementation of **Cora ERP — Inventory II (P03)**. Each trade-off analyzes the selected approach against its alternatives, detailing technical rationales, edge cases, and operational consequences.

---

## 1. Decision 1: Quant Reservation Counter vs. Dedicated Reservations Table

### Options Considered:
- **Option A (Scalar Counter on Quant Only):** Increment `inv_stock_quants.reserved_quantity` directly on checkout, with no separate reservation row.
- **Option B (Dedicated Reservations Table Only):** Calculate reserved quantity on-the-fly using `SELECT SUM(quantity) FROM inv_reservations WHERE state = 'RESERVED'`.
- **Option C (Hybrid Architecture — Selected):** Materialized `reserved_quantity` column on `inv_stock_quants` synchronized with discrete rows in `inv_reservations`.

### Trade-off Matrix:

| Evaluation Criteria | Option A (Quant Counter Only) | Option B (Reservations Table Only) | Option C (Hybrid Architecture — Chosen) |
|---|---|---|---|
| **Query Latency for Available Stock** | $\mathcal{O}(1)$ Direct row read | $\mathcal{O}(N)$ Aggregation scan across reservations | $\mathcal{O}(1)$ Direct row read |
| **Traceability to Customer Order** | None (Anonymous number) | Complete order audit trail | Complete order audit trail |
| **Timeout & Expiration Feasibility** | Impossible (cannot know which units expire when) | High (query by `expires_at`) | High (BullMQ delayed job targets specific reservation ID) |
| **Drift Risk** | Low | Zero | Managed via atomic transaction |

### Technical Justification:
Option C provides the microsecond performance required by high-traffic product browsing screens while maintaining full auditability. Every checkout hold creates an `inv_reservations` row linking the order reference, expiration timestamp, and user identity, while atomically incrementing `reserved_quantity` on the quant within the same transaction.

---

## 2. Decision 2: Global Lot Scope vs. Store-Scoped Lot Scope

### Options Considered:
- **Option A (Store-Scoped Lots):** Each store registers its own batch codes (e.g. Store 01 has `LOT-A`, Store 04 has independent `LOT-A`).
- **Option B (Product-Scoped Global Lots — Selected):** Unique composite constraint `(product_id, name)` in `inv_lots` across the entire enterprise.

### Trade-off Matrix:

| Evaluation Criteria | Option A (Store-Scoped Lots) | Option B (Product-Scoped Global Lots — Chosen) |
|---|---|---|
| **Inter-Store Transfers** | Requires lot re-mapping and new ID generation at destination | Seamless: Identical lot UUID moves from Store 01 to Store 04 |
| **Recall Traceability** | Fragmented across 25 store databases | Centralized: Single query identifies all 25 stores carrying contaminated batch |
| **Supplier Invoicing** | Redundant entries for same supplier batch | Normalized: Supplier invoice links to one canonical lot record |

### Technical Justification:
A manufacturer batch (e.g. Amul Milk Batch #892) is a physical reality that exists independently of store geography. Enforcing `UNIQUE (product_id, name)` ensures that when Store 01 dispatches 30 units of `LOT-MILK-2026-A1` to Store 04, the lot identity is perfectly preserved across the transit and destination quants without schema fragmentation.

---

## 3. Decision 3: Database Sequence vs. Transactional Counter Table for Transfer Numbers

### Options Considered:
- **Option A (PostgreSQL Native Sequence):** `CREATE SEQUENCE transfer_seq;` generating sequential integers.
- **Option B (UUID v4 Only):** Rely purely on raw UUIDs (e.g. `c7287c2a-c0b1-439d-83fd-39a3309588f1`).
- **Option C (Transactional Date-Bucket Counter Table — Selected):** `inv_transfer_counters` table with `FOR UPDATE` row lock per `date_prefix`.

### Trade-off Matrix:

| Evaluation Criteria | Option A (PostgreSQL Sequence) | Option B (UUID Only) | Option C (Counter Table — Chosen) |
|---|---|---|---|
| **Human Readability** | Moderate (just a raw number) | Unusable on paper delivery manifests | Excellent (`TR-20261015-0001`) |
| **Daily Sequence Reset** | Complex (requires nightly cron to reset sequence) | N/A | Automatic (keyed by date string `YYYYMMDD`) |
| **Gap-Free Guarantees** | Rollbacks leave gaps in sequence | N/A | Strictly gap-free when committed inside transaction |
| **Concurrency Throughput** | Very High (> 10,000 req/s) | Infinite | High (~1,500 req/s with row-level lock) |

### Technical Justification:
In physical freight logistics, truck drivers and store receivers cannot communicate via 36-character UUID strings. They require formatted, sequential bill-of-lading numbers resetting daily (`TR-YYYYMMDD-XXXX`). Option C ensures that concurrent transfer dispatches generate strictly sequential, collision-free numbers without requiring background cron resets.

---

## 4. Decision 4: Static Cost on Quant vs. FIFO/FEFO Cost Layers

### Options Considered:
- **Option A (Static Average Cost on Product):** Product record has a single mutable `cost_price_paise` column.
- **Option B (Quant-Level Lot Costing — Selected):** Each `inv_stock_quants` bucket retains the unit purchase cost from the lot Goods Receipt Note (GRN).
- **Option C (Full Perpetual FIFO/LIFO Accounting Layers):** Separate financial cost queues decoupled from physical storage bins.

### Trade-off Matrix:

| Evaluation Criteria | Option A (Product Average Cost) | Option B (Quant-Level Lot Costing — Chosen) | Option C (Perpetual Accounting Layers) |
|---|---|---|---|
| **Inventory Valuation Accuracy** | Poor (distorts margins when vendor prices fluctuate) | High (exact batch valuation linked to lot) | Highest |
| **Implementation Complexity** | Trivial | Moderate | Extremely High (requires complex ledger revaluations) |
| **FEFO Margin Alignment** | Disconnected from physical batch | Matched: Selling older lot realizes its true historical cost | Matched |

### Technical Justification:
In grocery retail, wholesale prices fluctuate weekly. Option B embeds `cost_price_paise` directly into the `inv_stock_quants` row created during lot receipt. When a lot is allocated under FEFO, the movement records the true batch acquisition cost, enabling precise profit margin calculation per store without the massive complexity of full perpetual financial accounting engines.

---

## 5. Decision 5: Dedicated Transit Location vs. Transfer Status Flag

### Options Considered:
- **Option A (Status Flag on Source Location):** Goods remain in source location with a flag `is_in_transit = true`.
- **Option B (Dedicated TRANSIT Location Type — Selected):** Stock moves via double-entry movements into a distinct `TRANSIT` location (`type = 'TRANSIT'`).

### Trade-off Matrix:

| Evaluation Criteria | Option A (Status Flag on Source) | Option B (Dedicated TRANSIT Location — Chosen) |
|---|---|---|
| **Double-Entry Compliance** | Fails (requires mutable status flag queries) | Full compliance ($\text{Store A} \xrightarrow{} \text{TRANSIT} \xrightarrow{} \text{Store B}$) |
| **Physical Reality Alignment** | Inaccurate (goods are on highway, not in Store A warehouse) | Accurate (freight carrier holds custody) |
| **Cycle Count Isolation** | Store A auditors will see transit stock in their physical inventory reports | Transit stock is physically isolated from store audits |
| **Shortage Auditing** | Difficult to isolate missing items | Direct: Shortage posts from `TRANSIT` to `LOSS` |

### Technical Justification:
Option B upholds the fundamental Odoo-style double-entry principle. Transit stock is not present in Store 01, nor is it present in Store 04. Placing it into a dedicated `TRANSIT` location guarantees that neither store's shelf audits or local sales engines can accidentally count or overdraft in-flight inventory.
