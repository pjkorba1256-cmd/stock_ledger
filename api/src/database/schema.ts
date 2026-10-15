import {
  AnyPgColumn,
  pgTable,
  uuid,
  varchar,
  jsonb,
  boolean,
  timestamp,
  integer,
  numeric,
  bigint,
  text,
  date,
  unique,
  uniqueIndex,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 1. Warehouses
export const invWarehouses = pgTable(
  'inv_warehouses',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    merchantId: uuid('merchant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    address: jsonb('address'),
    isActive: boolean('is_active').default(true).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('inv_warehouses_code_unique').on(table.code),
    uniqueIndex('inv_warehouses_one_default_per_merchant')
      .on(table.merchantId)
      .where(sql`${table.isDefault} = true`),
  ],
);

// 2. Locations
export const invLocations = pgTable(
  'inv_locations',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => invWarehouses.id, { onDelete: 'restrict' }),
    parentLocationId: uuid('parent_location_id').references(
      (): AnyPgColumn => invLocations.id,
      { onDelete: 'restrict' },
    ),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(),
    barcode: varchar('barcode', { length: 100 }),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('inv_locations_warehouse_code_unique').on(
      table.warehouseId,
      table.code,
    ),
    check(
      'inv_locations_no_self_parent',
      sql`${table.id} <> ${table.parentLocationId}`,
    ),
    check(
      'inv_locations_type_check',
      sql`${table.type} IN ('INTERNAL', 'SUPPLIER', 'CUSTOMER', 'LOSS', 'SCRAP', 'TRANSIT')`,
    ),
    index('inv_locations_parent_idx').on(table.parentLocationId),
  ],
);

// 3. Lots / Batches (P03)
export const invLots = pgTable(
  'inv_lots',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    productId: uuid('product_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    vendorId: uuid('vendor_id'),
    manufacturingDate: date('manufacturing_date', { mode: 'string' }),
    expiryDate: date('expiry_date', { mode: 'string' }),
    reference: varchar('reference', { length: 100 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('inv_lots_product_name_unique').on(table.productId, table.name),
    index('inv_lots_product_idx').on(table.productId),
    index('inv_lots_expiry_idx').on(table.expiryDate),
  ],
);

// 4. Inter-store Transfers (P03)
export const invTransfers = pgTable(
  'inv_transfers',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    transferNumber: varchar('transfer_number', { length: 50 }).notNull(),
    type: varchar('type', { length: 10 }).notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => invWarehouses.id, { onDelete: 'restrict' }),
    sourceLocationId: uuid('source_location_id').references(
      () => invLocations.id,
      { onDelete: 'restrict' },
    ),
    destinationLocationId: uuid('destination_location_id').references(
      () => invLocations.id,
      { onDelete: 'restrict' },
    ),
    partnerId: varchar('partner_id', { length: 100 }),
    partnerType: varchar('partner_type', { length: 10 }),
    referenceId: varchar('reference_id', { length: 100 }),
    referenceType: varchar('reference_type', { length: 30 }),
    state: varchar('state', { length: 12 }).default('DRAFT').notNull(),
    scheduledDate: timestamp('scheduled_date', { withTimezone: true }),
    doneDate: timestamp('done_date', { withTimezone: true }),
    notes: text('notes'),
    createdBy: varchar('created_by', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('inv_transfers_transfer_number_unique').on(table.transferNumber),
    check(
      'inv_transfers_type_check',
      sql`${table.type} IN ('RECEIPT', 'DELIVERY', 'INTERNAL', 'RETURN')`,
    ),
    check(
      'inv_transfers_partner_type_check',
      sql`${table.partnerType} IS NULL OR ${table.partnerType} IN ('VENDOR', 'CUSTOMER')`,
    ),
    check(
      'inv_transfers_state_check',
      sql`${table.state} IN ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'CANCELLED')`,
    ),
    index('inv_transfers_warehouse_idx').on(table.warehouseId),
    index('inv_transfers_source_idx').on(table.sourceLocationId),
    index('inv_transfers_dest_idx').on(table.destinationLocationId),
    index('inv_transfers_state_idx').on(table.state),
    index('inv_transfers_number_idx').on(table.transferNumber),
  ],
);

// 5. Transfer Number Counters (P03)
export const invTransferCounters = pgTable(
  'inv_transfer_counters',
  {
    counterDate: date('counter_date', { mode: 'string' }).primaryKey().notNull(),
    seq: integer('seq').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

// 6. Stock moves (P02 + P03 extensions)
export const invStockMoves = pgTable(
  'inv_stock_moves',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    referenceId: varchar('reference_id', { length: 100 }),
    referenceType: varchar('reference_type', { length: 20 }),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    lotId: uuid('lot_id').references(() => invLots.id, { onDelete: 'restrict' }),
    sourceLocationId: uuid('source_location_id')
      .notNull()
      .references(() => invLocations.id, { onDelete: 'restrict' }),
    destinationLocationId: uuid('destination_location_id')
      .notNull()
      .references(() => invLocations.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', {
      precision: 14,
      scale: 3,
    }).notNull(),
    unitCostPaise: bigint('unit_cost_paise', { mode: 'number' }),
    state: varchar('state', { length: 12 }).default('DRAFT').notNull(),
    scheduledDate: timestamp('scheduled_date', { withTimezone: true }),
    doneDate: timestamp('done_date', { withTimezone: true }),
    transferId: uuid('transfer_id').references(() => invTransfers.id, {
      onDelete: 'restrict',
    }),
    performedBy: varchar('performed_by', { length: 100 }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'inv_stock_moves_distinct_locations',
      sql`${table.sourceLocationId} <> ${table.destinationLocationId}`,
    ),
    check(
      'inv_stock_moves_quantity_positive',
      sql`${table.quantity} > 0`,
    ),
    check(
      'inv_stock_moves_reference_type_check',
      sql`${table.referenceType} IS NULL OR ${table.referenceType} IN ('GRN', 'SALE', 'RETURN', 'TRANSFER', 'ADJUSTMENT', 'SCRAP')`,
    ),
    check(
      'inv_stock_moves_state_check',
      sql`${table.state} IN ('DRAFT', 'CONFIRMED', 'DONE', 'CANCELLED')`,
    ),
    index('inv_stock_moves_product_idx').on(
      table.productId,
      table.doneDate,
    ),
    index('inv_stock_moves_source_idx').on(table.sourceLocationId),
    index('inv_stock_moves_destination_idx').on(
      table.destinationLocationId,
    ),
    index('inv_stock_moves_transfer_idx').on(table.transferId),
    index('inv_stock_moves_lot_idx').on(table.lotId),
  ],
);

// 7. Stock quants (P02 + P03 projections)
export const invStockQuants = pgTable(
  'inv_stock_quants',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    locationId: uuid('location_id')
      .notNull()
      .references(() => invLocations.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id').references(() => invLots.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', {
      precision: 14,
      scale: 3,
    })
      .default('0')
      .notNull(),
    reservedQuantity: numeric('reserved_quantity', {
      precision: 14,
      scale: 3,
    })
      .default('0')
      .notNull(),
    costPricePaise: bigint('cost_price_paise', { mode: 'number' }),
    lastCountDate: timestamp('last_count_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('inv_stock_quants_product_variant_location_lot_unique')
      .on(
        table.productId,
        table.variantId,
        table.locationId,
        table.lotId,
      )
      .nullsNotDistinct(),
    check(
      'inv_stock_quants_quantity_nonneg',
      sql`${table.quantity} >= 0`,
    ),
    check(
      'inv_stock_quants_reserved_nonneg',
      sql`${table.reservedQuantity} >= 0`,
    ),
    check(
      'inv_stock_quants_reserved_le_quantity',
      sql`${table.reservedQuantity} <= ${table.quantity}`,
    ),
    index('inv_stock_quants_lot_idx').on(table.lotId),
    index('inv_stock_quants_prod_loc_idx').on(table.productId, table.locationId),
  ],
);

// 8. Stock Scrap / Write-offs (P03)
export const invStockScrap = pgTable(
  'inv_stock_scrap',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    lotId: uuid('lot_id').references(() => invLots.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => invLocations.id, { onDelete: 'restrict' }),
    scrapLocationId: uuid('scrap_location_id')
      .notNull()
      .references(() => invLocations.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', {
      precision: 14,
      scale: 3,
    }).notNull(),
    reason: varchar('reason', { length: 20 }).notNull(),
    notes: text('notes'),
    stockMoveId: uuid('stock_move_id').references(() => invStockMoves.id, {
      onDelete: 'restrict',
    }),
    performedBy: varchar('performed_by', { length: 100 }).notNull(),
    approvedBy: varchar('approved_by', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'inv_stock_scrap_quantity_positive',
      sql`${table.quantity} > 0`,
    ),
    check(
      'inv_stock_scrap_reason_check',
      sql`${table.reason} IN ('DAMAGED', 'EXPIRED', 'QUALITY_FAILED', 'OTHER')`,
    ),
    index('inv_stock_scrap_product_idx').on(table.productId),
    index('inv_stock_scrap_lot_idx').on(table.lotId),
    index('inv_stock_scrap_location_idx').on(table.locationId),
  ],
);

// 9. Order Reservations (P03 dedicated reservation ledger)
export const invReservations = pgTable(
  'inv_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    merchantId: uuid('merchant_id').notNull(),
    orderReference: varchar('order_reference', { length: 100 }).notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    locationId: uuid('location_id')
      .notNull()
      .references(() => invLocations.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id').references(() => invLots.id, { onDelete: 'restrict' }),
    quantId: uuid('quant_id').references(() => invStockQuants.id, {
      onDelete: 'restrict',
    }),
    quantity: numeric('quantity', {
      precision: 14,
      scale: 3,
    }).notNull(),
    state: varchar('state', { length: 20 }).default('RESERVED').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reservedAt: timestamp('reserved_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    pickedAt: timestamp('picked_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    createdBy: varchar('created_by', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'inv_reservations_quantity_positive',
      sql`${table.quantity} > 0`,
    ),
    check(
      'inv_reservations_state_check',
      sql`${table.state} IN ('RESERVED', 'CONFIRMED', 'PICKED', 'DELIVERED', 'CANCELLED', 'EXPIRED', 'RELEASED')`,
    ),
    index('inv_reservations_merchant_idx').on(table.merchantId),
    index('inv_reservations_order_ref_idx').on(table.orderReference),
    index('inv_reservations_state_idx').on(table.state),
    index('inv_reservations_expires_at_idx').on(table.expiresAt),
    index('inv_reservations_lot_idx').on(table.lotId),
    index('inv_reservations_product_idx').on(table.productId),
  ],
);

// 10. Physical Stock Counts (P03)
export const invStockCounts = pgTable(
  'inv_stock_counts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    countNumber: varchar('count_number', { length: 50 }).notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => invWarehouses.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => invLocations.id, { onDelete: 'restrict' }),
    state: varchar('state', { length: 20 }).default('DRAFT').notNull(),
    baselineDate: timestamp('baseline_date', { withTimezone: true })
      .defaultNow()
      .notNull(),
    countedBy: varchar('counted_by', { length: 100 }).notNull(),
    approvedBy: varchar('approved_by', { length: 100 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('inv_stock_counts_count_number_unique').on(table.countNumber),
    check(
      'inv_stock_counts_state_check',
      sql`${table.state} IN ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'POSTED', 'CANCELLED')`,
    ),
    index('inv_stock_counts_warehouse_idx').on(table.warehouseId),
    index('inv_stock_counts_location_idx').on(table.locationId),
  ],
);

export const invStockCountLines = pgTable(
  'inv_stock_count_lines',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    countId: uuid('count_id')
      .notNull()
      .references(() => invStockCounts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    lotId: uuid('lot_id').references(() => invLots.id, { onDelete: 'restrict' }),
    systemQuantity: numeric('system_quantity', {
      precision: 14,
      scale: 3,
    }).notNull(),
    countedQuantity: numeric('counted_quantity', {
      precision: 14,
      scale: 3,
    }).notNull(),
    varianceQuantity: numeric('variance_quantity', {
      precision: 14,
      scale: 3,
    }).notNull(),
    adjustmentMoveId: uuid('adjustment_move_id').references(
      () => invStockMoves.id,
      { onDelete: 'restrict' },
    ),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('inv_stock_count_lines_count_idx').on(table.countId),
    index('inv_stock_count_lines_product_idx').on(table.productId),
  ],
);