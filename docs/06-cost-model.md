# Infrastructure Cost Model & Capacity Planning

## 1. Overview & Methodology

This cost model provides structured capacity estimates and infrastructure budgeting for deploying **Techvisk P02: The Stock Ledger** across three organizational tiers:
1. **Tier 1 (Small / Startup Pilot)**: Single warehouse, boutique e-commerce.
2. **Tier 2 (Medium / Growing Omnichannel)**: Regional fulfillment, 10–15 facilities.
3. **Tier 3 (Large / Enterprise Distribution)**: Nationwide supply chain with tens of millions of movements annually.

All estimates are based on current cloud provider pricing models (AWS / GCP / Supabase) with explicitly documented sizing assumptions.

---

## 2. Storage Mathematics & Data Growth Projections

### Row Sizing Analysis:
- **`inv_stock_moves`**:
  - Base payload (UUIDs, timestamps, numeric(14,3), varchar fields, notes): ~200 bytes/row
  - Indexes (`product_idx`, `source_idx`, `destination_idx`, PK): ~160 bytes/row
  - Total storage footprint per movement: **~360 bytes / movement**
- **`inv_stock_quants`**:
  - Bounded size: $O(\text{Products} \times \text{Locations})$.
  - Per quant row: ~180 bytes (including unique index).

### Data Growth Trajectory:

| Dataset Size | Raw Movement Data | Index Storage Footprint | Total Disk Space Required (incl. WAL & Logs) |
| :--- | :--- | :--- | :--- |
| **100,000 Movements** | 20 MB | 16 MB | ~100 MB |
| **1,000,000 Movements** | 200 MB | 160 MB | ~1 GB |
| **10,000,000 Movements** | 2 GB | 1.6 GB | ~10 GB |
| **50,000,000 Movements** | 10 GB | 8 GB | ~45 GB (with 30-day WAL & snapshots) |

---

## 3. Deployment Cost Tiers

### Tier 1: Small (Startup / Pilot)
- **Workload**: Up to 50,000 moves/month, 5,000 SKUs, 2 warehouses.
- **Infrastructure Architecture**:
  - Compute: Single container / VM (2 vCPU, 4 GB RAM) running NestJS & background worker.
  - Database: Managed PostgreSQL (t4g.small / db.t3.small, 2 vCPU, 2 GB RAM, 20 GB gp3 storage).
  - Cache / Queue: Redis Cloud free/hobby tier or integrated Memurai instance.
  - Frontend: Cloudflare Pages / Vercel (Free tier CDN).
- **Estimated Monthly Cost**: **$25 – $40 USD (approx. ₹2,100 – ₹3,400 INR)**.

---

### Tier 2: Medium (Growing Retailer / Regional Logistics)
- **Workload**: 1,000,000 moves/month, 50,000 SKUs, 15 warehouses.
- **Infrastructure Architecture**:
  - Compute: 2x NestJS API instances (4 vCPU, 8 GB RAM each) behind Application Load Balancer.
  - Dedicated Worker: 1x BullMQ background worker instance (2 vCPU, 4 GB RAM).
  - Database: AWS RDS PostgreSQL `db.m6g.large` (2 vCPU, 8 GB RAM, 100 GB gp3 storage with automated daily backups).
  - Cache / Queue: Managed ElastiCache Redis `cache.t4g.medium` (2 vCPU, 3.1 GB RAM).
  - CDN & Storage: S3 for audit export archives + CloudFront CDN.
- **Estimated Monthly Cost Breakdown**:
  - API & Worker Compute: $80
  - Managed PostgreSQL RDS: $120
  - Managed Redis: $35
  - Load Balancer & Traffic: $25
  - Storage & Backups: $10
  - **Total Monthly Cost**: **~$270 USD (approx. ₹22,500 INR)**.

---

### Tier 3: Large (Enterprise Omnichannel / National Hub)
- **Workload**: 20,000,000+ moves/month, 500,000 SKUs, 50+ warehouses, peak bursts of 500 orders/sec.
- **Infrastructure Architecture**:
  - Compute: Kubernetes (EKS / GKE) cluster with Horizontal Pod Autoscaling (HPA) scaling 4 to 12 API pods.
  - Database: AWS Aurora PostgreSQL Multi-AZ Cluster (4 vCPU, 16 GB RAM primary + 1 Read Replica for reporting and analytics, auto-scaling storage up to 500 GB).
  - Cache / Queue: High-availability Redis Cluster (Primary + Replica with automatic failover).
  - Observability: Datadog / OpenTelemetry metrics and structured audit logging.
- **Estimated Monthly Cost Breakdown**:
  - Kubernetes Compute & Control Plane: $350
  - Aurora PostgreSQL Multi-AZ + Replica: $680
  - Redis Multi-AZ Cluster: $140
  - Bandwidth, NAT & Ingress: $110
  - Enterprise Backups & Monitoring: $120
  - **Total Monthly Cost**: **~$1,400 USD (approx. ₹116,000 INR)**.

---

## 4. Cost Optimization Recommendations

1. **Table Partitioning**:
   Partitioning `inv_stock_moves` by month allows moving older partitions (e.g. movements older than 1 year) to cold compressed tablespaces or archival object storage, cutting database disk costs by up to 60%.

2. **Quant Read Caching**:
   Caching frequent read queries for fast-moving items in Redis reduces database CPU pressure, allowing a smaller database instance size to handle 3x higher throughput.

3. **Separate Read-Replica for Reconciliation**:
   Directing monthly or annual ledger reconciliation audits to a read replica prevents resource contention on primary transactional write nodes.
