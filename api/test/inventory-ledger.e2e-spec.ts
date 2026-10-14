import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { randomUUID } from 'node:crypto';

describe('Inventory Stock Ledger E2E & Concurrency Suite (Stage G)', () => {
  let app: INestApplication;
  let warehouseId: string;
  let supplierLocationId: string;
  let storageLocationId: string;
  let packingLocationId: string;
  const merchantId = randomUUID();
  const productId = randomUUID();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // 1. Setup isolated test warehouse
    const whRes = await request(app.getHttpServer())
      .post('/inventory/warehouses')
      .send({
        merchantId,
        name: 'Stage G Test Warehouse',
        code: `WH-G-${Date.now().toString().slice(-6)}`,
        isDefault: false,
      })
      .expect(201);
    warehouseId = whRes.body.id;

    // 2. Setup SUPPLIER location
    const supRes = await request(app.getHttpServer())
      .post('/inventory/locations')
      .send({
        warehouseId,
        name: 'Vendor Source',
        code: `SUP-G-${Date.now().toString().slice(-6)}`,
        type: 'SUPPLIER',
      })
      .expect(201);
    supplierLocationId = supRes.body.id;

    // 3. Setup INTERNAL storage location
    const storRes = await request(app.getHttpServer())
      .post('/inventory/locations')
      .send({
        warehouseId,
        name: 'Main Storage Zone',
        code: `STOR-G-${Date.now().toString().slice(-6)}`,
        type: 'INTERNAL',
      })
      .expect(201);
    storageLocationId = storRes.body.id;

    // 4. Setup INTERNAL packing location
    const packRes = await request(app.getHttpServer())
      .post('/inventory/locations')
      .send({
        warehouseId,
        name: 'Packing Zone',
        code: `PACK-G-${Date.now().toString().slice(-6)}`,
        type: 'INTERNAL',
      })
      .expect(201);
    packingLocationId = packRes.body.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  describe('1. Movement Validation & Invariants', () => {
    it('should reject movement where source and destination are identical', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'TRANSFER',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: storageLocationId,
          quantity: 10,
          performedBy: 'tester',
        })
        .expect(400);

      expect(res.body.errors[0].message).toContain('must be different');
    });

    it('should reject non-positive quantity', async () => {
      await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'TRANSFER',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: packingLocationId,
          quantity: -5,
          performedBy: 'tester',
        })
        .expect(400);
    });

    it('should successfully create a valid DRAFT movement without changing quants', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'TRANSFER',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: packingLocationId,
          quantity: 15,
          performedBy: 'tester',
        })
        .expect(201);

      expect(res.body.state).toBe('DRAFT');
      expect(res.body.id).toBeDefined();
    });
  });

  describe('2. State Transitions & Immutability', () => {
    let moveId: string;

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'ADJUSTMENT',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: packingLocationId,
          quantity: 5,
          performedBy: 'tester',
        })
        .expect(201);
      moveId = res.body.id;
    });

    it('should reject posting a DRAFT movement directly', async () => {
      const res = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveId}/post`)
        .expect(400);

      expect(res.body.message).toContain('must be CONFIRMED before posting');
    });

    it('should transition DRAFT to CONFIRMED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveId}/confirm`)
        .expect(201);

      expect(res.body.state).toBe('CONFIRMED');
    });

    it('should transition DRAFT to CANCELLED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveId}/cancel`)
        .expect(201);

      expect(res.body.state).toBe('CANCELLED');
    });

    it('should reject confirming a CANCELLED movement', async () => {
      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveId}/cancel`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveId}/confirm`)
        .expect(400);

      expect(res.body.message).toContain('Cannot confirm movement in CANCELLED state');
    });
  });

  describe('3. Transactional Posting, Overdraft Prevention & Quant Updates', () => {
    it('should prevent overdraft when source has 0 inventory', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'TRANSFER',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: packingLocationId,
          quantity: 20,
          performedBy: 'tester',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${createRes.body.id}/confirm`)
        .expect(201);

      const postRes = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${createRes.body.id}/post`)
        .expect(400);

      expect(postRes.body.message).toContain('Insufficient stock');
    });

    it('should inward stock via GRN and update destination quant', async () => {
      const grnRes = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'GRN',
          productId,
          sourceLocationId: supplierLocationId,
          destinationLocationId: storageLocationId,
          quantity: 100,
          performedBy: 'vendor-receiver',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${grnRes.body.id}/confirm`)
        .expect(201);

      const postedGrn = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${grnRes.body.id}/post`)
        .expect(201);

      expect(postedGrn.body.state).toBe('DONE');

      const soh = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${storageLocationId}`)
        .expect(200);

      expect(Number(soh.body.data[0].quantity)).toBe(100);
    });

    it('should transfer stock between INTERNAL locations atomically', async () => {
      const transferRes = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'TRANSFER',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: packingLocationId,
          quantity: 30,
          performedBy: 'warehouse-staff',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${transferRes.body.id}/confirm`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${transferRes.body.id}/post`)
        .expect(201);

      const storageSoh = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${storageLocationId}`)
        .expect(200);
      expect(Number(storageSoh.body.data[0].quantity)).toBe(70);

      const packSoh = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${packingLocationId}`)
        .expect(200);
      expect(Number(packSoh.body.data[0].quantity)).toBe(30);
    });

    it('should enforce idempotency when re-posting a DONE movement', async () => {
      const moveRes = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'TRANSFER',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: packingLocationId,
          quantity: 10,
          performedBy: 'tester',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveRes.body.id}/confirm`)
        .expect(201);

      const firstPost = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveRes.body.id}/post`)
        .expect(201);
      expect(firstPost.body.state).toBe('DONE');

      const secondPost = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveRes.body.id}/post`)
        .expect(201);
      expect(secondPost.body.state).toBe('DONE');

      const storageSoh = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${productId}&locationId=${storageLocationId}`)
        .expect(200);
      expect(Number(storageSoh.body.data[0].quantity)).toBe(60);
    });

    it('should reject cancelling a completed (DONE) movement', async () => {
      const moveRes = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'TRANSFER',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: packingLocationId,
          quantity: 5,
          performedBy: 'tester',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveRes.body.id}/confirm`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveRes.body.id}/post`)
        .expect(201);

      const cancelRes = await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveRes.body.id}/cancel`)
        .expect(400);

      expect(cancelRes.body.message).toContain('Completed movements are immutable');
    });
  });

  describe('4. Concurrency & Contention Tests', () => {
    it('should handle two simultaneous posting requests for the same movement safely', async () => {
      const moveRes = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'TRANSFER',
          productId,
          sourceLocationId: storageLocationId,
          destinationLocationId: packingLocationId,
          quantity: 5,
          performedBy: 'concurrent-tester',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/inventory/stock-moves/${moveRes.body.id}/confirm`)
        .expect(201);

      const [postA, postB] = await Promise.all([
        request(app.getHttpServer()).post(`/inventory/stock-moves/${moveRes.body.id}/post`),
        request(app.getHttpServer()).post(`/inventory/stock-moves/${moveRes.body.id}/post`),
      ]);

      expect([200, 201]).toContain(postA.status);
      expect([200, 201]).toContain(postB.status);
      expect(postA.body.state).toBe('DONE');
      expect(postB.body.state).toBe('DONE');
    });

    it('should handle 200 concurrent sales against the same source location without overdraft', async () => {
      const inwardProduct = randomUUID();
      const inwardRes = await request(app.getHttpServer())
        .post('/inventory/stock-moves')
        .send({
          referenceType: 'GRN',
          productId: inwardProduct,
          sourceLocationId: supplierLocationId,
          destinationLocationId: storageLocationId,
          quantity: 250,
          performedBy: 'bulk-inwarder',
        })
        .expect(201);

      await request(app.getHttpServer()).post(`/inventory/stock-moves/${inwardRes.body.id}/confirm`);
      await request(app.getHttpServer()).post(`/inventory/stock-moves/${inwardRes.body.id}/post`);

      const moveCreationPromises = Array.from({ length: 200 }, () =>
        request(app.getHttpServer())
          .post('/inventory/stock-moves')
          .send({
            referenceType: 'TRANSFER',
            productId: inwardProduct,
            sourceLocationId: storageLocationId,
            destinationLocationId: packingLocationId,
            quantity: 1,
            performedBy: 'concurrent-sale-worker',
          }),
      );

      const createdMoves = await Promise.all(moveCreationPromises);
      const moveIds = createdMoves.map((m) => m.body.id);

      await Promise.all(
        moveIds.map((id) =>
          request(app.getHttpServer()).post(`/inventory/stock-moves/${id}/confirm`),
        ),
      );

      const postResults = await Promise.all(
        moveIds.map((id) =>
          request(app.getHttpServer()).post(`/inventory/stock-moves/${id}/post`),
        ),
      );

      for (const res of postResults) {
        expect([200, 201]).toContain(res.status);
        expect(res.body.state).toBe('DONE');
      }

      const finalSoh = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${inwardProduct}&locationId=${storageLocationId}`)
        .expect(200);

      expect(Number(finalSoh.body.data[0].quantity)).toBe(50);

      const packSoh = await request(app.getHttpServer())
        .get(`/inventory/stock-on-hand?productId=${inwardProduct}&locationId=${packingLocationId}`)
        .expect(200);

      expect(Number(packSoh.body.data[0].quantity)).toBe(200);
    }, 60000);
  });

  describe('5. Ledger Reconciliation Correctness', () => {
    it('should reconcile completed ledger against quants with 0 discrepancy', async () => {
      const res = await request(app.getHttpServer())
        .get(`/inventory/reconcile?productId=${productId}`)
        .expect(200);

      expect(res.body.status).toBe('RECONCILED');
      expect(res.body.discrepanciesCount).toBe(0);
      expect(res.body.auditDetails.length).toBeGreaterThan(0);
      for (const item of res.body.auditDetails) {
        expect(item.isReconciled).toBe(true);
        expect(Number(item.discrepancy)).toBe(0);
      }
    });
  });
});
