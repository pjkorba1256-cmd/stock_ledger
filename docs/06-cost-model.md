# Cloud Infrastructure & Working Capital Cost Model: Inventory II

This document models the financial profile of running **Cora ERP — Inventory II (P03)** for FreshMart. It details both **cloud infrastructure operational expenses (OpEx)** across three store deployment tiers and the **working capital economic cost of locked inventory**.

All prices are quoted in **Indian Rupees (INR)** based on current AWS Asia Pacific (Mumbai, `ap-south-1`) cloud pricing ($1\text{ USD} \approx \text{\rupee}84\text{ INR}$).

---

## 1. Cloud Infrastructure Sizing & Monthly OpEx Tiers

| Cost Component | Small Tier (3 Stores)<br>*Pilot / Regional* | Medium Tier (25 Stores)<br>*FreshMart Production* | Large Tier (100 Stores)<br>*National Expansion* |
|---|---|---|---|
| **App Compute (ECS / EKS)** | 2x `t4g.small` (2GB, 2 vCPU)<br>₹2,400 / month | 4x `c6g.xlarge` (8GB, 4 vCPU)<br>₹24,800 / month | 8x `c6g.2xlarge` (16GB, 8 vCPU)<br>₹99,200 / month |
| **Database (Amazon RDS PG 16)** | `db.t4g.medium` (Multi-AZ, 50GB)<br>₹5,600 / month | `db.r6g.xlarge` (Multi-AZ, 250GB IOPS)<br>₹32,400 / month | `db.r6g.4xlarge` (Multi-AZ, 1TB Provisioned)<br>₹1,28,000 / month |
| **Cache & Queue (ElastiCache Redis)** | `cache.t4g.micro` (0.5GB)<br>₹1,100 / month | `cache.m6g.large` (Multi-AZ, 6.4GB)<br>₹9,800 / month | `cache.m6g.2xlarge` (Cluster, 26GB)<br>₹38,500 / month |
| **Network Egress & Load Balancer** | AWS ALB + 200 GB Egress<br>₹2,200 / month | AWS ALB + 2.5 TB Egress<br>₹14,500 / month | 2x ALB + 12 TB Egress<br>₹68,000 / month |
| **Storage & Backups (S3 + Glacier)** | 50 GB Daily Automated Snapshots<br>₹400 / month | 500 GB PITR Snapshots (35 Days)<br>₹3,200 / month | 3 TB Multi-Region Replication<br>₹18,500 / month |
| **Monitoring, Logs & APM** | CloudWatch Basic<br>₹800 / month | CloudWatch + X-Ray Trace Sampling<br>₹4,500 / month | Datadog Enterprise APM<br>₹24,000 / month |
| **Total Monthly Cloud OpEx** | **₹12,500 / month** | **₹89,200 / month** | **₹3,76,200 / month** |
| **Annualized Cloud Infrastructure** | **₹1,50,000 / year** | **₹10,70,400 / year** | **₹45,14,400 / year** |
| **Cost per Store per Month** | **₹4,166 / store** | **₹3,568 / store** | **₹3,762 / store** |

---

## 2. Working Capital & Economic Cost of Locked Inventory

Beyond server hosting, inefficient inventory management imposes severe **balance sheet costs**. When stock is locked in unreleased reservations, idle in transit, or rotting past expiration, it generates three distinct financial drains:

### 2.1 The Three Financial Penalties of Locked Stock

1. **Cost of Working Capital (WACC):** Capital tied up in stagnant inventory cannot be used to purchase fast-moving SKUs. Assumed FreshMart annual cost of capital is **12% p.a. (1.0% per month)**.
2. **Lost Margin from False Stockouts:** When available inventory is falsely zeroed out due to unreleased reservations or unaccounted transit stock, customers visiting stores or digital apps leave without purchasing. Gross margin loss is estimated at **22%**.
3. **Spoilage & Expiration Shrinkage:** Fresh dairy and cut produce have shelf lives of 3 to 7 days. Every day inventory sits unsold near expiration increases total scrap loss risk by **15% to 35%**.

---

## 3. Financial Impact Modeling: FreshMart 25-Store Retailer

### Baseline Parameters for FreshMart (25 Stores):
- Average Inventory Value per Store: ₹18,00,000
- Total Enterprise Inventory: ₹4,50,00,000 (₹4.50 Crore)
- Daily Quick-Commerce Orders across Chain: 15,000 orders/day
- Daily Abandoned Checkout Rate: 28% (4,200 abandoned carts)

### 3.1 Financial Comparison: 15-Minute BullMQ Timeout vs. 60-Minute Legacy Polling

| Economic Dimension | Legacy ERP (60-Min Polling) | Cora ERP P03 (15-Min BullMQ) | Net Monthly Financial Savings |
|---|---|---|---|
| **Average Locked Units (Daily)** | 840 units | 210 units | **630 units freed** |
| **Idle Capital Locked in Reservations** | ₹5,46,000 | ₹1,36,500 | **₹4,09,500 capital unblocked** |
| **Monthly Working Capital Financing Cost (12%)** | ₹5,460 | ₹1,365 | **₹4,095 / month** |
| **Monthly False Stockout Incidents** | 2,520 stockouts | 420 stockouts | **2,100 sales preserved** |
| **Monthly Lost Gross Margin (₹180 basket margin)** | ₹4,53,600 | ₹75,600 | **₹3,78,000 / month** |
| **Perishable Spoilage Reduction via FEFO (2.5% -> 0.8%)** | ₹11,25,000 | ₹3,60,000 | **₹7,65,000 / month** |
| **Total Monthly Economic Savings** | — | — | **₹11,47,095 / month** |
| **Annualized Working Capital Benefit** | — | — | **₹1,37,65,140 / year (₹1.37 Cr)** |

---

## 4. Return on Investment (ROI) Summary

$$\text{Annual Cloud OpEx (25 Stores)} = \text{\rupee}10,70,400$$
$$\text{Annual Balance Sheet Savings (Avoided Spoilage + Recovered Sales)} = \text{\rupee}1,37,65,140$$
$$\text{Net Annual Business Benefit} = \text{\rupee}1,26,94,740 \text{ (₹1.27 Crore)}$$
$$\text{ROI Multiple} = \frac{\text{\rupee}1,37,65,140}{\text{\rupee}10,70,400} = \mathbf{12.8\times \text{ Return on Software Infrastructure}}$$

By automating reservation expirations to 15 minutes, prioritizing perishable lots through FEFO, and tracking in-transit shipments through dedicated double-entry custody, Cora ERP delivers over **12.8 times its annual infrastructure cost in direct operational savings**.
