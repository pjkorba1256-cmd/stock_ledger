# Domain Brief: Inventory II — Lots, Reservations, Transfers and Counts

## 1. Executive Summary & The Retail Problem Explained

FreshMart operates 25 multi-category retail grocery stores across India. Its daily inventory spans fresh milk, dairy products, medicines, packaged foods, beverages, and household staples. 

In basic retail systems (such as P01/P02 implementations), inventory is tracked purely as a scalar quantity at a location:
$$\text{Product Quantity} = 100$$

For a multi-store grocery chain, knowing only that *100 units exist* is fundamentally inadequate. FreshMart faces critical operational questions:
- **Which batch does each unit belong to?** If Batch A expires in 2 days and Batch B expires in 20 days, selling Batch B first causes Batch A to spoil on the shelf, destroying merchant margins and generating waste.
- **Can this stock be legally sold?** Medicines and milk past their expiration date violate food safety and drug control regulations, risking regulatory fines and consumer harm.
- **Which units are physically present vs. promised?** If 20 units are committed to online quick-commerce orders awaiting packing, only 80 units are sellable to walk-in retail shoppers. Displaying 100 units leads to stockouts, cancelled orders, and lost customer trust.
- **Where is moving stock located?** When Store 01 dispatches 30 crates of milk to Store 04, those 30 crates are in a delivery truck on the highway. If counted as available at Store 01, Store 01 oversells; if counted at Store 04, Store 04 cashier scanners fail because the physical cartons have not arrived.
- **Why did a discrepancy occur, and who is accountable?** If 5 units vanish during a cycle count or are marked as scrap, was it genuine damage, refrigeration failure, shoplifting, or employee theft?

**The Core Business Principle:** Every stock balance change must have an immutable, verifiable business reason and an traceable double-entry inventory movement. Arbitrary edits to stock numbers are strictly prohibited.

---

## 2. FreshMart Business Context & Inventory Dynamics

FreshMart's 25 stores operate in a modern **omnichannel** retail environment:
1. **Walk-in Retail Cash & Carry:** Customers pick physical goods from store shelves and checkout at POS counters.
2. **Quick-Commerce Online Delivery:** App customers order online with 30-minute delivery promises. Stock is reserved immediately upon checkout, picked by floor pickers, and handed to delivery couriers.
3. **Inter-Store Logistics:** A centralized distribution hub and high-velocity flagship stores transfer excess stock to neighborhood convenience branches experiencing demand surges.
4. **Perishables & Traceability:** Dairy, fresh juice, and pharmaceuticals require end-to-end lot traceability from supplier Goods Receipt Note (GRN) to final customer basket.

---

## 3. Comprehensive Glossary of 20 Domain Terms

| # | Domain Term | Formal Definition & FreshMart Retail Context |
|---|---|---|
| 1 | **Lot (Batch)** | A distinct, traceable production run of a product sharing identical manufacturing conditions, vendor origin, production date, and expiration date. (e.g. `LOT-MILK-2026-A1`). |
| 2 | **FEFO (First Expired, First Out)** | An inventory allocation policy prioritizing the picking and sale of stock with the earliest expiration date, regardless of arrival sequence, to minimize spoilage write-offs. |
| 3 | **FIFO (First In, First Out)** | An allocation policy prioritizing the oldest received inventory based on receipt date, commonly applied to non-perishable goods. |
| 4 | **Transit Inventory** | Stock that has been physically dispatched from a source warehouse but has not yet been inspected and accepted at the destination warehouse. Held in a virtual `TRANSIT` location. |
| 5 | **Scrap** | Inventory identified as unusable due to expiration, physical breakage, contamination, or quality failure, written off into a designated `SCRAP` location. |
| 6 | **Cycle Count** | A recurring physical audit where warehouse personnel count a subset of inventory items on shelves without halting normal retail operations. |
| 7 | **Discrepancy (Variance)** | The mathematical difference between recorded system quantity and physically counted inventory: $\Delta = \text{Counted} - \text{System}$. |
| 8 | **Reservation** | A temporary programmatic hold placing a quantity of available stock on hold for a pending customer order reference. |
| 9 | **On Hand Quantity** | The total physical inventory present inside a warehouse or store location, regardless of commitments. |
| 10 | **Reserved Quantity** | The portion of on-hand inventory committed to outstanding customer orders, pending transfers, or processing. |
| 11 | **Available Quantity** | The net sellable inventory eligible for new customer reservations or immediate POS sales: $\text{Available} = \text{On Hand} - \text{Reserved}$. |
| 12 | **In Transit Quantity** | Inventory in custody of logistics carriers moving between locations; not sellable at either store. |
| 13 | **Expiration Date** | The regulatory date beyond which a perishable product or drug is unsafe or illegal for human consumption and must not be sold. |
| 14 | **Best Before Date** | The date until which a product maintains peak organoleptic quality, after which quality degrades though consumption remains non-toxic. |
| 15 | **Quarantine** | An isolated location where stock of suspect quality or pending laboratory testing is held without being sellable or dispatchable. |
| 16 | **Short Receipt** | An inter-store or vendor transfer where the quantity physically received at destination is less than the quantity dispatched from origin ($\text{Dispatched} = \text{Received} + \text{Shortage}$). |
| 17 | **Write-Off** | A formal accounting and ledger adjustment recognizing an inventory loss as an operational expense. |
| 18 | **Stock Ledger** | The immutable, double-entry financial and physical transaction journal recording all movements from source locations to destination locations. |
| 19 | **Stock Quant** | A unique materialized inventory bucket representing on-hand and reserved quantity for a specific product, variant, location, and lot tuple. |
| 20 | **Custody Transfer** | The legal and physical transfer of inventory responsibility from one carrier, store manager, or partner to another. |

---

## 4. In-Depth Answers to the 7 Core Business Questions

### Question 1: Why is on-hand inventory insufficient for grocery retail?
In grocery retail, tracking only scalar on-hand quantity fails because grocery inventory is heterogeneous. 100 units of milk do not have equal utility: 40 units may expire tomorrow, 60 units next week, 15 units may already be reserved for online quick-commerce delivery carts, and 5 units may be punctured or spoiled. Treating all 100 units as identical causes POS cashiers to sell fresh milk while near-expiry milk rots on shelves. It also leads to overselling committed orders, violating food safety laws by dispensing expired goods, and obscuring financial margins through unrecorded spoilage.

### Question 2: How does FEFO protect customer health and merchant margins?
FEFO (First Expired, First Out) algorithmically evaluates every quant's `expiry_date` at the moment of reservation or sale. Stock nearing expiration is dispatched first. 
- **Customer Health Protection:** The engine enforces a strict filter: any lot where $\text{expiry\_date} < \text{current\_date}$ is unconditionally excluded from allocation. Expired items cannot be added to retail orders or dispensed at checkout, eliminating food poisoning risks and consumer litigation.
- **Merchant Margin Protection:** By prioritizing lots expiring in 2–5 days over lots expiring in 15 days, FreshMart sells perishable inventory before it becomes total scrap loss, drastically reducing shrinkage write-offs and maximizing inventory turnover.

### Question 3: Why must transit inventory belong to neither store's sellable stock?
When Store 01 dispatches 30 crates of curd to Store 04, the crates are placed on a logistics truck.
- **If retained in Store 01's available stock:** Store 01's POS or online portal would sell goods that have physically left the building.
- **If added to Store 04's available stock prematurely:** Store 04's floor pickers would be sent to pick items that are still travelling on the highway, failing customer orders.
- **Ledger Invariant:** The stock must move into a dedicated `TRANSIT` location ($\text{Store 01} \xrightarrow{30} \text{TRANSIT}$). The logistics carrier possesses custody. Neither store can allocate or sell the stock until Store 04 completes a physical Goods Receipt Note.

### Question 4: What happens physically and ledger-wise when 30 units are dispatched and 28 arrive?
- **Physical Reality:** 30 units left Store 01. In transit, 2 bottles broke or were stolen. Store 04 receives 28 intact bottles.
- **Ledger Invariant:** The system **never** erases history by retrospectively editing the dispatch movement to 28. Changing historical records destroys logistics auditability.
- **Two-Step Reconciliation:**
  1. Receipt Movement: $\text{TRANSIT} \xrightarrow{28} \text{Store 04 Shelf}$ (State: `DONE`).
  2. Shortage Reconciliation Movement: $\text{TRANSIT} \xrightarrow{2} \text{Store 04 Loss/Variance}$ (Reference: `SHORTAGE`, State: `DONE`).
- **Mathematical Balance:**
  $$\text{Dispatched (30)} = \text{Received (28)} + \text{Shortage (2)}$$
  The `TRANSIT` quant balances cleanly to exactly $0.000$, and the 2 missing units are permanently audited against the freight carrier.

### Question 5: Why are reservation timeouts mandatory in omnichannel retail?
In omnichannel retail, online shoppers place items into digital carts or initiate checkout. Creating a reservation locks physical inventory (`reserved_quantity += requested_qty`), preventing other online buyers or walk-in retail shoppers from purchasing those items.
- If online shoppers abandon their carts without purchasing, and reservations had no timeout, those items would remain locked indefinitely as "ghost reservations."
- Physical stock sits on store shelves, walk-in shoppers are told the item is out of stock, and the retailer loses sales.
- **Mandatory Timeout:** Programmatic expiration (e.g. 15 minutes) ensures that if an order is not confirmed, background BullMQ workers atomically decrement `reserved_quantity`, restoring available stock to retail circulation without human intervention.

### Question 6: Why must cycle counts never silently overwrite quantities?
Overwriting a database quantity from `40` to `37` obscures the root cause of inventory loss. It conceals theft, vendor short-deliveries, and cashier errors, preventing operational remediation and falsifying cost-of-goods-sold (COGS) on financial statements.
- **Correct Workflow:** The cycle count creates a snapshot baseline (`system_quantity: 40`), records physical count (`counted_quantity: 37`), and calculates variance (`variance: -3`).
- **Audit Adjustment:** When approved by an auditor, the system posts an immutable double-entry `ADJUSTMENT` movement: $\text{Shelf} \xrightarrow{3} \text{Inventory Loss (LOSS)}$. The adjustment movement links to the cycle count number, timestamp, and approving officer.

### Question 7: How does two-person approval prevent scrap fraud?
Scrap represents inventory written off as zero-value waste. In unconstrained retail environments, corrupt employees engage in **write-off fraud**: an employee falsely marks valuable electronics or undamaged groceries as "broken" or "expired", removes the goods from the store, and sells them privately.
- **Independent Two-Person Control:** 
  1. Floor associate initiates a scrap request ($\text{State} = \text{PENDING\_APPROVAL}$). Shelf stock remains unadjusted.
  2. An independent store manager or auditor must physically inspect the scrap bin and sign off.
  3. The software cryptographically enforces: $\text{approved\_by} \neq \text{requested\_by}$. If the creator attempts to approve their own request, the system rejects it with `403 Forbidden`. Only upon independent manager approval does the system post the write-off movement into the `SCRAP` location.
