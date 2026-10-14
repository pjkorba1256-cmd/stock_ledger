import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';

import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DATABASE } from '../database/database.module.js';
import {
  invLocations,
  invStockMoves,
  invStockQuants,
  invWarehouses,
} from '../database/schema.js';

import type { StockOnHandQuery } from './inventory-query.schema.js';
import { createWarehouseSchema } from './warehouse.schema.js';
import type { CreateWarehouseInput } from './warehouse.schema.js';
import { createLocationSchema } from './location.schema.js';
import type { CreateLocationInput } from './location.schema.js';
import { createStockMoveSchema } from './stock-move.schema.js';
import type {
  CreateStockMoveInput,
  StockMoveHistoryQuery,
} from './stock-move.schema.js';

@Injectable()
export class InventoryService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE)
    private readonly db: NodePgDatabase,
  ) {}

  async onApplicationBootstrap() {
    try {
      const [quantCount] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(invStockQuants);

      if ((quantCount?.count ?? 0) === 0) {
        console.log('[InventoryService] No stock quants found in cloud database. Auto-seeding demo inventory...');
        await this.seedDemoData(false);
        console.log('[InventoryService] Auto-seed finished successfully.');
      }
    } catch (err) {
      console.warn('[InventoryService] Auto-seed check notice:', err);
    }
  }

  async getStockOnHand(query: StockOnHandQuery) {
    const conditions = [];

    if (query.productId) {
      conditions.push(eq(invStockQuants.productId, query.productId));
    }

    if (query.locationId) {
      conditions.push(eq(invStockQuants.locationId, query.locationId));
    }

    const whereClause = and(...conditions);

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(invStockQuants)
        .where(whereClause)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),

      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(invStockQuants)
        .where(whereClause),
    ]);

    const total = countResult[0]?.total ?? 0;

    return {
      data: items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async updateQuantReservation(id: string, reservedQuantity: number) {
    const [quant] = await this.db
      .select()
      .from(invStockQuants)
      .where(eq(invStockQuants.id, id))
      .limit(1);

    if (!quant) {
      throw new NotFoundException(`Stock quant with ID ${id} not found`);
    }

    if (reservedQuantity < 0) {
      throw new BadRequestException('Reserved quantity cannot be negative.');
    }

    const onHand = Number(quant.quantity);
    if (reservedQuantity > onHand) {
      throw new BadRequestException(
        `Cannot reserve ${reservedQuantity.toFixed(3)} units. On-hand quantity is only ${onHand.toFixed(3)} units.`,
      );
    }

    const [updated] = await this.db
      .update(invStockQuants)
      .set({
        reservedQuantity: reservedQuantity.toFixed(3),
        updatedAt: new Date(),
      })
      .where(eq(invStockQuants.id, id))
      .returning();

    return updated;
  }

  async createWarehouse(input: CreateWarehouseInput) {
    const parsed = createWarehouseSchema.safeParse(input);

    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid warehouse data',
        errors: parsed.error.issues,
      });
    }

    const data = parsed.data;

    const existing = await this.db
      .select({ id: invWarehouses.id })
      .from(invWarehouses)
      .where(eq(invWarehouses.code, data.code))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException('Warehouse code already exists');
    }

    try {
      const [warehouse] = await this.db
        .insert(invWarehouses)
        .values({
          merchantId: data.merchantId,
          name: data.name,
          code: data.code,
          address: data.address,
          isDefault: data.isDefault,
        })
        .returning();

      return warehouse;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException(
          'Warehouse code or default-warehouse constraint conflict',
        );
      }

      throw error;
    }
  }

  async createLocation(input: CreateLocationInput) {
    const parsed = createLocationSchema.safeParse(input);

    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid location data',
        errors: parsed.error.issues,
      });
    }

    const data = parsed.data;

    const [warehouse] = await this.db
      .select({ id: invWarehouses.id })
      .from(invWarehouses)
      .where(eq(invWarehouses.id, data.warehouseId))
      .limit(1);

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    if (data.parentLocationId) {
      const [parent] = await this.db
        .select({
          id: invLocations.id,
          warehouseId: invLocations.warehouseId,
        })
        .from(invLocations)
        .where(eq(invLocations.id, data.parentLocationId))
        .limit(1);

      if (!parent) {
        throw new NotFoundException('Parent location not found');
      }

      if (parent.warehouseId !== data.warehouseId) {
        throw new BadRequestException(
          'Parent location must belong to the same warehouse',
        );
      }
    }

    const [location] = await this.db
      .insert(invLocations)
      .values({
        warehouseId: data.warehouseId,
        parentLocationId: data.parentLocationId,
        name: data.name,
        code: data.code,
        type: data.type,
        barcode: data.barcode,
        sortOrder: data.sortOrder,
      })
      .returning();

    return location;
  }

  async createStockMove(input: CreateStockMoveInput) {
    const parsed = createStockMoveSchema.safeParse(input);

    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid stock movement data',
        errors: parsed.error.issues,
      });
    }

    const data = parsed.data;

    const locations = await this.db
      .select({
        id: invLocations.id,
        warehouseId: invLocations.warehouseId,
      })
      .from(invLocations)
      .where(
        sql`${invLocations.id} IN (
          ${data.sourceLocationId}::uuid,
          ${data.destinationLocationId}::uuid
        )`,
      );

    const source = locations.find(
      (location) => location.id === data.sourceLocationId,
    );

    const destination = locations.find(
      (location) => location.id === data.destinationLocationId,
    );

    if (!source || !destination) {
      throw new NotFoundException(
        'Source or destination location not found',
      );
    }

    if (
      source.warehouseId !== destination.warehouseId &&
      data.referenceType !== 'TRANSFER'
    ) {
      throw new BadRequestException(
        'Cross-warehouse movement requires referenceType TRANSFER',
      );
    }

    const [move] = await this.db
      .insert(invStockMoves)
      .values({
        referenceId: data.referenceId,
        referenceType: data.referenceType,
        productId: data.productId,
        variantId: data.variantId,
        sourceLocationId: data.sourceLocationId,
        destinationLocationId: data.destinationLocationId,
        quantity: String(data.quantity),
        unitCostPaise: data.unitCostPaise,
        performedBy: data.performedBy,
        notes: data.notes,
        state: 'DRAFT',
      })
      .returning();

    return move;
  }

  async getStockMoveById(id: string) {
    const [move] = await this.db
      .select()
      .from(invStockMoves)
      .where(eq(invStockMoves.id, id))
      .limit(1);

    if (!move) {
      throw new NotFoundException(`Stock movement with ID ${id} not found`);
    }

    return move;
  }

  async confirmStockMove(id: string) {
    const [move] = await this.db
      .select()
      .from(invStockMoves)
      .where(eq(invStockMoves.id, id))
      .limit(1);

    if (!move) {
      throw new NotFoundException(`Stock movement with ID ${id} not found`);
    }

    if (move.state === 'CONFIRMED') {
      return move;
    }

    if (move.state !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot confirm movement in ${move.state} state. Only DRAFT movements can be confirmed.`,
      );
    }

    const [updated] = await this.db
      .update(invStockMoves)
      .set({
        state: 'CONFIRMED',
        updatedAt: new Date(),
      })
      .where(eq(invStockMoves.id, id))
      .returning();

    return updated;
  }

  async cancelStockMove(id: string) {
    const [move] = await this.db
      .select()
      .from(invStockMoves)
      .where(eq(invStockMoves.id, id))
      .limit(1);

    if (!move) {
      throw new NotFoundException(`Stock movement with ID ${id} not found`);
    }

    if (move.state === 'DONE') {
      throw new BadRequestException(
        'Cannot cancel a completed (DONE) stock movement. Completed movements are immutable.',
      );
    }

    if (move.state === 'CANCELLED') {
      return move;
    }

    const [updated] = await this.db
      .update(invStockMoves)
      .set({
        state: 'CANCELLED',
        updatedAt: new Date(),
      })
      .where(eq(invStockMoves.id, id))
      .returning();

    return updated;
  }

  async postStockMove(id: string) {
    return await this.db.transaction(async (tx) => {
      // 1. Lock the movement row to prevent concurrent posting
      const [move] = await tx
        .select()
        .from(invStockMoves)
        .where(eq(invStockMoves.id, id))
        .for('update');

      if (!move) {
        throw new NotFoundException(`Stock movement with ID ${id} not found`);
      }

      // Idempotency: if already DONE, return immediately without reposting
      if (move.state === 'DONE') {
        return move;
      }

      if (move.state === 'CANCELLED') {
        throw new BadRequestException('Cannot post a CANCELLED stock movement.');
      }

      if (move.state !== 'CONFIRMED') {
        throw new BadRequestException(
          `Cannot post movement in ${move.state} state. The movement must be CONFIRMED before posting.`,
        );
      }

      // 2. Fetch source and destination location metadata to determine physical vs virtual tracking
      const locations = await tx
        .select({
          id: invLocations.id,
          type: invLocations.type,
          name: invLocations.name,
        })
        .from(invLocations)
        .where(
          sql`${invLocations.id} IN (${move.sourceLocationId}::uuid, ${move.destinationLocationId}::uuid)`,
        );

      const sourceLoc = locations.find((l) => l.id === move.sourceLocationId);
      const destLoc = locations.find((l) => l.id === move.destinationLocationId);

      if (!sourceLoc || !destLoc) {
        throw new NotFoundException('Source or destination location not found');
      }

      const isSourcePhysical = sourceLoc.type === 'INTERNAL';
      const isDestPhysical = destLoc.type === 'INTERNAL';

      // 3. Handle source quant deduction if source is a physical location (INTERNAL)
      if (isSourcePhysical) {
        const [sourceQuant] = await tx
          .select()
          .from(invStockQuants)
          .where(
            and(
              eq(invStockQuants.productId, move.productId),
              move.variantId
                ? eq(invStockQuants.variantId, move.variantId)
                : isNull(invStockQuants.variantId),
              eq(invStockQuants.locationId, move.sourceLocationId),
              move.lotId
                ? eq(invStockQuants.lotId, move.lotId)
                : isNull(invStockQuants.lotId),
            ),
          )
          .for('update');

        const moveQty = Number(move.quantity);
        const sourceCurrentQty = sourceQuant ? Number(sourceQuant.quantity) : 0;
        const sourceReservedQty = sourceQuant ? Number(sourceQuant.reservedQuantity) : 0;
        const availableQty = sourceCurrentQty - sourceReservedQty;

        if (!sourceQuant || availableQty < moveQty) {
          throw new BadRequestException(
            `Insufficient stock at location '${sourceLoc.name}'. Available: ${availableQty.toFixed(3)}, Required: ${moveQty.toFixed(3)}`,
          );
        }

        const newSourceQty = (sourceCurrentQty - moveQty).toFixed(3);

        await tx
          .update(invStockQuants)
          .set({
            quantity: newSourceQty,
            updatedAt: new Date(),
          })
          .where(eq(invStockQuants.id, sourceQuant.id));
      }

      // 4. Handle destination quant addition if destination is a physical location (INTERNAL)
      if (isDestPhysical) {
        const [destQuant] = await tx
          .select()
          .from(invStockQuants)
          .where(
            and(
              eq(invStockQuants.productId, move.productId),
              move.variantId
                ? eq(invStockQuants.variantId, move.variantId)
                : isNull(invStockQuants.variantId),
              eq(invStockQuants.locationId, move.destinationLocationId),
              move.lotId
                ? eq(invStockQuants.lotId, move.lotId)
                : isNull(invStockQuants.lotId),
            ),
          )
          .for('update');

        const moveQty = Number(move.quantity);

        if (destQuant) {
          const newDestQty = (Number(destQuant.quantity) + moveQty).toFixed(3);
          await tx
            .update(invStockQuants)
            .set({
              quantity: newDestQty,
              updatedAt: new Date(),
            })
            .where(eq(invStockQuants.id, destQuant.id));
        } else {
          await tx.insert(invStockQuants).values({
            productId: move.productId,
            variantId: move.variantId,
            locationId: move.destinationLocationId,
            lotId: move.lotId,
            quantity: move.quantity,
            reservedQuantity: '0.000',
            costPricePaise: move.unitCostPaise,
          });
        }
      }

      // 5. Mark stock movement as DONE and stamp done_date
      const [postedMove] = await tx
        .update(invStockMoves)
        .set({
          state: 'DONE',
          doneDate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invStockMoves.id, id))
        .returning();

      return postedMove;
    });
  }

  async getStockMoves(query: StockMoveHistoryQuery) {
    const conditions = [];

    if (query.productId) {
      conditions.push(eq(invStockMoves.productId, query.productId));
    }

    if (query.locationId) {
      conditions.push(
        or(
          eq(invStockMoves.sourceLocationId, query.locationId),
          eq(invStockMoves.destinationLocationId, query.locationId),
        ),
      );
    }

    if (query.state) {
      conditions.push(eq(invStockMoves.state, query.state));
    }

    if (query.referenceType) {
      conditions.push(eq(invStockMoves.referenceType, query.referenceType));
    }

    if (query.startDate) {
      conditions.push(gte(invStockMoves.createdAt, new Date(query.startDate)));
    }

    if (query.endDate) {
      conditions.push(lte(invStockMoves.createdAt, new Date(query.endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(invStockMoves)
        .where(whereClause)
        .orderBy(desc(invStockMoves.createdAt), desc(invStockMoves.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),

      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(invStockMoves)
        .where(whereClause),
    ]);

    const total = countResult[0]?.total ?? 0;

    return {
      data: items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async reconcileLedger(productId?: string) {
    // 1. Fetch all locations to identify physical ones (INTERNAL)
    const allLocations = await this.db
      .select({
        id: invLocations.id,
        name: invLocations.name,
        code: invLocations.code,
        type: invLocations.type,
      })
      .from(invLocations);

    const physicalLocationIds = new Set(
      allLocations.filter((l) => l.type === 'INTERNAL').map((l) => l.id),
    );

    // 2. Fetch all completed (DONE) movements
    const moveConditions = [eq(invStockMoves.state, 'DONE')];
    if (productId) {
      moveConditions.push(eq(invStockMoves.productId, productId));
    }

    const completedMoves = await this.db
      .select()
      .from(invStockMoves)
      .where(and(...moveConditions));

    // 3. Compute expected balance from the auditable ledger
    const ledgerBalances = new Map<string, number>();

    for (const move of completedMoves) {
      const qty = Number(move.quantity);
      const variantKey = move.variantId ?? '';
      const lotKey = move.lotId ?? '';

      // If destination is a physical location, credit quantity
      if (physicalLocationIds.has(move.destinationLocationId)) {
        const destKey = `${move.productId}::${variantKey}::${move.destinationLocationId}::${lotKey}`;
        ledgerBalances.set(destKey, (ledgerBalances.get(destKey) ?? 0) + qty);
      }

      // If source is a physical location, debit quantity
      if (physicalLocationIds.has(move.sourceLocationId)) {
        const sourceKey = `${move.productId}::${variantKey}::${move.sourceLocationId}::${lotKey}`;
        ledgerBalances.set(sourceKey, (ledgerBalances.get(sourceKey) ?? 0) - qty);
      }
    }

    // 4. Fetch current stock quants (snapshots)
    const quantConditions = [];
    if (productId) {
      quantConditions.push(eq(invStockQuants.productId, productId));
    }

    const currentQuants = await this.db
      .select()
      .from(invStockQuants)
      .where(quantConditions.length > 0 ? and(...quantConditions) : undefined);

    const quantBalances = new Map<string, { id: string; quantity: number }>();
    for (const q of currentQuants) {
      const variantKey = q.variantId ?? '';
      const lotKey = q.lotId ?? '';
      const key = `${q.productId}::${variantKey}::${q.locationId}::${lotKey}`;
      quantBalances.set(key, { id: q.id, quantity: Number(q.quantity) });
    }

    // 5. Cross-check ledger vs quants
    const allKeys = new Set([...ledgerBalances.keys(), ...quantBalances.keys()]);
    const discrepancies = [];
    const auditDetails = [];

    for (const key of allKeys) {
      const [pId, vId, locId, lId] = key.split('::');
      const expectedFromLedger = Number(
        (ledgerBalances.get(key) ?? 0).toFixed(3),
      );
      const actualFromQuant = Number(
        (quantBalances.get(key)?.quantity ?? 0).toFixed(3),
      );
      const diff = Number((actualFromQuant - expectedFromLedger).toFixed(3));

      const locInfo = allLocations.find((l) => l.id === locId);

      const record = {
        productId: pId,
        variantId: vId || null,
        locationId: locId,
        locationName: locInfo?.name ?? locId,
        lotId: lId || null,
        expectedLedgerQuantity: expectedFromLedger.toFixed(3),
        actualQuantQuantity: actualFromQuant.toFixed(3),
        discrepancy: diff.toFixed(3),
        isReconciled: Math.abs(diff) < 0.0001,
      };

      auditDetails.push(record);

      if (!record.isReconciled) {
        discrepancies.push(record);
      }
    }

    return {
      status:
        discrepancies.length === 0 ? 'RECONCILED' : 'DISCREPANCY_DETECTED',
      reconciledAt: new Date().toISOString(),
      totalAuditedItems: auditDetails.length,
      discrepanciesCount: discrepancies.length,
      discrepancies,
      auditDetails,
    };
  }

  async getWarehouses() {
    return await this.db.select().from(invWarehouses);
  }

  async getLocations() {
    return await this.db.select().from(invLocations);
  }

  async seedDemoData(force = false) {
    const [quantCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(invStockQuants);

    if (!force && (quantCount?.count ?? 0) > 0) {
      return {
        success: true,
        message: 'Database already populated with active stock quants.',
        movesCreated: 0,
      };
    }

    // 1. Ensure default warehouse exists
    const existingWh = await this.db
      .select()
      .from(invWarehouses)
      .where(eq(invWarehouses.code, 'WH-MAIN'))
      .limit(1);

    let warehouseId: string;
    if (existingWh.length > 0) {
      warehouseId = existingWh[0].id;
    } else {
      const [inserted] = await this.db
        .insert(invWarehouses)
        .values({
          merchantId: '00000000-0000-0000-0000-000000000001',
          name: 'Central Distribution Hub (WH-01)',
          code: 'WH-MAIN',
          address: {
            street: '100 Tech Park Way',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560100',
            country: 'IN',
          },
          isDefault: true,
        })
        .returning();
      warehouseId = inserted.id;
    }

    // 2. Ensure demo locations exist
    const defaultLocations = [
      {
        id: 'd2961899-7090-4d21-94ef-81e63aeb646d',
        name: 'Global Vendor Partner (Inbound)',
        code: 'LOC-SUP-01',
        type: 'SUPPLIER',
      },
      {
        id: '7172f4fd-8c7c-4115-adff-9fd36ff84ecd',
        name: 'Storage Area (Rack A - Vault)',
        code: 'LOC-STORAGE-A',
        type: 'INTERNAL',
      },
      {
        id: '5571a122-f657-452c-ae2f-7387005512a4',
        name: 'Receiving Area 2 (Rack B - Picking Bins)',
        code: 'LOC-STORAGE-B',
        type: 'INTERNAL',
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        name: 'Customer Fulfillment Dock (Outward)',
        code: 'LOC-CUST-01',
        type: 'CUSTOMER',
      },
    ];

    for (const loc of defaultLocations) {
      const [exists] = await this.db
        .select({ id: invLocations.id })
        .from(invLocations)
        .where(
          and(
            eq(invLocations.warehouseId, warehouseId),
            eq(invLocations.code, loc.code),
          ),
        )
        .limit(1);

      if (!exists) {
        await this.db.insert(invLocations).values({
          id: loc.id,
          warehouseId,
          name: loc.name,
          code: loc.code,
          type: loc.type,
        });
      }
    }

    // 3. Products & movements definition
    const vendorLocId = 'd2961899-7090-4d21-94ef-81e63aeb646d';
    const rackALocId = '7172f4fd-8c7c-4115-adff-9fd36ff84ecd';
    const rackBLocId = '5571a122-f657-452c-ae2f-7387005512a4';
    const customerLocId = '88888888-8888-4888-8888-888888888888';

    const demoMoves: Array<{
      referenceId: string;
      referenceType: 'GRN' | 'TRANSFER' | 'SALE';
      productId: string;
      sourceLocationId: string;
      destinationLocationId: string;
      quantity: number;
      unitCostPaise?: number;
      performedBy: string;
      notes: string;
      targetState: 'DRAFT' | 'CONFIRMED' | 'DONE';
    }> = [
      {
        referenceId: 'PO-2026-0891',
        referenceType: 'GRN',
        productId: '11111111-1111-4111-8111-111111111111',
        sourceLocationId: vendorLocId,
        destinationLocationId: rackALocId,
        quantity: 150,
        unitCostPaise: 24990000,
        performedBy: 'procurement-team',
        notes: 'Initial bulk receipt: Apple MacBook Pro 16" M3 Max',
        targetState: 'DONE',
      },
      {
        referenceId: 'PO-2026-0892',
        referenceType: 'GRN',
        productId: '22222222-2222-4222-8222-222222222222',
        sourceLocationId: vendorLocId,
        destinationLocationId: rackALocId,
        quantity: 280,
        unitCostPaise: 8990000,
        performedBy: 'procurement-team',
        notes: 'Initial bulk receipt: Dell UltraSharp 32" 4K Monitor',
        targetState: 'DONE',
      },
      {
        referenceId: 'PO-2026-0893',
        referenceType: 'GRN',
        productId: '33333333-3333-4333-8333-333333333333',
        sourceLocationId: vendorLocId,
        destinationLocationId: rackALocId,
        quantity: 450,
        unitCostPaise: 1850000,
        performedBy: 'procurement-team',
        notes: 'Initial bulk receipt: Keychron Q1 Pro Mechanical Keyboard',
        targetState: 'DONE',
      },
      {
        referenceId: 'PO-2026-0894',
        referenceType: 'GRN',
        productId: '44444444-4444-4444-8444-444444444444',
        sourceLocationId: vendorLocId,
        destinationLocationId: rackALocId,
        quantity: 620,
        unitCostPaise: 2999000,
        performedBy: 'procurement-team',
        notes: 'Initial bulk receipt: Sony WH-1000XM5 ANC Headphones',
        targetState: 'DONE',
      },
      {
        referenceId: 'PO-2026-0895',
        referenceType: 'GRN',
        productId: '55555555-5555-4555-8555-555555555555',
        sourceLocationId: vendorLocId,
        destinationLocationId: rackALocId,
        quantity: 890,
        unitCostPaise: 949500,
        performedBy: 'procurement-team',
        notes: 'Initial bulk receipt: Logitech MX Master 3S Mouse',
        targetState: 'DONE',
      },
      {
        referenceId: 'TR-2026-0101',
        referenceType: 'TRANSFER',
        productId: '11111111-1111-4111-8111-111111111111',
        sourceLocationId: rackALocId,
        destinationLocationId: rackBLocId,
        quantity: 30,
        performedBy: 'wh-operator-1',
        notes: 'Replenishment: Move 30 MacBook Pros from Storage to Picking Bins',
        targetState: 'DONE',
      },
      {
        referenceId: 'TR-2026-0102',
        referenceType: 'TRANSFER',
        productId: '22222222-2222-4222-8222-222222222222',
        sourceLocationId: rackALocId,
        destinationLocationId: rackBLocId,
        quantity: 50,
        performedBy: 'wh-operator-2',
        notes: 'Replenishment: Move 50 Dell Monitors to Picking Bins',
        targetState: 'DONE',
      },
      {
        referenceId: 'DO-2026-0501',
        referenceType: 'SALE',
        productId: '11111111-1111-4111-8111-111111111111',
        sourceLocationId: rackBLocId,
        destinationLocationId: customerLocId,
        quantity: 12,
        performedBy: 'fulfillment-dock',
        notes: 'Customer dispatch: Enterprise workstation order',
        targetState: 'DONE',
      },
      {
        referenceId: 'TR-2026-0103',
        referenceType: 'TRANSFER',
        productId: '33333333-3333-4333-8333-333333333333',
        sourceLocationId: rackALocId,
        destinationLocationId: rackBLocId,
        quantity: 25,
        performedBy: 'shift-supervisor',
        notes: 'Staged transfer ready for posting',
        targetState: 'CONFIRMED',
      },
      {
        referenceId: 'PO-2026-0899',
        referenceType: 'GRN',
        productId: '44444444-4444-4444-8444-444444444444',
        sourceLocationId: vendorLocId,
        destinationLocationId: rackALocId,
        quantity: 100,
        unitCostPaise: 2999000,
        performedBy: 'procurement-team',
        notes: 'Advance shipping notice - awaiting inspection',
        targetState: 'DRAFT',
      },
    ];

    let createdCount = 0;
    for (const item of demoMoves) {
      try {
        const move = await this.createStockMove({
          referenceId: item.referenceId,
          referenceType: item.referenceType,
          productId: item.productId,
          sourceLocationId: item.sourceLocationId,
          destinationLocationId: item.destinationLocationId,
          quantity: item.quantity,
          unitCostPaise: item.unitCostPaise,
          performedBy: item.performedBy,
          notes: item.notes,
        });
        createdCount++;

        if (item.targetState === 'CONFIRMED' || item.targetState === 'DONE') {
          await this.confirmStockMove(move.id);
        }
        if (item.targetState === 'DONE') {
          await this.postStockMove(move.id);
        }
      } catch (err) {
        console.warn(`[InventoryService] Seed move ${item.referenceId} notice:`, err);
      }
    }

    return {
      success: true,
      message: 'Demo inventory seeded successfully with full mathematical integrity.',
      movesCreated: createdCount,
    };
  }
}

