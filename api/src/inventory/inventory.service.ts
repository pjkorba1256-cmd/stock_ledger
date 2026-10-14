import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
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
export class InventoryService {
  constructor(
    @Inject(DATABASE)
    private readonly db: NodePgDatabase,
  ) {}

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
        unitCostPaise:
          data.unitCostPaise === undefined
            ? undefined
            : BigInt(data.unitCostPaise),
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
}

