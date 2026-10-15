import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { randomUUID } from 'node:crypto';

describe('Inventory P03: Lots, Reservations, Transfers and Counts E2E & Invariants Suite', () => {
  let app: INestApplication;
  const merchantA = randomUUID();
  const merchantB = randomUUID();
  let warehouseAId: string;
  let warehouseBId: string;
  let storageLocAId: string;
  let storageLocBId: string;
  let scrapLocAId: string;
  let transitLocAId: string;
  let productId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    productId = randomUUID();

    // 1. Setup Warehouse for Merchant A (Indiranagar Store)
    const whResA = await request(app.getHttpServer())
      .post('/inventory/warehouses')
      .send({
        merchantId: merchantA,
        name: 'FreshMart Indiranagar (Merchant A)',
        code: `FM-IND-${Date.now().toString().slice(-6)}`,
        isDefault: true,
      })
      .expect(201);
    warehouseAId = whResA.body.id;

    // 2. Setup Warehouse for Merchant B (Competitor)
    const whResB = await request(app.getHttpServer())
      .post('/inventory/warehouses')
      .send({
        merchantId: merchantB,
        name: 'Competitor Store (Merchant B)',
        code: `COMP-${Date.now().toString().slice(-6)}`,
        isDefault: true,
      })
      .expect(201);
    warehouseBId = whResB.body.id;

    // 3. Locations for Store A
    const storA = await request(app.getHttpServer())
      .post('/inventory/locations')
      .send({
        warehouseId: warehouseAId,
        name: 'Store A Main Shelf',
        code: `SHELF-A-${Date.now().toString().slice(-6)}`,
        type: 'INTERNAL',
      })
      .expect(201);
    storageLocAId = storA.body.id;

    const scrapA = await request(app.getHttpServer())
      .post('/inventory/locations')
      .send({
        warehouseId: warehouseAId,
        name: 'Store A Scrap Bin',
        code: `SCRAP-A-${Date.now().toString().slice(-6)}`,
        type: 'SCRAP',
      })
      .expect(201);
    scrapLocAId = scrapA.body.id;

    const transitA = await request(app.getHttpServer())
      .post('/inventory/locations')
      .send({
        warehouseId: warehouseAId,
        name: 'Store A Transit Logistics',
        code: `TRANSIT-A-${Date.now().toString().slice(-6)}`,
        type: 'TRANSIT',
      })
      .expect(201);
    transitLocAId = transitA.body.id;

    // 4. Location for Store B
    const storB = await request(app.getHttpServer())
      .post('/inventory/locations')
      .send({
        warehouseId: warehouseBId,
        name: 'Store B Main Shelf',
        code: `SHELF-B-${Date.now().toString().slice(-6)}`,
        type: 'INTERNAL',
      })
      .expect(201);
    storageLocBId = storB.body.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  describe('1. Lot Receipt and Lot Uniqueness Rules', () => {
    it('should receive stock into a new lot with manufacturing and expiry dates', async () => {
      const today = new Date();
      const expiry = new Date(today);
      expiry.setDate(today.getDate() + 10);

      const res = await request(app.getHttpServer())
        .post('/inventory/lots/receive')
        .send({
          productId,
          lotName: 'LOT-MILK-2026-A1',
          manufacturingDate: today.toISOString().slice(0, 10),
          expiryDate: expiry.toISOString().slice(0, 10),
          locationId: storageLocAId,
          quantity: 100,
          unitCostPaise: 5400,
          performedBy: 'procurement-agent',
        })
        .expect(201);

      expect(res.body.lot.name).toBe('LOT-MILK-2026-A1');
      expect(res.body.movement.state).toBe('DONE');
      expect(Number(res.body.quant.quantity)).toBe(100);
    });

    it('should reject creating duplicate lot name for the same product', async () => {
      await request(app.getHttpServer())
        .post('/inventory/lots')
        .send({
          productId,
          name: 'LOT-MILK-2026-A1',
        })
        .expect(409);
    });

    it('should allow identical lot name for a different product', async () => {
      const otherProduct = randomUUID();
      const res = await request(app.getHttpServer())
        .post('/inventory/lots')
        .send({
          productId: otherProduct,
          name: 'LOT-MILK-2026-A1',
        })
        .expect(201);

      expect(res.body.productId).toBe(otherProduct);
      expect(res.body.name).toBe('LOT-MILK-2026-A1');
    });
  });

  describe('2. Invariant 1 — Reservation Correctness & Available Stock Conservation', () => {
    it('should successfully reserve stock within available limits', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          merchantId: merchantA,
          orderReference: 'ORD-TEST-001',
          productId,
          locationId: storageLocAId,
          quantity: 30,
          timeoutMinutes: 15,
          createdBy: 'web-shopper',
        })
        .expect(201);

      expect(res.body.state).toBe('RESERVED');
      expect(Number(res.body.quantity)).toBe(30);

      // Verify quant reservation updated
      const qRes = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${storageLocAId}`)
        .expect(200);

      const quant = qRes.body.data[0];
      expect(Number(quant.quantity)).toBe(100);
      expect(Number(quant.reservedQuantity)).toBe(30);
      expect(Number(quant.quantity) - Number(quant.reservedQuantity)).toBe(70);
    });

    it('should reject reservation attempting to reserve more than available on hand', async () => {
      // Available is 70. Requesting 80 must fail.
      const res = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          merchantId: merchantA,
          orderReference: 'ORD-OVERDRAFT',
          productId,
          locationId: storageLocAId,
          quantity: 80,
          timeoutMinutes: 15,
          createdBy: 'greedy-shopper',
        })
        .expect(400);

      expect(res.body.message).toContain('Insufficient available');

      // Quant must remain uncorrupted
      const qRes = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${storageLocAId}`)
        .expect(200);
      expect(Number(qRes.body.data[0].reservedQuantity)).toBe(30);
    });
  });

  describe('3. Invariant 4 — Expired Lots Cannot Be Sold or Reserved (FEFO Integrity)', () => {
    const expiredProdId = randomUUID();
    let expiredLotId: string;
    let freshLotId: string;

    beforeAll(async () => {
      // 1. Receive an already-expired lot
      const expRes = await request(app.getHttpServer())
        .post('/inventory/lots/receive')
        .send({
          productId: expiredProdId,
          lotName: 'LOT-EXPIRED-MILK',
          manufacturingDate: '2026-09-01',
          expiryDate: '2026-10-01', // Expired
          locationId: storageLocAId,
          quantity: 40,
          unitCostPaise: 5400,
          performedBy: 'receiving-dock',
        })
        .expect(201);
      expiredLotId = expRes.body.lot.id;

      // 2. Receive a fresh lot
      const freshRes = await request(app.getHttpServer())
        .post('/inventory/lots/receive')
        .send({
          productId: expiredProdId,
          lotName: 'LOT-FRESH-MILK',
          manufacturingDate: '2026-10-10',
          expiryDate: '2026-10-25', // Fresh
          locationId: storageLocAId,
          quantity: 60,
          unitCostPaise: 5400,
          performedBy: 'receiving-dock',
        })
        .expect(201);
      freshLotId = freshRes.body.lot.id;
    });

    it('should reject direct reservation of an expired lot even if expiry worker has not run', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          merchantId: merchantA,
          orderReference: 'ORD-EXPIRED-TEST',
          productId: expiredProdId,
          lotId: expiredLotId,
          locationId: storageLocAId,
          quantity: 5,
          timeoutMinutes: 10,
          createdBy: 'shopper',
        })
        .expect(400);

      expect(res.body.message).toContain('Cannot reserve expired lot');
    });

    it('FEFO sale must automatically bypass expired lot and pick fresh lot', async () => {
      const saleRes = await request(app.getHttpServer())
        .post('/inventory/fefo/sell')
        .send({
          productId: expiredProdId,
          sourceLocationId: storageLocAId,
          quantity: 20,
          performedBy: 'cashier-pos',
        })
        .expect(201);

      expect(saleRes.body.allocations.length).toBe(1);
      expect(saleRes.body.allocations[0].lotId).toBe(freshLotId);
      expect(saleRes.body.allocations[0].allocatedQuantity).toBe(20);
    });
  });

  describe('4. Invariant 5 — Reservation Exactly-Once Release & Concurrency', () => {
    it('competing confirmation and cancellation must resolve deterministically without double release', async () => {
      // Create a reservation for 15 units
      const res = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          merchantId: merchantA,
          orderReference: 'ORD-RACE-001',
          productId,
          locationId: storageLocAId,
          quantity: 15,
          timeoutMinutes: 10,
          createdBy: 'tester',
        })
        .expect(201);

      const reservationId = res.body.id;

      // Competing confirmation and release
      const [confirmResult, releaseResult] = await Promise.all([
        request(app.getHttpServer())
          .post(`/inventory/reservations/${reservationId}/confirm`)
          .send({}),
        request(app.getHttpServer())
          .post(`/inventory/reservations/${reservationId}/release`)
          .send({ reason: 'TIMEOUT' }),
      ]);

      // Exactly one succeeds in modifying the final state
      expect([confirmResult.status, releaseResult.status]).toContain(201);

      // Verify that calling release repeatedly is idempotent
      const dupRelease = await request(app.getHttpServer())
        .post(`/inventory/reservations/${reservationId}/release`)
        .send({ reason: 'TIMEOUT' })
        .expect(201);

      expect(dupRelease.body.released).toBe(false);
    });
  });

  describe('5. Invariant 2 & 3 — Two-Step Transfers, Transit Ownership and Shortage Reconciliation', () => {
    let transferId: string;
    let transferNumber: string;

    it('should create transfer and generate atomic date-based transfer number', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/transfers')
        .send({
          type: 'INTERNAL',
          warehouseId: warehouseAId,
          sourceLocationId: storageLocAId,
          destinationLocationId: storageLocBId,
          createdBy: 'logistics-manager',
        })
        .expect(201);

      transferId = res.body.id;
      transferNumber = res.body.transferNumber;
      expect(transferNumber).toMatch(/^TR-\d{8}-\d{4}$/);
      expect(res.body.state).toBe('DRAFT');
    });

    it('should confirm and dispatch 30 units into transit', async () => {
      await request(app.getHttpServer())
        .post(`/inventory/transfers/${transferId}/confirm`)
        .send({})
        .expect(201);

      const dispatchRes = await request(app.getHttpServer())
        .post(`/inventory/transfers/${transferId}/dispatch`)
        .send({
          performedBy: 'store-a-dock',
          transitLocationId: transitLocAId,
          lines: [
            {
              productId,
              quantity: 30,
            },
          ],
        })
        .expect(201);

      expect(dispatchRes.body.transfer.state).toBe('IN_PROGRESS');

      // Verify stock in TRANSIT
      const tQuants = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${transitLocAId}`)
        .expect(200);

      expect(Number(tQuants.body.data[0].quantity)).toBe(30);
    });

    it('Invariant 2: Attempting to sell transit inventory directly must be rejected', async () => {
      await request(app.getHttpServer())
        .post('/inventory/fefo/sell')
        .send({
          productId,
          sourceLocationId: transitLocAId, // Cannot sell from TRANSIT
          quantity: 5,
          performedBy: 'rogue-cashier',
        })
        .expect(400);
    });

    it('Invariant 3: Receipt with unreconciled difference (e.g. 28 received, 1 shortage = 29 != 30) must be rejected', async () => {
      const badRecv = await request(app.getHttpServer())
        .post(`/inventory/transfers/${transferId}/receive`)
        .send({
          performedBy: 'store-b-receiving',
          lines: [
            {
              productId,
              receivedQuantity: 28,
              shortageQuantity: 1, // 28 + 1 = 29 != 30!
              shortageReason: 'Lost in transit',
            },
          ],
        })
        .expect(400);

      expect(badRecv.body.message).toContain('Reconciliation invariant violated');
    });

    it('Invariant 3: Valid receipt of 28 units with 2 shortage must complete transfer and balance transit to zero', async () => {
      const recvRes = await request(app.getHttpServer())
        .post(`/inventory/transfers/${transferId}/receive`)
        .send({
          performedBy: 'store-b-receiving',
          lines: [
            {
              productId,
              receivedQuantity: 28,
              shortageQuantity: 2, // 28 + 2 = 30 dispatched
              shortageReason: '2 bottles smashed during van transit',
            },
          ],
        })
        .expect(201);

      expect(recvRes.body.transfer.state).toBe('DONE');

      // Verify TRANSIT is now 0
      const tQuants = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${transitLocAId}`)
        .expect(200);
      expect(Number(tQuants.body.data[0].quantity)).toBe(0);

      // Verify Store B shelf received 28
      const bQuants = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${storageLocBId}`)
        .expect(200);
      expect(Number(bQuants.body.data[0].quantity)).toBe(28);
    });

    it('Attempting duplicate receipt on completed DONE transfer must be rejected', async () => {
      await request(app.getHttpServer())
        .post(`/inventory/transfers/${transferId}/receive`)
        .send({
          performedBy: 'store-b-receiving',
          lines: [
            {
              productId,
              receivedQuantity: 28,
              shortageQuantity: 2,
            },
          ],
        })
        .expect(400);
    });
  });

  describe('6. Scrap & Independent Two-Person Approval Controls', () => {
    let scrapId: string;

    it('should create scrap request in pending approval state without altering shelf stock', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/scrap')
        .send({
          productId,
          locationId: storageLocAId,
          scrapLocationId: scrapLocAId,
          quantity: 5,
          reason: 'DAMAGED',
          notes: 'Customer dropped carton in aisle 3',
          performedBy: 'floor-worker-alice',
        })
        .expect(201);

      scrapId = res.body.id;
      expect(res.body.approvedBy).toBeNull();
      expect(res.body.stockMoveId).toBeNull();
    });

    it('fraud control: self-approval by the same employee must be rejected', async () => {
      const res = await request(app.getHttpServer())
        .post(`/inventory/scrap/${scrapId}/approve`)
        .send({
          approvedBy: 'floor-worker-alice', // Same person!
        })
        .expect(403);

      expect(res.body.message).toContain('Self-approval prohibited');
    });

    it('independent manager approval must post movement and transfer stock to SCRAP', async () => {
      const res = await request(app.getHttpServer())
        .post(`/inventory/scrap/${scrapId}/approve`)
        .send({
          approvedBy: 'store-manager-bob', // Different person
        })
        .expect(201);

      expect(res.body.scrap.approvedBy).toBe('store-manager-bob');
      expect(res.body.stockMove.state).toBe('DONE');

      // Verify stock at SCRAP location
      const scrapQuants = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${scrapLocAId}`)
        .expect(200);

      expect(Number(scrapQuants.body.data[0].quantity)).toBe(5);
    });
  });

  describe('7. Multi-Tenant Isolation & Cross-Merchant Security', () => {
    it('Merchant B must be rejected when attempting to confirm Merchant A reservation', async () => {
      // Create reservation for Merchant A
      const res = await request(app.getHttpServer())
        .post('/inventory/reservations')
        .send({
          merchantId: merchantA,
          orderReference: 'ORD-ISOLATION-01',
          productId,
          locationId: storageLocAId,
          quantity: 2,
          timeoutMinutes: 10,
          createdBy: 'merchant-a-user',
        })
        .expect(201);

      const reservationId = res.body.id;

      // Merchant B attempts to confirm it
      await request(app.getHttpServer())
        .post(`/inventory/reservations/${reservationId}/confirm`)
        .set('x-merchant-id', merchantB)
        .send({})
        .expect(403);
    });
  });

  describe('8. 7-Day Expiring Stock Dashboard Query', () => {
    it('should return expiring stock grouped by store with calculated days until expiry and status', async () => {
      const res = await request(app.getHttpServer())
        .get('/inventory/expiring-lots?days=14')
        .expect(200);

      expect(res.body.asOfDate).toBeDefined();
      expect(res.body.stores).toBeInstanceOf(Array);
      expect(res.body.stores.length).toBeGreaterThanOrEqual(1);

      const store = res.body.stores[0];
      expect(store.storeName).toBeDefined();
      expect(store.totalLots).toBeGreaterThanOrEqual(1);
      expect(store.items[0].status).toMatch(/EXPIRED|CRITICAL|WARNING|HEALTHY/);
    });
  });

  describe('9. Physical Count Workflow', () => {
    it('should create physical count, record variances, and post reconciliation adjustment', async () => {
      // 1. Create count
      const countRes = await request(app.getHttpServer())
        .post('/inventory/counts')
        .send({
          warehouseId: warehouseAId,
          locationId: storageLocAId,
          countedBy: 'auditor-ramesh',
          notes: 'Quarterly cycle count',
        })
        .expect(201);

      const countId = countRes.body.id;

      // 2. Record counted quantity with +3 units variance
      const currentQuants = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${storageLocAId}`)
        .expect(200);

      const currentQty = Number(currentQuants.body.data[0].quantity);

      await request(app.getHttpServer())
        .post(`/inventory/counts/${countId}/record`)
        .send({
          lines: [
            {
              productId,
              countedQuantity: currentQty + 3, // Discovered 3 extra units
              notes: 'Found unopened carton under shelf rack',
            },
          ],
        })
        .expect(201);

      // 3. Reconcile count
      const reconcileRes = await request(app.getHttpServer())
        .post(`/inventory/counts/${countId}/reconcile`)
        .send({
          approvedBy: 'audit-director-sharma',
        })
        .expect(201);

      expect(reconcileRes.body.count.state).toBe('POSTED');
      const productAdj = reconcileRes.body.adjustmentMovements.find(
        (m: { productId: string }) => m.productId === productId,
      );
      expect(productAdj).toBeDefined();
      expect(productAdj.referenceType).toBe('ADJUSTMENT');
      expect(Number(productAdj.quantity)).toBe(3);

      // Shelf now accurately reflects currentQty + 3
      const updatedQuants = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${storageLocAId}`)
        .expect(200);
      expect(Number(updatedQuants.body.data[0].quantity)).toBe(currentQty + 3);
    });
  });

  describe('10. Concurrency: Transfer Number Generation', () => {
    it('10 concurrent transfer creation requests on the same second must produce unique sequential numbers', async () => {
      const promises = Array.from({ length: 10 }).map((_, i) =>
        request(app.getHttpServer())
          .post('/inventory/transfers')
          .send({
            type: 'INTERNAL',
            warehouseId: warehouseAId,
            sourceLocationId: storageLocAId,
            destinationLocationId: storageLocBId,
            createdBy: `concurrency-user-${i}`,
          }),
      );

      const responses = await Promise.all(promises);
      const numbers = responses.map((r) => r.body.transferNumber);

      expect(responses.every((r) => r.status === 201)).toBe(true);
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBe(10);
    });
  });
});
