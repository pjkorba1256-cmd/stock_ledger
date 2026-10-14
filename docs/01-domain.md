# Domain Brief: Inventory I — The Stock Ledger

## 1. The Inventory Problem Explained (Retail Primer)

Imagine a local grocery store owner, Ramesh. On Monday morning, Ramesh's warehouse receives **40 bags of Basmati rice** from a wholesale vendor. By Friday afternoon, a customer wants to buy 10 bags. 

In a naive retail software system, inventory is just a single editable number in a database column: `rice_stock = 40`.
- As sales happen, cashiers decrement the number. 
- But when Ramesh inspects the physical shelf on Friday, he counts **only 27 bags**, while his computer screen says **31 bags**. Four bags have vanished.

**Without an auditable ledger, Ramesh cannot answer:**
1. *When* did the 4 bags leave the shelf?
2. *Who* authorized the deduction? Was it cashier theft, customer shoplifting, expired/damaged stock tossed in the dumpster, or a stock transfer to his second branch in another neighborhood?
3. Did the supplier actually deliver 40 bags on Monday, or did they only deliver 36 and the receiving clerk failed to verify?

This is the **Inventory Problem**. When stock is tracked as a mutable counter, errors compound silently. By the end of the quarter, financial statements are distorted, working capital is tied up in ghost stock, or customers face embarrassing stockouts for items listed as "In Stock" online.

---

## 2. Who Uses the Inventory Module & Their Goals

| User Persona | Role & Daily Responsibilities | Core System Goal |
| :--- | :--- | :--- |
| **Shop Owner / Merchant** | Business owner monitoring cash flow, profitability, and customer satisfaction. | Ensure physical assets match book value; prevent theft; maintain working capital without stockouts. |
| **Storekeeper / Warehouse Clerk** | Operates receiving docks, shelf put-away, and physical pallet picking. | Quickly record incoming supplier shipments (**GRN**), internal shelf-to-shelf transfers, and outgoing order packs. |
| **Procurement Manager** | Reorders products from manufacturers and distributors based on stock levels. | Accurate visibility into **Available** stock (free to sell) versus stock already committed to pending customer orders (**Reserved**). |
| **Financial Auditor / Inspector** | Verifies tax compliance, asset valuation, and balance sheet integrity. | Audit complete historical chain of custody: prove every inventory balance originated from legitimate, signed transactions. |

---

## 3. Real-World Consequences of Incorrect Stock Balances

1. **Stockouts & Lost Revenue**: Customers order items online or visit the store, only to find empty shelves. They buy from competitors instead.
2. **Overselling & Customer Churn**: A website sells 10 laptops when only 2 exist. The merchant must cancel orders, refund payments, and suffer negative online reviews.
3. **Undetected Shrinkage (Theft & Damage)**: Without location-level audit trails, employees or shoplifters steal inventory without triggering an immediate alarm.
4. **Working Capital Deadlock**: Purchasing teams re-order inventory that actually exists but is misplaced in the wrong bin, trapping critical business capital.

---

## 4. How the Stock Ledger Solves the Problem: The Odoo Double-Entry Model

Just as accounting uses **double-entry bookkeeping** (money never appears or disappears; every debit has an equal credit), modern inventory systems like **Odoo** and **The Stock Ledger** treat inventory as vector transfers between locations:

$$(SourceLocation \xrightarrow{Quantity} DestinationLocation)$$

- When Ramesh receives 40 rice bags from a vendor, inventory moves from a virtual vendor location to his physical storage rack:
  $$\text{Vendor Partner (SUPPLIER)} \xrightarrow{40} \text{Main Rack A-01 (INTERNAL)}$$
- When Ramesh transfers 5 bags to the storefront display shelf:
  $$\text{Main Rack A-01 (INTERNAL)} \xrightarrow{5} \text{Store Shelf S-03 (INTERNAL)}$$
- When 1 bag is torn and ruined by rain:
  $$\text{Store Shelf S-03 (INTERNAL)} \xrightarrow{1} \text{Scrap Location (SCRAP)}$$

Every change is an immutable entry in [`inv_stock_moves`](file:///d:/P02-Stock-Ledger/docs/02-data-dictionary.md#3-table-inv_stock_moves). Physical on-hand stock (`inv_stock_quants`) is simply the real-time cache of all completed ledger movements.

---

## 5. Stock-on-Hand Formula & Reserved Invariant

At any physical location:

$$\text{On-Hand Stock} = \sum (\text{Completed Inward Moves}) - \sum (\text{Completed Outward Moves})$$

$$\text{Available to Promise (ATP)} = \text{On-Hand Stock} - \text{Reserved Quantity} \ge 0$$

- **On-Hand (`quantity`)**: Physical units physically present on the warehouse shelf.
- **Reserved (`reserved_quantity`)**: Units earmarked for pending shipments or sales orders not yet dispatched.
- **Available**: Units that can be safely promised to new buyers without risking stockouts.

---

## 6. Glossary of 20 Core Business Terms

1. **Stock Keeping Unit (SKU)**: Unique scannable code identifying a distinct product variant.
2. **Stock Quant (`inv_stock_quants`)**: Snapshot record storing the current quantity of a specific product at a specific location.
3. **Stock Move (`inv_stock_moves`)**: Atomic vector movement transferring goods between two locations.
4. **On-Hand Quantity**: Physical units present in a physical warehouse location.
5. **Reserved Quantity**: Soft-allocated units committed to confirmed orders.
6. **Available Quantity**: Free-to-promise balance ($\text{On-Hand} - \text{Reserved}$).
7. **Internal Location**: Physical storage zone owned by the merchant (aisle, rack, bin, pallet).
8. **Supplier Location**: Virtual counterpart location representing an external vendor.
9. **Customer Location**: Virtual counterpart location representing external buyers.
10. **Loss / Adjustment Location**: Virtual balancing location used to write off inventory variances.
11. **Scrap Location**: Virtual location for unsellable, damaged, or expired stock.
12. **Transit Location**: Intermediate location for tracking goods in transit between warehouses.
13. **Goods Receipt Note (GRN)**: Proof of receipt of supplier goods into the warehouse.
14. **Delivery Order (DO)**: Outward movement delivering goods to a customer.
15. **Double-Entry Inventory**: Mathematical principle where every movement credits one location and debits another.
16. **Cycle Count**: Periodic physical counting of specific warehouse sections without halting entire operations.
17. **Shrinkage**: Loss of inventory due to employee theft, shoplifting, damage, or counting errors.
18. **Lead Time**: Time elapsed between placing a purchase order and receiving physical goods.
19. **Safety Stock**: Buffer inventory maintained to absorb supplier delays or sudden demand spikes.
20. **Reconciliation**: Automated mathematical check verifying that snapshot balances equal the ledger sum.

---

## 7. Verbal Interview Questions & Concise Answers (P02 Problem Statement)

### Q1: Why can't we just update a single `quantity` column when an item is sold?
> **Answer**: A mutable counter destroys historical context. You cannot prove who changed the value, when the change happened, whether it was a sale, a return, or theft, or how to undo an erroneous update. The ledger preserves an immutable, forensic audit trail.

### Q2: Why does every move require both a source and destination location?
> **Answer**: To enforce the **Law of Conservation of Inventory**. Goods never appear or disappear from thin air. Vendor receipts originate at a virtual `SUPPLIER` location, and customer sales terminate at a virtual `CUSTOMER` location, keeping total system mass balanced.

### Q3: Why does `inv_stock_quants` exist if we can sum the movement ledger?
> **Answer**: Performance. Aggregating millions of movement rows on every product lookup takes seconds and collapses database throughput. Quants act as an $O(1)$ sub-millisecond read-cache that is validated periodically against the movement ledger.

### Q4: What prevents two cashiers from selling the last available unit simultaneously?
> **Answer**: Concurrency control via PostgreSQL pessimistic locking (`SELECT ... FOR UPDATE`) on the quant row within an atomic database transaction. The first cashier locks the row, validates balance, decrements stock, and commits; the second cashier sees 0 available stock and is rejected.

### Q5: Can a completed (`DONE`) movement ever be deleted or updated?
> **Answer**: Never. Completed ledger entries are strictly immutable. Correcting a past mistake requires posting an explicit compensatory movement (e.g., an `ADJUSTMENT` or `RETURN` move), ensuring that financial auditors can inspect the complete timeline.
