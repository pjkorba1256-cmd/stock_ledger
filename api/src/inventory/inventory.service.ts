import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DATABASE } from '../database/database.module.js';
import {
  invLocations,
  invLots,
  invReservations,
  invStockCountLines,
  invStockCounts,
  invStockMoves,
  invStockQuants,
  invStockScrap,
  invTransferCounters,
  invTransfers,
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

import type {
  CreateLotInput,
  ExpiringLotsQuery,
  FefoSaleInput,
  ReceiveLotInput,
} from './lot.schema.js';
import { createLotSchema, receiveLotSchema, fefoSaleSchema } from './lot.schema.js';

import type {
  CancelReservationInput,
  CreateReservationInput,
  ReservationQuery,
} from './reservation.schema.js';
import { createReservationSchema } from './reservation.schema.js';

import type {
  CreateTransferInput,
  DispatchTransferInput,
  ReceiveTransferInput,
  TransferQuery,
} from './transfer.schema.js';
import {
  createTransferSchema,
  dispatchTransferSchema,
  receiveTransferSchema,
} from './transfer.schema.js';

import type {
  ApproveScrapInput,
  CreateScrapInput,
  RejectScrapInput,
  ScrapQuery,
} from './scrap.schema.js';
import { createScrapSchema, approveScrapSchema, rejectScrapSchema } from './scrap.schema.js';

import type {
  CreateCountInput,
  RecordCountLinesInput,
  ReconcileCountInput,
} from './count.schema.js';
import { createCountSchema, recordCountLinesSchema, reconcileCountSchema } from './count.schema.js';

import { JobsService } from '../jobs/jobs.service.js';

@Injectable()
export class InventoryService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE)
    private readonly db: NodePgDatabase,
    @Optional()
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService?: JobsService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const [quantCount] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(invStockQuants);

      if ((quantCount?.count ?? 0) === 0) {
        console.log(
          '[InventoryService] No stock quants found. Auto-seeding FreshMart demo inventory with lots...',
        );
        await this.seedDemoData(false);
        console.log('[InventoryService] Auto-seed finished successfully.');
      }
    } catch (err) {
      console.warn('[InventoryService] Auto-seed check notice:', err);
    }
  }

  // ==========================================
  // 1. WAREHOUSES & LOCATIONS
  // ==========================================

  async getWarehouses(merchantId?: string) {
    if (merchantId) {
      return await this.db
        .select()
        .from(invWarehouses)
        .where(eq(invWarehouses.merchantId, merchantId));
    }
    return await this.db.select().from(invWarehouses);
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

  async getLocations(warehouseId?: string) {
    if (warehouseId) {
      return await this.db
        .select()
        .from(invLocations)
        .where(eq(invLocations.warehouseId, warehouseId));
    }
    return await this.db.select().from(invLocations);
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

  // ==========================================
  // 2. STOCK ON HAND & QUANTS
  // ==========================================

  async getStockOnHand(query: StockOnHandQuery) {
    const conditions = [];

    if (query.productId) {
      conditions.push(eq(invStockQuants.productId, query.productId));
    }

    if (query.locationId) {
      conditions.push(eq(invStockQuants.locationId, query.locationId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countResult] = await Promise.all([
      this.db
        .select({
          id: invStockQuants.id,
          productId: invStockQuants.productId,
          variantId: invStockQuants.variantId,
          locationId: invStockQuants.locationId,
          lotId: invStockQuants.lotId,
          quantity: invStockQuants.quantity,
          reservedQuantity: invStockQuants.reservedQuantity,
          costPricePaise: invStockQuants.costPricePaise,
          lastCountDate: invStockQuants.lastCountDate,
          createdAt: invStockQuants.createdAt,
          updatedAt: invStockQuants.updatedAt,
          lotName: invLots.name,
          expiryDate: invLots.expiryDate,
        })
        .from(invStockQuants)
        .leftJoin(invLots, eq(invStockQuants.lotId, invLots.id))
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

  // ==========================================
  // 3. STOCK MOVEMENTS (CORE LEDGER)
  // ==========================================

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

    const source = locations.find((l) => l.id === data.sourceLocationId);
    const destination = locations.find((l) => l.id === data.destinationLocationId);

    if (!source || !destination) {
      throw new NotFoundException('Source or destination location not found');
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
        lotId: data.lotId,
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
      // 1. Lock the movement row
      const [move] = await tx
        .select()
        .from(invStockMoves)
        .where(eq(invStockMoves.id, id))
        .for('update');

      if (!move) {
        throw new NotFoundException(`Stock movement with ID ${id} not found`);
      }

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

      // 2. Fetch locations
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

      // In-transit and scrap tracking locations are physical ledger quants
      const isSourceTracked =
        sourceLoc.type === 'INTERNAL' ||
        sourceLoc.type === 'TRANSIT' ||
        sourceLoc.type === 'SCRAP';
      const isDestTracked =
        destLoc.type === 'INTERNAL' ||
        destLoc.type === 'TRANSIT' ||
        destLoc.type === 'SCRAP';

      // 3. Source quant deduction
      if (isSourceTracked) {
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
        const sourceReservedQty = sourceQuant
          ? Number(sourceQuant.reservedQuantity)
          : 0;
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

      // 4. Destination quant addition
      if (isDestTracked) {
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

      // 5. Mark stock movement as DONE
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

  // ==========================================
  // 4. LOTS & FEFO ALLOCATION (P03)
  // ==========================================

  async createLot(input: CreateLotInput) {
    const parsed = createLotSchema.parse(input);

    const existing = await this.db
      .select({ id: invLots.id })
      .from(invLots)
      .where(
        and(
          eq(invLots.productId, parsed.productId),
          eq(invLots.name, parsed.name),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(
        `Lot '${parsed.name}' already exists for product ${parsed.productId}`,
      );
    }

    const [lot] = await this.db
      .insert(invLots)
      .values({
        productId: parsed.productId,
        name: parsed.name,
        vendorId: parsed.vendorId,
        manufacturingDate: parsed.manufacturingDate,
        expiryDate: parsed.expiryDate,
        reference: parsed.reference,
        notes: parsed.notes,
      })
      .returning();

    return lot;
  }

  async getLots(productId?: string) {
    if (productId) {
      return await this.db
        .select()
        .from(invLots)
        .where(eq(invLots.productId, productId))
        .orderBy(asc(invLots.expiryDate));
    }
    return await this.db.select().from(invLots).orderBy(asc(invLots.expiryDate));
  }

  async getLotById(id: string) {
    const [lot] = await this.db
      .select()
      .from(invLots)
      .where(eq(invLots.id, id))
      .limit(1);

    if (!lot) {
      throw new NotFoundException(`Lot with ID ${id} not found`);
    }

    return lot;
  }

  async receiveLot(input: ReceiveLotInput, merchantId?: string) {
    const parsed = receiveLotSchema.parse(input);

    return await this.db.transaction(async (tx) => {
      // 1. Verify destination location
      const [destLoc] = await tx
        .select({
          id: invLocations.id,
          warehouseId: invLocations.warehouseId,
          type: invLocations.type,
          merchantId: invWarehouses.merchantId,
        })
        .from(invLocations)
        .innerJoin(invWarehouses, eq(invLocations.warehouseId, invWarehouses.id))
        .where(eq(invLocations.id, parsed.locationId))
        .limit(1);

      if (!destLoc) {
        throw new NotFoundException('Destination location not found');
      }

      if (destLoc.type !== 'INTERNAL') {
        throw new BadRequestException(
          'Goods receipt destination must be an INTERNAL storage location',
        );
      }

      if (merchantId && destLoc.merchantId !== merchantId) {
        throw new ForbiddenException(
          'Location does not belong to authorized merchant',
        );
      }

      // 2. Find or create lot
      let [lot] = await tx
        .select()
        .from(invLots)
        .where(
          and(
            eq(invLots.productId, parsed.productId),
            eq(invLots.name, parsed.lotName),
          ),
        )
        .limit(1);

      if (!lot) {
        const [createdLot] = await tx
          .insert(invLots)
          .values({
            productId: parsed.productId,
            name: parsed.lotName,
            vendorId: parsed.vendorId,
            manufacturingDate: parsed.manufacturingDate,
            expiryDate: parsed.expiryDate,
            reference: parsed.reference,
            notes: parsed.notes,
          })
          .returning();
        lot = createdLot;
      }

      // 3. Find or create SUPPLIER location in the warehouse
      let [supplierLoc] = await tx
        .select()
        .from(invLocations)
        .where(
          and(
            eq(invLocations.warehouseId, destLoc.warehouseId),
            eq(invLocations.type, 'SUPPLIER'),
          ),
        )
        .limit(1);

      if (!supplierLoc) {
        const [createdSup] = await tx
          .insert(invLocations)
          .values({
            warehouseId: destLoc.warehouseId,
            name: 'Supplier Receiving Dock',
            code: `SUP-AUTO-${destLoc.warehouseId.slice(0, 6)}`,
            type: 'SUPPLIER',
          })
          .returning();
        supplierLoc = createdSup;
      }

      // 4. Create stock move for GRN
      const [move] = await tx
        .insert(invStockMoves)
        .values({
          referenceId: parsed.reference ?? `GRN-${lot.name}`,
          referenceType: 'GRN',
          productId: parsed.productId,
          lotId: lot.id,
          sourceLocationId: supplierLoc.id,
          destinationLocationId: destLoc.id,
          quantity: String(parsed.quantity),
          unitCostPaise: parsed.unitCostPaise,
          performedBy: parsed.performedBy,
          notes: parsed.notes,
          state: 'CONFIRMED',
        })
        .returning();

      // 5. Post move immediately inside the same transaction
      // Destination is INTERNAL -> update/insert quant
      const [destQuant] = await tx
        .select()
        .from(invStockQuants)
        .where(
          and(
            eq(invStockQuants.productId, parsed.productId),
            isNull(invStockQuants.variantId),
            eq(invStockQuants.locationId, destLoc.id),
            eq(invStockQuants.lotId, lot.id),
          ),
        )
        .for('update');

      let quantRecord;
      if (destQuant) {
        const newQty = (Number(destQuant.quantity) + parsed.quantity).toFixed(3);
        const [updated] = await tx
          .update(invStockQuants)
          .set({
            quantity: newQty,
            costPricePaise: parsed.unitCostPaise ?? destQuant.costPricePaise,
            updatedAt: new Date(),
          })
          .where(eq(invStockQuants.id, destQuant.id))
          .returning();
        quantRecord = updated;
      } else {
        const [inserted] = await tx
          .insert(invStockQuants)
          .values({
            productId: parsed.productId,
            locationId: destLoc.id,
            lotId: lot.id,
            quantity: parsed.quantity.toFixed(3),
            reservedQuantity: '0.000',
            costPricePaise: parsed.unitCostPaise,
          })
          .returning();
        quantRecord = inserted;
      }

      const [postedMove] = await tx
        .update(invStockMoves)
        .set({
          state: 'DONE',
          doneDate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invStockMoves.id, move.id))
        .returning();

      return {
        lot,
        movement: postedMove,
        quant: quantRecord,
      };
    });
  }

  async fefoAllocateAndSell(input: FefoSaleInput, merchantId?: string) {
    const parsed = fefoSaleSchema.parse(input);
    const today = new Date().toISOString().slice(0, 10);

    return await this.db.transaction(async (tx) => {
      // 1. Fetch available quants for product and location with their lots
      const [sourceLoc] = await tx
        .select({
          id: invLocations.id,
          warehouseId: invLocations.warehouseId,
          type: invLocations.type,
          merchantId: invWarehouses.merchantId,
        })
        .from(invLocations)
        .innerJoin(invWarehouses, eq(invLocations.warehouseId, invWarehouses.id))
        .where(eq(invLocations.id, parsed.sourceLocationId))
        .limit(1);

      if (!sourceLoc) {
        throw new NotFoundException('Source location not found');
      }

      if (sourceLoc.type !== 'INTERNAL') {
        throw new BadRequestException('Sales must originate from an INTERNAL storage location');
      }

      if (merchantId && sourceLoc.merchantId !== merchantId) {
        throw new ForbiddenException('Location does not belong to authorized merchant');
      }

      // 2. Resolve destination CUSTOMER location
      let destLocationId = parsed.destinationLocationId;
      if (!destLocationId) {
        const [custLoc] = await tx
          .select({ id: invLocations.id })
          .from(invLocations)
          .where(
            and(
              eq(invLocations.warehouseId, sourceLoc.warehouseId),
              eq(invLocations.type, 'CUSTOMER'),
            ),
          )
          .limit(1);

        if (custLoc) {
          destLocationId = custLoc.id;
        } else {
          const [newCust] = await tx
            .insert(invLocations)
            .values({
              warehouseId: sourceLoc.warehouseId,
              name: 'Retail Point of Sale',
              code: `POS-CUST-${sourceLoc.warehouseId.slice(0, 6)}`,
              type: 'CUSTOMER',
            })
            .returning();
          destLocationId = newCust.id;
        }
      }

      // 3. Query all quants for this product at this location ordered by FEFO (expiry_date ASC)
      // Lock rows FOR UPDATE
      const availableQuants = await tx
        .select({
          quantId: invStockQuants.id,
          quantity: invStockQuants.quantity,
          reservedQuantity: invStockQuants.reservedQuantity,
          lotId: invStockQuants.lotId,
          lotName: invLots.name,
          expiryDate: invLots.expiryDate,
          costPricePaise: invStockQuants.costPricePaise,
        })
        .from(invStockQuants)
        .leftJoin(invLots, eq(invStockQuants.lotId, invLots.id))
        .where(
          and(
            eq(invStockQuants.productId, parsed.productId),
            eq(invStockQuants.locationId, parsed.sourceLocationId),
            sql`(${invStockQuants.quantity} - ${invStockQuants.reservedQuantity}) > 0`,
          ),
        )
        .orderBy(asc(invLots.expiryDate));

      // CRITICAL INVARIANT: Expired lots must NEVER be sold!
      const eligibleQuants = availableQuants.filter((q) => {
        if (!q.expiryDate) {
          return true; // Non-perishable lot
        }
        return q.expiryDate >= today;
      });

      let remainingToAllocate = parsed.quantity;
      const allocations: Array<{
        quantId: string;
        lotId: string | null;
        lotName: string | null;
        expiryDate: string | null;
        allocatedQuantity: number;
        unitCostPaise?: number | null;
      }> = [];

      for (const q of eligibleQuants) {
        if (remainingToAllocate <= 0) break;

        const onHand = Number(q.quantity);
        const reserved = Number(q.reservedQuantity);
        const available = Number((onHand - reserved).toFixed(3));

        if (available > 0) {
          const alloc = Math.min(available, remainingToAllocate);
          allocations.push({
            quantId: q.quantId,
            lotId: q.lotId,
            lotName: q.lotName,
            expiryDate: q.expiryDate,
            allocatedQuantity: alloc,
            unitCostPaise: q.costPricePaise,
          });
          remainingToAllocate = Number((remainingToAllocate - alloc).toFixed(3));
        }
      }

      if (remainingToAllocate > 0) {
        throw new BadRequestException(
          `Insufficient eligible non-expired stock for product ${parsed.productId}. Requested: ${parsed.quantity.toFixed(3)}, Shortage: ${remainingToAllocate.toFixed(3)} units. (Note: Expired lots were excluded under FEFO policy).`,
        );
      }

      // 4. Post sales movements and update quants
      const movements = [];
      for (const alloc of allocations) {
        const [qRow] = await tx
          .select()
          .from(invStockQuants)
          .where(eq(invStockQuants.id, alloc.quantId))
          .for('update');

        const newQty = (Number(qRow.quantity) - alloc.allocatedQuantity).toFixed(3);
        await tx
          .update(invStockQuants)
          .set({
            quantity: newQty,
            updatedAt: new Date(),
          })
          .where(eq(invStockQuants.id, alloc.quantId));

        const [move] = await tx
          .insert(invStockMoves)
          .values({
            referenceId: parsed.orderReference ?? `SALE-FEFO-${Date.now()}`,
            referenceType: 'SALE',
            productId: parsed.productId,
            lotId: alloc.lotId,
            sourceLocationId: parsed.sourceLocationId,
            destinationLocationId: destLocationId,
            quantity: alloc.allocatedQuantity.toFixed(3),
            unitCostPaise: alloc.unitCostPaise ?? undefined,
            state: 'DONE',
            doneDate: new Date(),
            performedBy: parsed.performedBy,
            notes: `FEFO allocation: Lot '${alloc.lotName ?? 'N/A'}' (expires: ${alloc.expiryDate ?? 'None'})`,
          })
          .returning();

        movements.push(move);
      }

      return {
        success: true,
        productId: parsed.productId,
        totalQuantitySold: parsed.quantity,
        allocations,
        movements,
      };
    });
  }

  async getExpiringLots(query: ExpiringLotsQuery, merchantId?: string) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + query.days);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    const conditions = [
      sql`${invStockQuants.quantity} > 0`,
      sql`${invLots.expiryDate} IS NOT NULL`,
      lte(invLots.expiryDate, cutoffStr),
    ];

    if (query.warehouseId) {
      conditions.push(eq(invLocations.warehouseId, query.warehouseId));
    }

    if (query.productId) {
      conditions.push(eq(invStockQuants.productId, query.productId));
    }

    if (merchantId) {
      conditions.push(eq(invWarehouses.merchantId, merchantId));
    }

    const rows = await this.db
      .select({
        quantId: invStockQuants.id,
        productId: invStockQuants.productId,
        quantity: invStockQuants.quantity,
        reservedQuantity: invStockQuants.reservedQuantity,
        costPricePaise: invStockQuants.costPricePaise,
        locationId: invStockQuants.locationId,
        locationName: invLocations.name,
        warehouseId: invLocations.warehouseId,
        storeName: invWarehouses.name,
        storeCode: invWarehouses.code,
        lotId: invLots.id,
        lotName: invLots.name,
        expiryDate: invLots.expiryDate,
        manufacturingDate: invLots.manufacturingDate,
      })
      .from(invStockQuants)
      .innerJoin(invLots, eq(invStockQuants.lotId, invLots.id))
      .innerJoin(invLocations, eq(invStockQuants.locationId, invLocations.id))
      .innerJoin(invWarehouses, eq(invLocations.warehouseId, invWarehouses.id))
      .where(and(...conditions))
      .orderBy(asc(invLots.expiryDate));

    const todayMs = new Date(todayStr).getTime();

    const items = rows.map((r) => {
      const expiryMs = new Date(r.expiryDate!).getTime();
      const diffDays = Math.ceil((expiryMs - todayMs) / (1000 * 60 * 60 * 24));
      const onHand = Number(r.quantity);
      const reserved = Number(r.reservedQuantity);
      const available = Number((onHand - reserved).toFixed(3));
      const costPaise = r.costPricePaise ? Number(r.costPricePaise) : 0;
      const stockValuePaise = Math.round(onHand * costPaise);

      let status: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'HEALTHY';
      if (diffDays < 0) {
        status = 'EXPIRED';
      } else if (diffDays <= 2) {
        status = 'CRITICAL';
      } else if (diffDays <= 7) {
        status = 'WARNING';
      } else {
        status = 'HEALTHY';
      }

      return {
        quantId: r.quantId,
        warehouseId: r.warehouseId,
        storeName: r.storeName,
        storeCode: r.storeCode,
        locationId: r.locationId,
        locationName: r.locationName,
        productId: r.productId,
        lotId: r.lotId,
        lotName: r.lotName,
        manufacturingDate: r.manufacturingDate,
        expiryDate: r.expiryDate,
        daysUntilExpiry: diffDays,
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        availableQuantity: available,
        unitCostPaise: costPaise,
        stockValuePaise,
        status,
      };
    });

    // Group items by Store / Warehouse
    const groupedByStore = new Map<
      string,
      {
        warehouseId: string;
        storeName: string;
        storeCode: string;
        totalLots: number;
        totalUnits: number;
        expiredUnits: number;
        criticalUnits: number;
        warningUnits: number;
        totalValuePaise: number;
        items: typeof items;
      }
    >();

    for (const item of items) {
      if (!groupedByStore.has(item.warehouseId)) {
        groupedByStore.set(item.warehouseId, {
          warehouseId: item.warehouseId,
          storeName: item.storeName,
          storeCode: item.storeCode,
          totalLots: 0,
          totalUnits: 0,
          expiredUnits: 0,
          criticalUnits: 0,
          warningUnits: 0,
          totalValuePaise: 0,
          items: [],
        });
      }

      const grp = groupedByStore.get(item.warehouseId)!;
      grp.totalLots += 1;
      grp.totalUnits += item.onHandQuantity;
      if (item.status === 'EXPIRED') grp.expiredUnits += item.onHandQuantity;
      if (item.status === 'CRITICAL') grp.criticalUnits += item.onHandQuantity;
      if (item.status === 'WARNING') grp.warningUnits += item.onHandQuantity;
      grp.totalValuePaise += item.stockValuePaise;
      grp.items.push(item);
    }

    return {
      asOfDate: todayStr,
      horizonDays: query.days,
      cutoffDate: cutoffStr,
      totalExpiringLots: items.length,
      totalExpiringUnits: items.reduce((s, i) => s + i.onHandQuantity, 0),
      totalAtRiskValuePaise: items.reduce((s, i) => s + i.stockValuePaise, 0),
      stores: Array.from(groupedByStore.values()),
      data: items,
    };
  }

  // ==========================================
  // 5. RESERVATIONS (LIFECYCLE & TIMEOUT)
  // ==========================================

  async createReservation(input: CreateReservationInput) {
    const parsed = createReservationSchema.parse(input);
    const today = new Date().toISOString().slice(0, 10);

    const reservation = await this.db.transaction(async (tx) => {
      // 1. Validate location
      const [loc] = await tx
        .select({
          id: invLocations.id,
          warehouseId: invLocations.warehouseId,
          type: invLocations.type,
          merchantId: invWarehouses.merchantId,
        })
        .from(invLocations)
        .innerJoin(invWarehouses, eq(invLocations.warehouseId, invWarehouses.id))
        .where(eq(invLocations.id, parsed.locationId))
        .limit(1);

      if (!loc) {
        throw new NotFoundException('Location not found');
      }

      if (loc.type !== 'INTERNAL') {
        throw new BadRequestException('Reservations must be created at INTERNAL storage locations');
      }

      if (loc.merchantId !== parsed.merchantId) {
        throw new ForbiddenException('Location does not belong to the authorized merchant');
      }

      // 2. Select eligible quant & lot
      let quantRow;
      if (parsed.lotId) {
        // Explicit lot reservation
        const [lot] = await tx
          .select()
          .from(invLots)
          .where(eq(invLots.id, parsed.lotId))
          .limit(1);

        if (!lot) {
          throw new NotFoundException('Specified lot not found');
        }

        if (lot.expiryDate && lot.expiryDate < today) {
          throw new BadRequestException(`Cannot reserve expired lot '${lot.name}' (expired on ${lot.expiryDate})`);
        }

        const [q] = await tx
          .select()
          .from(invStockQuants)
          .where(
            and(
              eq(invStockQuants.productId, parsed.productId),
              eq(invStockQuants.locationId, parsed.locationId),
              eq(invStockQuants.lotId, parsed.lotId),
            ),
          )
          .for('update');

        if (!q) {
          throw new BadRequestException('No stock quant exists for the specified lot');
        }

        const available = Number(q.quantity) - Number(q.reservedQuantity);
        if (available < parsed.quantity) {
          throw new BadRequestException(
            `Insufficient available stock for lot '${lot.name}'. Available: ${available.toFixed(3)}, Requested: ${parsed.quantity.toFixed(3)}`,
          );
        }

        quantRow = q;
      } else {
        // Auto FEFO selection
        const candidateQuants = await tx
          .select({
            id: invStockQuants.id,
            quantity: invStockQuants.quantity,
            reservedQuantity: invStockQuants.reservedQuantity,
            lotId: invStockQuants.lotId,
            expiryDate: invLots.expiryDate,
          })
          .from(invStockQuants)
          .leftJoin(invLots, eq(invStockQuants.lotId, invLots.id))
          .where(
            and(
              eq(invStockQuants.productId, parsed.productId),
              eq(invStockQuants.locationId, parsed.locationId),
            ),
          )
          .orderBy(asc(invLots.expiryDate));

        const eligible = candidateQuants.filter(
          (q) => !q.expiryDate || q.expiryDate >= today,
        );

        const chosen = eligible.find((q) => {
          const avail = Number(q.quantity) - Number(q.reservedQuantity);
          return avail >= parsed.quantity;
        });

        if (!chosen) {
          throw new BadRequestException(
            `Insufficient available non-expired stock to satisfy reservation of ${parsed.quantity.toFixed(3)} units.`,
          );
        }

        const [lockedQuant] = await tx
          .select()
          .from(invStockQuants)
          .where(eq(invStockQuants.id, chosen.id))
          .for('update');

        if (!lockedQuant) {
          throw new BadRequestException('Selected stock quant no longer exists');
        }

        const freshAvail = Number(lockedQuant.quantity) - Number(lockedQuant.reservedQuantity);
        if (freshAvail < parsed.quantity) {
          throw new BadRequestException(
            `Insufficient available non-expired stock to satisfy reservation of ${parsed.quantity.toFixed(3)} units.`,
          );
        }

        quantRow = lockedQuant;
      }

      // 3. Increment reserved_quantity on quant atomically
      const newReserved = (Number(quantRow.reservedQuantity) + parsed.quantity).toFixed(3);
      await tx
        .update(invStockQuants)
        .set({
          reservedQuantity: newReserved,
          updatedAt: new Date(),
        })
        .where(eq(invStockQuants.id, quantRow.id));

      // 4. Insert into inv_reservations
      const expiresAt = new Date(Date.now() + parsed.timeoutMinutes * 60000);

      const [res] = await tx
        .insert(invReservations)
        .values({
          merchantId: parsed.merchantId,
          orderReference: parsed.orderReference,
          productId: parsed.productId,
          variantId: parsed.variantId,
          locationId: parsed.locationId,
          lotId: quantRow.lotId,
          quantId: quantRow.id,
          quantity: parsed.quantity.toFixed(3),
          state: 'RESERVED',
          expiresAt,
          createdBy: parsed.createdBy,
        })
        .returning();

      return res;
    });

    // Schedule BullMQ timeout expiration job
    if (this.jobsService) {
      try {
        await this.jobsService.scheduleReservationExpiry(
          reservation.id,
          reservation.orderReference,
          reservation.merchantId,
          parsed.timeoutMinutes * 60000,
        );
      } catch (err) {
        console.warn(`[InventoryService] BullMQ schedule notice:`, err);
      }
    }

    return reservation;
  }

  async getReservations(query: ReservationQuery) {
    const conditions = [];

    if (query.merchantId) {
      conditions.push(eq(invReservations.merchantId, query.merchantId));
    }

    if (query.orderReference) {
      conditions.push(eq(invReservations.orderReference, query.orderReference));
    }

    if (query.productId) {
      conditions.push(eq(invReservations.productId, query.productId));
    }

    if (query.state) {
      conditions.push(eq(invReservations.state, query.state));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(invReservations)
        .where(whereClause)
        .orderBy(desc(invReservations.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),

      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(invReservations)
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

  async getReservationById(id: string, merchantId?: string) {
    const [res] = await this.db
      .select()
      .from(invReservations)
      .where(eq(invReservations.id, id))
      .limit(1);

    if (!res) {
      throw new NotFoundException(`Reservation with ID ${id} not found`);
    }

    if (merchantId && res.merchantId !== merchantId) {
      throw new ForbiddenException('Cross-merchant reservation access denied');
    }

    return res;
  }

  async confirmReservation(id: string, merchantId?: string) {
    return await this.db.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(invReservations)
        .where(eq(invReservations.id, id))
        .for('update');

      if (!res) {
        throw new NotFoundException(`Reservation with ID ${id} not found`);
      }

      if (merchantId && res.merchantId !== merchantId) {
        throw new ForbiddenException('Cross-merchant reservation confirmation denied');
      }

      // Idempotency
      if (res.state === 'CONFIRMED') {
        return res;
      }

      if (res.state !== 'RESERVED') {
        throw new BadRequestException(
          `Cannot confirm reservation in '${res.state}' state. Only active RESERVED orders can be confirmed.`,
        );
      }

      const [updated] = await tx
        .update(invReservations)
        .set({
          state: 'CONFIRMED',
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invReservations.id, id))
        .returning();

      return updated;
    });
  }

  async pickReservation(id: string, merchantId?: string) {
    return await this.db.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(invReservations)
        .where(eq(invReservations.id, id))
        .for('update');

      if (!res) {
        throw new NotFoundException(`Reservation with ID ${id} not found`);
      }

      if (merchantId && res.merchantId !== merchantId) {
        throw new ForbiddenException('Cross-merchant pick denied');
      }

      if (res.state === 'PICKED') {
        return res;
      }

      if (res.state !== 'CONFIRMED') {
        throw new BadRequestException(
          `Cannot pick reservation in '${res.state}' state. Reservation must be CONFIRMED before picking.`,
        );
      }

      const [updated] = await tx
        .update(invReservations)
        .set({
          state: 'PICKED',
          pickedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invReservations.id, id))
        .returning();

      return updated;
    });
  }

  async deliverReservation(id: string, merchantId?: string, customerLocationId?: string) {
    return await this.db.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(invReservations)
        .where(eq(invReservations.id, id))
        .for('update');

      if (!res) {
        throw new NotFoundException(`Reservation with ID ${id} not found`);
      }

      if (merchantId && res.merchantId !== merchantId) {
        throw new ForbiddenException('Cross-merchant delivery denied');
      }

      if (res.state === 'DELIVERED') {
        return res;
      }

      if (res.state !== 'PICKED') {
        throw new BadRequestException(
          `Cannot deliver reservation in '${res.state}' state. Reservation must be PICKED before final delivery.`,
        );
      }

      // Lock quant row
      const [quant] = await tx
        .select()
        .from(invStockQuants)
        .where(eq(invStockQuants.id, res.quantId!))
        .for('update');

      const qtyNum = Number(res.quantity);
      const newOnHand = Math.max(0, Number(quant.quantity) - qtyNum).toFixed(3);
      const newReserved = Math.max(0, Number(quant.reservedQuantity) - qtyNum).toFixed(3);

      await tx
        .update(invStockQuants)
        .set({
          quantity: newOnHand,
          reservedQuantity: newReserved,
          updatedAt: new Date(),
        })
        .where(eq(invStockQuants.id, quant.id));

      // Resolve customer location
      let custLocId = customerLocationId;
      if (!custLocId) {
        const [sourceLoc] = await tx
          .select({ warehouseId: invLocations.warehouseId })
          .from(invLocations)
          .where(eq(invLocations.id, res.locationId))
          .limit(1);

        const [foundCust] = await tx
          .select({ id: invLocations.id })
          .from(invLocations)
          .where(
            and(
              eq(invLocations.warehouseId, sourceLoc.warehouseId),
              eq(invLocations.type, 'CUSTOMER'),
            ),
          )
          .limit(1);

        custLocId = foundCust ? foundCust.id : res.locationId;
      }

      // Post SALE movement
      await tx.insert(invStockMoves).values({
        referenceId: `DELIVERY-${res.orderReference}`,
        referenceType: 'SALE',
        productId: res.productId,
        variantId: res.variantId,
        lotId: res.lotId,
        sourceLocationId: res.locationId,
        destinationLocationId: custLocId,
        quantity: res.quantity,
        state: 'DONE',
        doneDate: new Date(),
        performedBy: 'fulfillment-courier',
        notes: `Order delivery fulfilled for order ${res.orderReference}`,
      });

      const [updated] = await tx
        .update(invReservations)
        .set({
          state: 'DELIVERED',
          deliveredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invReservations.id, id))
        .returning();

      return updated;
    });
  }

  async cancelReservation(
    id: string,
    input?: CancelReservationInput,
    merchantId?: string,
  ) {
    return await this.db.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(invReservations)
        .where(eq(invReservations.id, id))
        .for('update');

      if (!res) {
        throw new NotFoundException(`Reservation with ID ${id} not found`);
      }

      if (merchantId && res.merchantId !== merchantId) {
        throw new ForbiddenException('Cross-merchant cancellation denied');
      }

      if (res.state === 'CANCELLED') {
        return res;
      }

      if (res.state === 'DELIVERED') {
        throw new BadRequestException('Cannot cancel an order that has already been DELIVERED.');
      }

      if (res.state === 'EXPIRED' || res.state === 'RELEASED') {
        return res;
      }

      // If items have NOT been physically picked yet (state RESERVED or CONFIRMED):
      if (res.state === 'RESERVED' || res.state === 'CONFIRMED') {
        const [quant] = await tx
          .select()
          .from(invStockQuants)
          .where(eq(invStockQuants.id, res.quantId!))
          .for('update');

        if (quant) {
          const qty = Number(res.quantity);
          const newReserved = Math.max(0, Number(quant.reservedQuantity) - qty).toFixed(3);
          await tx
            .update(invStockQuants)
            .set({
              reservedQuantity: newReserved,
              updatedAt: new Date(),
            })
            .where(eq(invStockQuants.id, quant.id));
        }

        const [cancelled] = await tx
          .update(invReservations)
          .set({
            state: 'CANCELLED',
            releasedAt: new Date(),
            cancelledAt: new Date(),
            cancellationReason: input?.reason ?? 'Customer requested cancellation',
            updatedAt: new Date(),
          })
          .where(eq(invReservations.id, id))
          .returning();

        return cancelled;
      }

      // If state is PICKED: Physical stock disposition handling (Section 6.3)
      if (res.state === 'PICKED') {
        const disposition = input?.disposition ?? 'RETURN_TO_STOCK';

        const [quant] = await tx
          .select()
          .from(invStockQuants)
          .where(eq(invStockQuants.id, res.quantId!))
          .for('update');

        if (disposition === 'RETURN_TO_STOCK') {
          // Physically verified return to shelf
          if (quant) {
            const qty = Number(res.quantity);
            const newReserved = Math.max(0, Number(quant.reservedQuantity) - qty).toFixed(3);
            await tx
              .update(invStockQuants)
              .set({
                reservedQuantity: newReserved,
                updatedAt: new Date(),
              })
              .where(eq(invStockQuants.id, quant.id));
          }
        } else if (disposition === 'SCRAP') {
          // Damaged during picking or packing: move to scrap location
          const [sourceLoc] = await tx
            .select({ warehouseId: invLocations.warehouseId })
            .from(invLocations)
            .where(eq(invLocations.id, res.locationId))
            .limit(1);

          let [scrapLoc] = await tx
            .select()
            .from(invLocations)
            .where(
              and(
                eq(invLocations.warehouseId, sourceLoc.warehouseId),
                eq(invLocations.type, 'SCRAP'),
              ),
            )
            .limit(1);

          if (!scrapLoc) {
            const [createdScrap] = await tx
              .insert(invLocations)
              .values({
                warehouseId: sourceLoc.warehouseId,
                name: 'Scrap & Damage Bin',
                code: `SCRAP-AUTO-${sourceLoc.warehouseId.slice(0, 6)}`,
                type: 'SCRAP',
              })
              .returning();
            scrapLoc = createdScrap;
          }

          // Deduct from shelf and place in scrap
          if (quant) {
            const qty = Number(res.quantity);
            const newOnHand = Math.max(0, Number(quant.quantity) - qty).toFixed(3);
            const newReserved = Math.max(0, Number(quant.reservedQuantity) - qty).toFixed(3);
            await tx
              .update(invStockQuants)
              .set({
                quantity: newOnHand,
                reservedQuantity: newReserved,
                updatedAt: new Date(),
              })
              .where(eq(invStockQuants.id, quant.id));
          }

          await tx.insert(invStockMoves).values({
            referenceId: `CANCEL-SCRAP-${res.orderReference}`,
            referenceType: 'SCRAP',
            productId: res.productId,
            variantId: res.variantId,
            lotId: res.lotId,
            sourceLocationId: res.locationId,
            destinationLocationId: scrapLoc.id,
            quantity: res.quantity,
            state: 'DONE',
            doneDate: new Date(),
            performedBy: input?.performedBy ?? 'picker-supervisor',
            notes: `Item damaged during order picking. Cancelled: ${input?.reason ?? 'Damage upon pack'}`,
          });
        }

        const [cancelled] = await tx
          .update(invReservations)
          .set({
            state: 'CANCELLED',
            releasedAt: new Date(),
            cancelledAt: new Date(),
            cancellationReason: `Cancelled after picking: ${input?.reason ?? 'Order cancelled'} (Disposition: ${disposition})`,
            updatedAt: new Date(),
          })
          .where(eq(invReservations.id, id))
          .returning();

        return cancelled;
      }

      return res;
    });
  }

  async releaseReservation(id: string, reason = 'TIMEOUT') {
    return await this.db.transaction(async (tx) => {
      // Atomic conditional update ensures EXACTLY ONCE release
      const [res] = await tx
        .select()
        .from(invReservations)
        .where(eq(invReservations.id, id))
        .for('update');

      if (!res) {
        return { released: false, state: 'NOT_FOUND' };
      }

      // If already resolved, return harmlessly
      if (res.state !== 'RESERVED') {
        return { released: false, state: res.state };
      }

      // Atomically mark EXPIRED / RELEASED
      const [updated] = await tx
        .update(invReservations)
        .set({
          state: 'EXPIRED',
          releasedAt: new Date(),
          cancellationReason: `Automatically released due to ${reason}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(invReservations.id, id),
            eq(invReservations.state, 'RESERVED'),
          ),
        )
        .returning();

      if (!updated) {
        return { released: false, state: 'CONCURRENTLY_RESOLVED' };
      }

      // Decrement quant reserved_quantity
      if (res.quantId) {
        const [quant] = await tx
          .select()
          .from(invStockQuants)
          .where(eq(invStockQuants.id, res.quantId))
          .for('update');

        if (quant) {
          const qty = Number(res.quantity);
          const newReserved = Math.max(0, Number(quant.reservedQuantity) - qty).toFixed(3);
          await tx
            .update(invStockQuants)
            .set({
              reservedQuantity: newReserved,
              updatedAt: new Date(),
            })
            .where(eq(invStockQuants.id, quant.id));
        }
      }

      return { released: true, state: 'EXPIRED', reservation: updated };
    });
  }

  // ==========================================
  // 6. TWO-STEP TRANSFERS & SHORTAGE RECONCILIATION
  // ==========================================

  async createTransfer(input: CreateTransferInput) {
    const parsed = createTransferSchema.parse(input);
    const today = new Date().toISOString().slice(0, 10);

    return await this.db.transaction(async (tx) => {
      // Concurrency-safe atomic transfer sequence counter
      const [counter] = await tx
        .insert(invTransferCounters)
        .values({
          counterDate: today,
          seq: 1,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: invTransferCounters.counterDate,
          set: {
            seq: sql`${invTransferCounters.seq} + 1`,
            updatedAt: new Date(),
          },
        })
        .returning({ seq: invTransferCounters.seq });

      const transferNumber = `TR-${today.replace(/-/g, '')}-${String(counter.seq).padStart(4, '0')}`;

      const [transfer] = await tx
        .insert(invTransfers)
        .values({
          transferNumber,
          type: parsed.type,
          warehouseId: parsed.warehouseId,
          sourceLocationId: parsed.sourceLocationId,
          destinationLocationId: parsed.destinationLocationId,
          partnerId: parsed.partnerId,
          partnerType: parsed.partnerType,
          referenceId: parsed.referenceId,
          referenceType: parsed.referenceType,
          state: 'DRAFT',
          scheduledDate: parsed.scheduledDate ? new Date(parsed.scheduledDate) : null,
          notes: parsed.notes,
          createdBy: parsed.createdBy,
        })
        .returning();

      return transfer;
    });
  }

  async getTransfers(query: TransferQuery) {
    const conditions = [];

    if (query.warehouseId) {
      conditions.push(eq(invTransfers.warehouseId, query.warehouseId));
    }

    if (query.state) {
      conditions.push(eq(invTransfers.state, query.state));
    }

    if (query.type) {
      conditions.push(eq(invTransfers.type, query.type));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(invTransfers)
        .where(whereClause)
        .orderBy(desc(invTransfers.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),

      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(invTransfers)
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

  async getTransferById(id: string) {
    const [transfer] = await this.db
      .select()
      .from(invTransfers)
      .where(eq(invTransfers.id, id))
      .limit(1);

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${id} not found`);
    }

    const movements = await this.db
      .select()
      .from(invStockMoves)
      .where(eq(invStockMoves.transferId, id))
      .orderBy(asc(invStockMoves.createdAt));

    return {
      ...transfer,
      movements,
    };
  }

  async confirmTransfer(id: string) {
    const [transfer] = await this.db
      .select()
      .from(invTransfers)
      .where(eq(invTransfers.id, id))
      .limit(1);

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${id} not found`);
    }

    if (transfer.state === 'CONFIRMED') {
      return transfer;
    }

    if (transfer.state !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot confirm transfer in '${transfer.state}' state. Only DRAFT transfers can be confirmed.`,
      );
    }

    const [updated] = await this.db
      .update(invTransfers)
      .set({
        state: 'CONFIRMED',
        updatedAt: new Date(),
      })
      .where(eq(invTransfers.id, id))
      .returning();

    return updated;
  }

  async dispatchTransfer(id: string, input: DispatchTransferInput) {
    const parsed = dispatchTransferSchema.parse(input);

    return await this.db.transaction(async (tx) => {
      // 1. Lock transfer row
      const [transfer] = await tx
        .select()
        .from(invTransfers)
        .where(eq(invTransfers.id, id))
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`Transfer with ID ${id} not found`);
      }

      if (transfer.state === 'IN_PROGRESS') {
        throw new BadRequestException('Transfer has already been dispatched.');
      }

      if (transfer.state === 'DONE') {
        throw new BadRequestException('Transfer is already completed.');
      }

      if (transfer.state !== 'CONFIRMED') {
        throw new BadRequestException(
          `Cannot dispatch transfer in '${transfer.state}' state. Transfer must be CONFIRMED before dispatch.`,
        );
      }

      if (!transfer.sourceLocationId || !transfer.destinationLocationId) {
        throw new BadRequestException('Transfer requires valid source and destination locations');
      }

      // 2. Resolve TRANSIT location
      let transitLocId = parsed.transitLocationId;
      if (!transitLocId) {
        const [foundTransit] = await tx
          .select({ id: invLocations.id })
          .from(invLocations)
          .where(
            and(
              eq(invLocations.warehouseId, transfer.warehouseId),
              eq(invLocations.type, 'TRANSIT'),
            ),
          )
          .limit(1);

        if (foundTransit) {
          transitLocId = foundTransit.id;
        } else {
          const [newTransit] = await tx
            .insert(invLocations)
            .values({
              warehouseId: transfer.warehouseId,
              name: 'In-Transit Van / Logistics',
              code: `TRANSIT-${transfer.warehouseId.slice(0, 6)}`,
              type: 'TRANSIT',
            })
            .returning();
          transitLocId = newTransit.id;
        }
      }

      // 3. For each product line, move from source location to TRANSIT
      const dispatchedMovements = [];
      for (const line of parsed.lines) {
        // Lock source quant
        let sourceQuant;
        if (line.lotId) {
          const [sq] = await tx
            .select()
            .from(invStockQuants)
            .where(
              and(
                eq(invStockQuants.productId, line.productId),
                line.variantId
                  ? eq(invStockQuants.variantId, line.variantId)
                  : isNull(invStockQuants.variantId),
                eq(invStockQuants.locationId, transfer.sourceLocationId),
                eq(invStockQuants.lotId, line.lotId),
              ),
            )
            .for('update');
          sourceQuant = sq;
        } else {
          const candidates = await tx
            .select()
            .from(invStockQuants)
            .where(
              and(
                eq(invStockQuants.productId, line.productId),
                line.variantId
                  ? eq(invStockQuants.variantId, line.variantId)
                  : isNull(invStockQuants.variantId),
                eq(invStockQuants.locationId, transfer.sourceLocationId),
                sql`(${invStockQuants.quantity} - ${invStockQuants.reservedQuantity}) >= ${line.quantity}`,
              ),
            )
            .for('update');
          sourceQuant = candidates[0];
        }

        const available = sourceQuant
          ? Number(sourceQuant.quantity) - Number(sourceQuant.reservedQuantity)
          : 0;

        if (!sourceQuant || available < line.quantity) {
          throw new BadRequestException(
            `Insufficient stock to dispatch product ${line.productId}. Available: ${available.toFixed(3)}, Required: ${line.quantity.toFixed(3)}`,
          );
        }

        const effectiveLotId = line.lotId ?? sourceQuant.lotId;

        // Deduct from source quant
        const newSourceQty = (Number(sourceQuant.quantity) - line.quantity).toFixed(3);
        await tx
          .update(invStockQuants)
          .set({
            quantity: newSourceQty,
            updatedAt: new Date(),
          })
          .where(eq(invStockQuants.id, sourceQuant.id));

        // Add to TRANSIT quant (In-transit stock is tracked, but not sellable!)
        const [transitQuant] = await tx
          .select()
          .from(invStockQuants)
          .where(
            and(
              eq(invStockQuants.productId, line.productId),
              line.variantId
                ? eq(invStockQuants.variantId, line.variantId)
                : isNull(invStockQuants.variantId),
              eq(invStockQuants.locationId, transitLocId),
              effectiveLotId
                ? eq(invStockQuants.lotId, effectiveLotId)
                : isNull(invStockQuants.lotId),
            ),
          )
          .for('update');

        if (transitQuant) {
          const newTransitQty = (Number(transitQuant.quantity) + line.quantity).toFixed(3);
          await tx
            .update(invStockQuants)
            .set({
              quantity: newTransitQty,
              updatedAt: new Date(),
            })
            .where(eq(invStockQuants.id, transitQuant.id));
        } else {
          await tx.insert(invStockQuants).values({
            productId: line.productId,
            variantId: line.variantId,
            locationId: transitLocId,
            lotId: effectiveLotId,
            quantity: line.quantity.toFixed(3),
            reservedQuantity: '0.000',
            costPricePaise: sourceQuant.costPricePaise,
          });
        }

        // Record dispatch movement
        const [move] = await tx
          .insert(invStockMoves)
          .values({
            referenceId: `DISPATCH-${transfer.transferNumber}`,
            referenceType: 'TRANSFER',
            productId: line.productId,
            variantId: line.variantId,
            lotId: effectiveLotId,
            sourceLocationId: transfer.sourceLocationId,
            destinationLocationId: transitLocId,
            quantity: line.quantity.toFixed(3),
            state: 'DONE',
            doneDate: new Date(),
            transferId: transfer.id,
            performedBy: parsed.performedBy,
            notes: `Transfer ${transfer.transferNumber} dispatch: Moved into Transit`,
          })
          .returning();

        dispatchedMovements.push(move);
      }

      // 4. Update transfer state to IN_PROGRESS
      const [updatedTransfer] = await tx
        .update(invTransfers)
        .set({
          state: 'IN_PROGRESS',
          updatedAt: new Date(),
        })
        .where(eq(invTransfers.id, id))
        .returning();

      return {
        transfer: updatedTransfer,
        transitLocationId: transitLocId,
        movements: dispatchedMovements,
      };
    });
  }

  async receiveTransfer(id: string, input: ReceiveTransferInput) {
    const parsed = receiveTransferSchema.parse(input);

    return await this.db.transaction(async (tx) => {
      // 1. Lock transfer row
      const [transfer] = await tx
        .select()
        .from(invTransfers)
        .where(eq(invTransfers.id, id))
        .for('update');

      if (!transfer) {
        throw new NotFoundException(`Transfer with ID ${id} not found`);
      }

      if (transfer.state === 'DONE') {
        throw new BadRequestException('Transfer has already been received and completed.');
      }

      if (transfer.state !== 'IN_PROGRESS') {
        throw new BadRequestException(
          `Cannot receive transfer in '${transfer.state}' state. Transfer must be IN_PROGRESS (dispatched) before receipt.`,
        );
      }

      // 2. Fetch all dispatch movements for this transfer to identify transit location & verify quantities
      const dispatchMoves = await tx
        .select()
        .from(invStockMoves)
        .where(
          and(
            eq(invStockMoves.transferId, transfer.id),
            eq(invStockMoves.sourceLocationId, transfer.sourceLocationId!),
          ),
        );

      if (dispatchMoves.length === 0) {
        throw new BadRequestException('No dispatch movements found for this transfer.');
      }

      const transitLocationId = dispatchMoves[0].destinationLocationId;

      // 3. Resolve LOSS / shortage location
      let lossLocId = parsed.lossLocationId;
      if (!lossLocId) {
        const [foundLoss] = await tx
          .select({ id: invLocations.id })
          .from(invLocations)
          .where(
            and(
              eq(invLocations.warehouseId, transfer.warehouseId),
              eq(invLocations.type, 'LOSS'),
            ),
          )
          .limit(1);

        if (foundLoss) {
          lossLocId = foundLoss.id;
        } else {
          const [newLoss] = await tx
            .insert(invLocations)
            .values({
              warehouseId: transfer.warehouseId,
              name: 'Inventory Variance & Loss',
              code: `LOSS-AUTO-${transfer.warehouseId.slice(0, 6)}`,
              type: 'LOSS',
            })
            .returning();
          lossLocId = newLoss.id;
        }
      }

      // 4. Invariant check: dispatched = received + shortage
      const receiptMovements = [];

      for (const line of parsed.lines) {
        const totalAccounted = Number(
          (line.receivedQuantity + line.shortageQuantity).toFixed(3),
        );

        // Find corresponding dispatch movement
        const dMove = dispatchMoves.find(
          (m) =>
            m.productId === line.productId &&
            (line.lotId ? m.lotId === line.lotId : true),
        );

        if (!dMove) {
          throw new BadRequestException(
            `Product ${line.productId} was not part of the dispatch for transfer ${transfer.transferNumber}`,
          );
        }

        const dispatchedQty = Number(dMove.quantity);
        if (Math.abs(totalAccounted - dispatchedQty) > 0.001) {
          throw new BadRequestException(
            `Reconciliation invariant violated for product ${line.productId}. Dispatched: ${dispatchedQty.toFixed(3)}, but Received (${line.receivedQuantity.toFixed(3)}) + Shortage (${line.shortageQuantity.toFixed(3)}) = ${totalAccounted.toFixed(3)}. Dispatched must exactly equal received plus shortage.`,
          );
        }

        const effectiveLotId = line.lotId ?? dMove.lotId;

        // Deduct full dispatched quantity from TRANSIT quant
        const [transitQuant] = await tx
          .select()
          .from(invStockQuants)
          .where(
            and(
              eq(invStockQuants.productId, line.productId),
              line.variantId
                ? eq(invStockQuants.variantId, line.variantId)
                : isNull(invStockQuants.variantId),
              eq(invStockQuants.locationId, transitLocationId),
              effectiveLotId
                ? eq(invStockQuants.lotId, effectiveLotId)
                : isNull(invStockQuants.lotId),
            ),
          )
          .for('update');

        if (transitQuant) {
          const newTransitQty = Math.max(
            0,
            Number(transitQuant.quantity) - dispatchedQty,
          ).toFixed(3);
          await tx
            .update(invStockQuants)
            .set({
              quantity: newTransitQty,
              updatedAt: new Date(),
            })
            .where(eq(invStockQuants.id, transitQuant.id));
        }

        // Move receivedQuantity into destination location INTERNAL quant
        if (line.receivedQuantity > 0) {
          const [destQuant] = await tx
            .select()
            .from(invStockQuants)
            .where(
              and(
                eq(invStockQuants.productId, line.productId),
                line.variantId
                  ? eq(invStockQuants.variantId, line.variantId)
                  : isNull(invStockQuants.variantId),
                eq(invStockQuants.locationId, transfer.destinationLocationId!),
                effectiveLotId
                  ? eq(invStockQuants.lotId, effectiveLotId)
                  : isNull(invStockQuants.lotId),
              ),
            )
            .for('update');

          if (destQuant) {
            const newDestQty = (
              Number(destQuant.quantity) + line.receivedQuantity
            ).toFixed(3);
            await tx
              .update(invStockQuants)
              .set({
                quantity: newDestQty,
                updatedAt: new Date(),
              })
              .where(eq(invStockQuants.id, destQuant.id));
          } else {
            await tx.insert(invStockQuants).values({
              productId: line.productId,
              variantId: line.variantId,
              locationId: transfer.destinationLocationId!,
              lotId: effectiveLotId,
              quantity: line.receivedQuantity.toFixed(3),
              reservedQuantity: '0.000',
              costPricePaise: dMove.unitCostPaise,
            });
          }

          // Record receipt movement
          const [recvMove] = await tx
            .insert(invStockMoves)
            .values({
              referenceId: `RECV-${transfer.transferNumber}`,
              referenceType: 'TRANSFER',
              productId: line.productId,
              variantId: line.variantId,
              lotId: effectiveLotId,
              sourceLocationId: transitLocationId,
              destinationLocationId: transfer.destinationLocationId!,
              quantity: line.receivedQuantity.toFixed(3),
              state: 'DONE',
              doneDate: new Date(),
              transferId: transfer.id,
              performedBy: parsed.performedBy,
              notes: `Transfer ${transfer.transferNumber} received at destination store.`,
            })
            .returning();

          receiptMovements.push(recvMove);
        }

        // If there is a shortage, post shortage movement to LOSS location
        if (line.shortageQuantity > 0) {
          const [shortMove] = await tx
            .insert(invStockMoves)
            .values({
              referenceId: `SHORTAGE-${transfer.transferNumber}`,
              referenceType: 'TRANSFER',
              productId: line.productId,
              variantId: line.variantId,
              lotId: effectiveLotId,
              sourceLocationId: transitLocationId,
              destinationLocationId: lossLocId,
              quantity: line.shortageQuantity.toFixed(3),
              state: 'DONE',
              doneDate: new Date(),
              transferId: transfer.id,
              performedBy: parsed.performedBy,
              notes: `Transfer ${transfer.transferNumber} shortage recorded: ${line.shortageReason ?? 'Missing/broken in transit'}`,
            })
            .returning();

          receiptMovements.push(shortMove);
        }
      }

      // Complete transfer
      const [completedTransfer] = await tx
        .update(invTransfers)
        .set({
          state: 'DONE',
          doneDate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invTransfers.id, id))
        .returning();

      return {
        transfer: completedTransfer,
        movements: receiptMovements,
      };
    });
  }

  async cancelTransfer(id: string) {
    const [transfer] = await this.db
      .select()
      .from(invTransfers)
      .where(eq(invTransfers.id, id))
      .limit(1);

    if (!transfer) {
      throw new NotFoundException(`Transfer with ID ${id} not found`);
    }

    if (transfer.state === 'DONE') {
      throw new BadRequestException('Cannot cancel a completed (DONE) transfer.');
    }

    if (transfer.state === 'IN_PROGRESS') {
      throw new BadRequestException(
        'Cannot cancel an IN_PROGRESS transfer directly. Goods are in transit. Complete receipt or post a reversal transfer.',
      );
    }

    if (transfer.state === 'CANCELLED') {
      return transfer;
    }

    const [updated] = await this.db
      .update(invTransfers)
      .set({
        state: 'CANCELLED',
        updatedAt: new Date(),
      })
      .where(eq(invTransfers.id, id))
      .returning();

    return updated;
  }

  // ==========================================
  // 7. SCRAP & TWO-PERSON APPROVAL WORKFLOW
  // ==========================================

  async createScrap(input: CreateScrapInput) {
    const parsed = createScrapSchema.parse(input);

    return await this.db.transaction(async (tx) => {
      // 1. Validate locations
      const locations = await tx
        .select({
          id: invLocations.id,
          type: invLocations.type,
          name: invLocations.name,
        })
        .from(invLocations)
        .where(
          sql`${invLocations.id} IN (${parsed.locationId}::uuid, ${parsed.scrapLocationId}::uuid)`,
        );

      const sourceLoc = locations.find((l) => l.id === parsed.locationId);
      const scrapLoc = locations.find((l) => l.id === parsed.scrapLocationId);

      if (!sourceLoc || !scrapLoc) {
        throw new NotFoundException('Source or scrap location not found');
      }

      if (sourceLoc.type !== 'INTERNAL') {
        throw new BadRequestException('Scrap source must be an INTERNAL storage location');
      }

      if (scrapLoc.type !== 'SCRAP') {
        throw new BadRequestException('Destination must be a location of type SCRAP');
      }

      // 2. Validate source quant has sufficient stock
      let sourceQuant;
      if (parsed.lotId) {
        const [sq] = await tx
          .select()
          .from(invStockQuants)
          .where(
            and(
              eq(invStockQuants.productId, parsed.productId),
              parsed.variantId
                ? eq(invStockQuants.variantId, parsed.variantId)
                : isNull(invStockQuants.variantId),
              eq(invStockQuants.locationId, parsed.locationId),
              eq(invStockQuants.lotId, parsed.lotId),
            ),
          )
          .for('update');
        sourceQuant = sq;
      } else {
        const candidates = await tx
          .select()
          .from(invStockQuants)
          .where(
            and(
              eq(invStockQuants.productId, parsed.productId),
              parsed.variantId
                ? eq(invStockQuants.variantId, parsed.variantId)
                : isNull(invStockQuants.variantId),
              eq(invStockQuants.locationId, parsed.locationId),
              sql`(${invStockQuants.quantity} - ${invStockQuants.reservedQuantity}) >= ${parsed.quantity}`,
            ),
          )
          .for('update');
        sourceQuant = candidates[0];
      }

      const available = sourceQuant
        ? Number(sourceQuant.quantity) - Number(sourceQuant.reservedQuantity)
        : 0;

      if (!sourceQuant || available < parsed.quantity) {
        throw new BadRequestException(
          `Insufficient stock at '${sourceLoc.name}' to record scrap. Available: ${available.toFixed(3)}, Requested: ${parsed.quantity.toFixed(3)}`,
        );
      }

      const effectiveLotId = parsed.lotId ?? sourceQuant.lotId;

      // 3. Create scrap entry awaiting approval
      const [scrap] = await tx
        .insert(invStockScrap)
        .values({
          productId: parsed.productId,
          variantId: parsed.variantId,
          lotId: effectiveLotId,
          locationId: parsed.locationId,
          scrapLocationId: parsed.scrapLocationId,
          quantity: parsed.quantity.toFixed(3),
          reason: parsed.reason,
          notes: parsed.notes,
          performedBy: parsed.performedBy,
          approvedBy: null, // Awaiting independent manager approval
        })
        .returning();

      return scrap;
    });
  }

  async getScraps(query: ScrapQuery) {
    const conditions = [];

    if (query.productId) {
      conditions.push(eq(invStockScrap.productId, query.productId));
    }

    if (query.locationId) {
      conditions.push(eq(invStockScrap.locationId, query.locationId));
    }

    if (query.reason) {
      conditions.push(eq(invStockScrap.reason, query.reason));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(invStockScrap)
        .where(whereClause)
        .orderBy(desc(invStockScrap.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),

      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(invStockScrap)
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

  async getScrapById(id: string) {
    const [scrap] = await this.db
      .select()
      .from(invStockScrap)
      .where(eq(invStockScrap.id, id))
      .limit(1);

    if (!scrap) {
      throw new NotFoundException(`Scrap record with ID ${id} not found`);
    }

    return scrap;
  }

  async approveScrap(id: string, input: ApproveScrapInput) {
    const parsed = approveScrapSchema.parse(input);

    return await this.db.transaction(async (tx) => {
      const [scrap] = await tx
        .select()
        .from(invStockScrap)
        .where(eq(invStockScrap.id, id))
        .for('update');

      if (!scrap) {
        throw new NotFoundException(`Scrap record with ID ${id} not found`);
      }

      if (scrap.approvedBy || scrap.stockMoveId) {
        return scrap; // Already approved idempotently
      }

      // CRITICAL FRAUD INVARIANT: Two-Person Rule
      // An employee cannot approve their own inventory write-off!
      if (scrap.performedBy.toLowerCase() === parsed.approvedBy.toLowerCase()) {
        throw new ForbiddenException(
          `Self-approval prohibited. Write-off requested by '${scrap.performedBy}' must be approved by an independent manager.`,
        );
      }

      // Lock source quant and deduct
      const [sourceQuant] = await tx
        .select()
        .from(invStockQuants)
        .where(
          and(
            eq(invStockQuants.productId, scrap.productId),
            scrap.variantId
              ? eq(invStockQuants.variantId, scrap.variantId)
              : isNull(invStockQuants.variantId),
            eq(invStockQuants.locationId, scrap.locationId),
            scrap.lotId
              ? eq(invStockQuants.lotId, scrap.lotId)
              : isNull(invStockQuants.lotId),
          ),
        )
        .for('update');

      const scrapQty = Number(scrap.quantity);
      const available = sourceQuant
        ? Number(sourceQuant.quantity) - Number(sourceQuant.reservedQuantity)
        : 0;

      if (!sourceQuant || available < scrapQty) {
        throw new BadRequestException(
          `Insufficient stock remaining to approve scrap. Available: ${available.toFixed(3)}, Write-off: ${scrapQty.toFixed(3)}`,
        );
      }

      const newSourceQty = (Number(sourceQuant.quantity) - scrapQty).toFixed(3);
      await tx
        .update(invStockQuants)
        .set({
          quantity: newSourceQty,
          updatedAt: new Date(),
        })
        .where(eq(invStockQuants.id, sourceQuant.id));

      // Add to SCRAP location quant
      const [destScrapQuant] = await tx
        .select()
        .from(invStockQuants)
        .where(
          and(
            eq(invStockQuants.productId, scrap.productId),
            scrap.variantId
              ? eq(invStockQuants.variantId, scrap.variantId)
              : isNull(invStockQuants.variantId),
            eq(invStockQuants.locationId, scrap.scrapLocationId),
            scrap.lotId
              ? eq(invStockQuants.lotId, scrap.lotId)
              : isNull(invStockQuants.lotId),
          ),
        )
        .for('update');

      if (destScrapQuant) {
        const newScrapQty = (Number(destScrapQuant.quantity) + scrapQty).toFixed(3);
        await tx
          .update(invStockQuants)
          .set({
            quantity: newScrapQty,
            updatedAt: new Date(),
          })
          .where(eq(invStockQuants.id, destScrapQuant.id));
      } else {
        await tx.insert(invStockQuants).values({
          productId: scrap.productId,
          variantId: scrap.variantId,
          locationId: scrap.scrapLocationId,
          lotId: scrap.lotId,
          quantity: scrapQty.toFixed(3),
          reservedQuantity: '0.000',
          costPricePaise: sourceQuant.costPricePaise,
        });
      }

      // Record immutable SCRAP stock move
      const [move] = await tx
        .insert(invStockMoves)
        .values({
          referenceId: `SCRAP-${scrap.id.slice(0, 8)}`,
          referenceType: 'SCRAP',
          productId: scrap.productId,
          variantId: scrap.variantId,
          lotId: scrap.lotId,
          sourceLocationId: scrap.locationId,
          destinationLocationId: scrap.scrapLocationId,
          quantity: scrap.quantity,
          unitCostPaise: sourceQuant.costPricePaise,
          state: 'DONE',
          doneDate: new Date(),
          performedBy: scrap.performedBy,
          notes: `Scrap write-off: ${scrap.reason}. Approved by ${parsed.approvedBy}. ${scrap.notes ?? ''}`,
        })
        .returning();

      // Update scrap record
      const [updatedScrap] = await tx
        .update(invStockScrap)
        .set({
          approvedBy: parsed.approvedBy,
          stockMoveId: move.id,
        })
        .where(eq(invStockScrap.id, id))
        .returning();

      return {
        scrap: updatedScrap,
        stockMove: move,
      };
    });
  }

  async rejectScrap(id: string, input: RejectScrapInput) {
    const parsed = rejectScrapSchema.parse(input);

    const [scrap] = await this.db
      .select()
      .from(invStockScrap)
      .where(eq(invStockScrap.id, id))
      .limit(1);

    if (!scrap) {
      throw new NotFoundException(`Scrap record with ID ${id} not found`);
    }

    if (scrap.approvedBy || scrap.stockMoveId) {
      throw new BadRequestException('Cannot reject an already approved scrap movement.');
    }

    const [updated] = await this.db
      .update(invStockScrap)
      .set({
        notes: `REJECTED by ${parsed.rejectedBy}: ${parsed.reason}. ${scrap.notes ?? ''}`,
      })
      .where(eq(invStockScrap.id, id))
      .returning();

    return {
      status: 'REJECTED',
      scrap: updated,
    };
  }

  // ==========================================
  // 8. PHYSICAL STOCK COUNT WORKFLOW
  // ==========================================

  async createStockCount(input: CreateCountInput) {
    const parsed = createCountSchema.parse(input);
    const countNumber = `COUNT-${Date.now().toString().slice(-6)}`;

    return await this.db.transaction(async (tx) => {
      // 1. Create count record
      const [count] = await tx
        .insert(invStockCounts)
        .values({
          countNumber,
          warehouseId: parsed.warehouseId,
          locationId: parsed.locationId,
          countedBy: parsed.countedBy,
          notes: parsed.notes,
          state: 'DRAFT',
        })
        .returning();

      // 2. Snapshot current system quants
      const quants = await tx
        .select()
        .from(invStockQuants)
        .where(eq(invStockQuants.locationId, parsed.locationId));

      const lineValues = quants.map((q) => ({
        countId: count.id,
        productId: q.productId,
        lotId: q.lotId,
        systemQuantity: q.quantity,
        countedQuantity: '0.000',
        varianceQuantity: `-${q.quantity}`,
        notes: 'Initial baseline snapshot',
      }));

      if (lineValues.length > 0) {
        await tx.insert(invStockCountLines).values(lineValues);
      }

      return count;
    });
  }

  async getStockCounts(warehouseId?: string) {
    if (warehouseId) {
      return await this.db
        .select()
        .from(invStockCounts)
        .where(eq(invStockCounts.warehouseId, warehouseId))
        .orderBy(desc(invStockCounts.createdAt));
    }
    return await this.db
      .select()
      .from(invStockCounts)
      .orderBy(desc(invStockCounts.createdAt));
  }

  async getStockCountById(id: string) {
    const [count] = await this.db
      .select()
      .from(invStockCounts)
      .where(eq(invStockCounts.id, id))
      .limit(1);

    if (!count) {
      throw new NotFoundException(`Stock count with ID ${id} not found`);
    }

    const lines = await this.db
      .select()
      .from(invStockCountLines)
      .where(eq(invStockCountLines.countId, id));

    return {
      ...count,
      lines,
    };
  }

  async recordCountLines(countId: string, input: RecordCountLinesInput) {
    const parsed = recordCountLinesSchema.parse(input);

    return await this.db.transaction(async (tx) => {
      const [count] = await tx
        .select()
        .from(invStockCounts)
        .where(eq(invStockCounts.id, countId))
        .for('update');

      if (!count) {
        throw new NotFoundException(`Stock count with ID ${countId} not found`);
      }

      if (count.state === 'POSTED') {
        throw new BadRequestException('Cannot edit lines of a POSTED stock count.');
      }

      for (const line of parsed.lines) {
        let existingLine;
        if (line.lotId) {
          [existingLine] = await tx
            .select()
            .from(invStockCountLines)
            .where(
              and(
                eq(invStockCountLines.countId, countId),
                eq(invStockCountLines.productId, line.productId),
                eq(invStockCountLines.lotId, line.lotId),
              ),
            )
            .limit(1);
        } else {
          const candidates = await tx
            .select()
            .from(invStockCountLines)
            .where(
              and(
                eq(invStockCountLines.countId, countId),
                eq(invStockCountLines.productId, line.productId),
              ),
            );

          if (candidates.length === 1) {
            existingLine = candidates[0];
          } else if (candidates.length > 1) {
            existingLine = candidates.find((c) => c.lotId === null) ?? candidates[0];
          }
        }

        if (existingLine) {
          const sysQty = Number(existingLine.systemQuantity);
          const diff = Number((line.countedQuantity - sysQty).toFixed(3));
          await tx
            .update(invStockCountLines)
            .set({
              countedQuantity: line.countedQuantity.toFixed(3),
              varianceQuantity: diff.toFixed(3),
              notes: line.notes,
            })
            .where(eq(invStockCountLines.id, existingLine.id));
        } else {
          // Found unrecorded item during counting!
          await tx.insert(invStockCountLines).values({
            countId,
            productId: line.productId,
            lotId: line.lotId,
            systemQuantity: '0.000',
            countedQuantity: line.countedQuantity.toFixed(3),
            varianceQuantity: line.countedQuantity.toFixed(3),
            notes: line.notes ?? 'Unrecorded item discovered on shelf during count',
          });
        }
      }

      const [updatedCount] = await tx
        .update(invStockCounts)
        .set({
          state: 'REVIEW',
          updatedAt: new Date(),
        })
        .where(eq(invStockCounts.id, countId))
        .returning();

      return updatedCount;
    });
  }

  async reconcileStockCount(countId: string, input: ReconcileCountInput) {
    const parsed = reconcileCountSchema.parse(input);

    return await this.db.transaction(async (tx) => {
      const [count] = await tx
        .select()
        .from(invStockCounts)
        .where(eq(invStockCounts.id, countId))
        .for('update');

      if (!count) {
        throw new NotFoundException(`Stock count with ID ${countId} not found`);
      }

      if (count.state === 'POSTED') {
        return count; // Idempotently completed
      }

      const lines = await tx
        .select()
        .from(invStockCountLines)
        .where(eq(invStockCountLines.countId, countId));

      // Resolve loss/variance location
      let lossLocId = parsed.lossLocationId;
      if (!lossLocId) {
        const [foundLoss] = await tx
          .select({ id: invLocations.id })
          .from(invLocations)
          .where(
            and(
              eq(invLocations.warehouseId, count.warehouseId),
              eq(invLocations.type, 'LOSS'),
            ),
          )
          .limit(1);

        if (foundLoss) {
          lossLocId = foundLoss.id;
        } else {
          const [newLoss] = await tx
            .insert(invLocations)
            .values({
              warehouseId: count.warehouseId,
              name: 'Inventory Variance (Loss/Gain)',
              code: `LOSS-${count.warehouseId.slice(0, 6)}`,
              type: 'LOSS',
            })
            .returning();
          lossLocId = newLoss.id;
        }
      }

      const adjustmentMovements = [];

      for (const line of lines) {
        const variance = Number(line.varianceQuantity);
        if (Math.abs(variance) < 0.0001) continue;

        let srcId: string;
        let dstId: string;

        if (variance > 0) {
          // Discovered extra stock: move from LOSS (virtual) to INTERNAL shelf
          srcId = lossLocId;
          dstId = count.locationId;
        } else {
          // Shrinkage/deficit: move from INTERNAL shelf to LOSS
          srcId = count.locationId;
          dstId = lossLocId;
        }

        const absVariance = Math.abs(variance).toFixed(3);

        // Update quant directly to match counted baseline
        const [quant] = await tx
          .select()
          .from(invStockQuants)
          .where(
            and(
              eq(invStockQuants.productId, line.productId),
              eq(invStockQuants.locationId, count.locationId),
              line.lotId
                ? eq(invStockQuants.lotId, line.lotId)
                : isNull(invStockQuants.lotId),
            ),
          )
          .for('update');

        if (quant) {
          await tx
            .update(invStockQuants)
            .set({
              quantity: line.countedQuantity,
              lastCountDate: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(invStockQuants.id, quant.id));
        } else if (Number(line.countedQuantity) > 0) {
          await tx.insert(invStockQuants).values({
            productId: line.productId,
            locationId: count.locationId,
            lotId: line.lotId,
            quantity: line.countedQuantity,
            reservedQuantity: '0.000',
            lastCountDate: new Date(),
          });
        }

        // Post immutable ADJUSTMENT stock move
        const [move] = await tx
          .insert(invStockMoves)
          .values({
            referenceId: `ADJ-${count.countNumber}`,
            referenceType: 'ADJUSTMENT',
            productId: line.productId,
            lotId: line.lotId,
            sourceLocationId: srcId,
            destinationLocationId: dstId,
            quantity: absVariance,
            state: 'DONE',
            doneDate: new Date(),
            performedBy: parsed.approvedBy,
            notes: `Stock count reconciliation for ${count.countNumber}. Variance: ${variance > 0 ? '+' : ''}${variance.toFixed(3)} units`,
          })
          .returning();

        await tx
          .update(invStockCountLines)
          .set({ adjustmentMoveId: move.id })
          .where(eq(invStockCountLines.id, line.id));

        adjustmentMovements.push(move);
      }

      const [postedCount] = await tx
        .update(invStockCounts)
        .set({
          state: 'POSTED',
          approvedBy: parsed.approvedBy,
          updatedAt: new Date(),
        })
        .where(eq(invStockCounts.id, countId))
        .returning();

      return {
        count: postedCount,
        adjustmentMovements,
      };
    });
  }

  // ==========================================
  // 9. NIGHTLY EXPIRY SWEEP
  // ==========================================

  async runExpirySweep(merchantId?: string) {
    const todayStr = new Date().toISOString().slice(0, 10);

    const conditions = [
      sql`${invStockQuants.quantity} > 0`,
      sql`${invLots.expiryDate} IS NOT NULL`,
      sql`${invLots.expiryDate} < ${todayStr}`,
    ];

    if (merchantId) {
      conditions.push(eq(invWarehouses.merchantId, merchantId));
    }

    const expiredRows = await this.db
      .select({
        quantId: invStockQuants.id,
        productId: invStockQuants.productId,
        quantity: invStockQuants.quantity,
        reservedQuantity: invStockQuants.reservedQuantity,
        costPricePaise: invStockQuants.costPricePaise,
        lotId: invLots.id,
        lotName: invLots.name,
        expiryDate: invLots.expiryDate,
        warehouseName: invWarehouses.name,
      })
      .from(invStockQuants)
      .innerJoin(invLots, eq(invStockQuants.lotId, invLots.id))
      .innerJoin(invLocations, eq(invStockQuants.locationId, invLocations.id))
      .innerJoin(invWarehouses, eq(invLocations.warehouseId, invWarehouses.id))
      .where(and(...conditions));

    const totalExpiredUnits = expiredRows.reduce(
      (sum, r) => sum + Number(r.quantity),
      0,
    );
    const totalExpiredValuePaise = expiredRows.reduce(
      (sum, r) => sum + Math.round(Number(r.quantity) * (r.costPricePaise ? Number(r.costPricePaise) : 0)),
      0,
    );

    return {
      sweepExecutedAt: new Date().toISOString(),
      asOfDate: todayStr,
      totalExpiredLots: new Set(expiredRows.map((r) => r.lotId)).size,
      affectedQuants: expiredRows.length,
      totalExpiredUnits,
      totalExpiredValuePaise,
      expiredLots: expiredRows,
    };
  }

  // ==========================================
  // 10. RECONCILIATION & DEMO SEED
  // ==========================================

  async reconcileLedger(productId?: string) {
    const allLocations = await this.db
      .select({
        id: invLocations.id,
        name: invLocations.name,
        code: invLocations.code,
        type: invLocations.type,
      })
      .from(invLocations);

    const trackedLocationIds = new Set(
      allLocations
        .filter((l) => l.type === 'INTERNAL' || l.type === 'TRANSIT' || l.type === 'SCRAP')
        .map((l) => l.id),
    );

    const moveConditions = [eq(invStockMoves.state, 'DONE')];
    if (productId) {
      moveConditions.push(eq(invStockMoves.productId, productId));
    }

    const completedMoves = await this.db
      .select()
      .from(invStockMoves)
      .where(and(...moveConditions));

    const ledgerBalances = new Map<string, number>();

    for (const move of completedMoves) {
      const qty = Number(move.quantity);
      const variantKey = move.variantId ?? '';
      const lotKey = move.lotId ?? '';

      if (trackedLocationIds.has(move.destinationLocationId)) {
        const destKey = `${move.productId}::${variantKey}::${move.destinationLocationId}::${lotKey}`;
        ledgerBalances.set(destKey, (ledgerBalances.get(destKey) ?? 0) + qty);
      }

      if (trackedLocationIds.has(move.sourceLocationId)) {
        const sourceKey = `${move.productId}::${variantKey}::${move.sourceLocationId}::${lotKey}`;
        ledgerBalances.set(sourceKey, (ledgerBalances.get(sourceKey) ?? 0) - qty);
      }
    }

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

    const allKeys = new Set([...ledgerBalances.keys(), ...quantBalances.keys()]);
    const discrepancies = [];
    const auditDetails = [];

    for (const key of allKeys) {
      const [pId, vId, locId, lId] = key.split('::');
      const expectedFromLedger = Number((ledgerBalances.get(key) ?? 0).toFixed(3));
      const actualFromQuant = Number((quantBalances.get(key)?.quantity ?? 0).toFixed(3));
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
      status: discrepancies.length === 0 ? 'RECONCILED' : 'DISCREPANCY_DETECTED',
      reconciledAt: new Date().toISOString(),
      totalAuditedItems: auditDetails.length,
      discrepanciesCount: discrepancies.length,
      discrepancies,
      auditDetails,
    };
  }

  async seedDemoData(force = false) {
    const [lotCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(invLots);

    if (!force && (lotCount?.count ?? 0) > 0) {
      return {
        success: true,
        message: 'FreshMart multi-store lots and inventory already seeded.',
      };
    }

    const merchantId = '00000000-0000-0000-0000-000000000001';

    // 1. Create 3 FreshMart stores (Warehouses)
    const storesData = [
      {
        name: 'FreshMart Supermarket - Indiranagar Store #01',
        code: 'FM-BLR-01',
        isDefault: true,
      },
      {
        name: 'FreshMart Supermarket - Koramangala Store #02',
        code: 'FM-BLR-02',
        isDefault: false,
      },
      {
        name: 'FreshMart Supermarket - Whitefield Store #03',
        code: 'FM-BLR-03',
        isDefault: false,
      },
    ];

    const storeMap = new Map<string, { warehouseId: string; shelfId: string; scrapId: string; transitId: string }>();

    for (const s of storesData) {
      let [wh] = await this.db
        .select()
        .from(invWarehouses)
        .where(eq(invWarehouses.code, s.code))
        .limit(1);

      if (!wh) {
        const [inserted] = await this.db
          .insert(invWarehouses)
          .values({
            merchantId,
            name: s.name,
            code: s.code,
            address: { city: 'Bengaluru', country: 'IN' },
            isDefault: s.isDefault,
          })
          .returning();
        wh = inserted;
      }

      // Ensure locations
      const locTypes: Array<{ name: string; code: string; type: string }> = [
        { name: `${s.code} Main Shelf`, code: `${s.code}-SHELF-01`, type: 'INTERNAL' },
        { name: `${s.code} Vendor Dock`, code: `${s.code}-SUP-01`, type: 'SUPPLIER' },
        { name: `${s.code} Customer POS`, code: `${s.code}-CUST-01`, type: 'CUSTOMER' },
        { name: `${s.code} Scrap & Waste`, code: `${s.code}-SCRAP-01`, type: 'SCRAP' },
        { name: `${s.code} Transit Van`, code: `${s.code}-TRANSIT-01`, type: 'TRANSIT' },
        { name: `${s.code} Loss/Variance`, code: `${s.code}-LOSS-01`, type: 'LOSS' },
      ];

      let shelfId = '';
      let scrapId = '';
      let transitId = '';

      for (const lt of locTypes) {
        let [loc] = await this.db
          .select()
          .from(invLocations)
          .where(
            and(
              eq(invLocations.warehouseId, wh.id),
              eq(invLocations.code, lt.code),
            ),
          )
          .limit(1);

        if (!loc) {
          const [ins] = await this.db
            .insert(invLocations)
            .values({
              warehouseId: wh.id,
              name: lt.name,
              code: lt.code,
              type: lt.type,
            })
            .returning();
          loc = ins;
        }

        if (lt.type === 'INTERNAL') shelfId = loc.id;
        if (lt.type === 'SCRAP') scrapId = loc.id;
        if (lt.type === 'TRANSIT') transitId = loc.id;
      }

      storeMap.set(s.code, {
        warehouseId: wh.id,
        shelfId,
        scrapId,
        transitId,
      });
    }

    // 2. Define Grocery Products & Lots with various expiry horizons
    // Today, tomorrow, in 3 days, in 6 days, in 14 days, and already expired!
    const today = new Date();
    const addDays = (d: number) => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() + d);
      return dt.toISOString().slice(0, 10);
    };

    const groceryLots = [
      {
        productId: 'a0000000-0000-4000-8000-000000000001',
        productName: 'Amul Taaza Homogenised Toned Milk 1L',
        lotName: 'LOT-MILK-EXP-TOMORROW',
        manufacturingDate: addDays(-5),
        expiryDate: addDays(1), // Expires tomorrow -> CRITICAL
        unitCostPaise: 5400,
        qty: 120,
        store: 'FM-BLR-01',
      },
      {
        productId: 'a0000000-0000-4000-8000-000000000001',
        productName: 'Amul Taaza Homogenised Toned Milk 1L',
        lotName: 'LOT-MILK-EXP-4DAYS',
        manufacturingDate: addDays(-2),
        expiryDate: addDays(4), // Expires in 4 days -> WARNING
        unitCostPaise: 5400,
        qty: 250,
        store: 'FM-BLR-01',
      },
      {
        productId: 'a0000000-0000-4000-8000-000000000001',
        productName: 'Amul Taaza Homogenised Toned Milk 1L',
        lotName: 'LOT-MILK-EXPIRED-YESTERDAY',
        manufacturingDate: addDays(-10),
        expiryDate: addDays(-1), // Already expired -> EXPIRED
        unitCostPaise: 5400,
        qty: 15,
        store: 'FM-BLR-01',
      },
      {
        productId: 'b0000000-0000-4000-8000-000000000002',
        productName: 'Nandini GoodLife Cow Milk 500ml',
        lotName: 'LOT-NANDINI-EXP-3DAYS',
        manufacturingDate: addDays(-3),
        expiryDate: addDays(3), // Warning
        unitCostPaise: 2800,
        qty: 85,
        store: 'FM-BLR-02',
      },
      {
        productId: 'b0000000-0000-4000-8000-000000000002',
        productName: 'Nandini GoodLife Cow Milk 500ml',
        lotName: 'LOT-NANDINI-EXPIRED-3DAYS-AGO',
        manufacturingDate: addDays(-15),
        expiryDate: addDays(-3), // Expired
        unitCostPaise: 2800,
        qty: 30,
        store: 'FM-BLR-02',
      },
      {
        productId: 'c0000000-0000-4000-8000-000000000003',
        productName: 'Britannia Daily Fresh Whole Wheat Bread 400g',
        lotName: 'LOT-BREAD-EXP-TODAY',
        manufacturingDate: addDays(-4),
        expiryDate: addDays(0), // Expires today -> CRITICAL
        unitCostPaise: 4200,
        qty: 60,
        store: 'FM-BLR-01',
      },
      {
        productId: 'd0000000-0000-4000-8000-000000000004',
        productName: 'Mother Dairy Classic Curd 400g Cup',
        lotName: 'LOT-CURD-EXP-6DAYS',
        manufacturingDate: addDays(-2),
        expiryDate: addDays(6), // Warning
        unitCostPaise: 3500,
        qty: 110,
        store: 'FM-BLR-03',
      },
      {
        productId: 'e0000000-0000-4000-8000-000000000005',
        productName: 'Epigamia Greek Yogurt Strawberry 85g',
        lotName: 'LOT-YOGURT-EXP-2DAYS',
        manufacturingDate: addDays(-7),
        expiryDate: addDays(2), // Critical
        unitCostPaise: 4800,
        qty: 90,
        store: 'FM-BLR-03',
      },
      {
        productId: 'f0000000-0000-4000-8000-000000000006',
        productName: 'Fortune Sunlite Refined Sunflower Oil 1L',
        lotName: 'LOT-OIL-EXP-NEXTYEAR',
        manufacturingDate: addDays(-20),
        expiryDate: addDays(280), // Healthy
        unitCostPaise: 14500,
        qty: 300,
        store: 'FM-BLR-01',
      },
    ];

    for (const g of groceryLots) {
      const storeInfo = storeMap.get(g.store);
      if (!storeInfo) continue;

      try {
        await this.receiveLot({
          productId: g.productId,
          lotName: g.lotName,
          manufacturingDate: g.manufacturingDate,
          expiryDate: g.expiryDate,
          locationId: storeInfo.shelfId,
          quantity: g.qty,
          unitCostPaise: g.unitCostPaise,
          performedBy: 'procurement-team',
          notes: `FreshMart demo batch receipt: ${g.productName}`,
        });
      } catch (err) {
        console.warn(`[InventoryService] Seed lot receipt notice:`, err);
      }
    }

    // 3. Create a sample reservation
    try {
      const milkStore1 = storeMap.get('FM-BLR-01');
      if (milkStore1) {
        await this.createReservation({
          merchantId,
          orderReference: 'ORD-ONLINE-8921',
          productId: 'a0000000-0000-4000-8000-000000000001',
          locationId: milkStore1.shelfId,
          quantity: 20,
          timeoutMinutes: 30,
          createdBy: 'online-cart-checkout',
        });
      }
    } catch (err) {
      console.warn('[InventoryService] Seed sample reservation notice:', err);
    }

    return {
      success: true,
      message: 'FreshMart multi-store lots, quants, and demo reservations seeded successfully.',
    };
  }
}
