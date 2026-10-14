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

// 3. Stock moves
export const invStockMoves = pgTable(
  'inv_stock_moves',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    referenceId: varchar('reference_id', { length: 100 }),
    referenceType: varchar('reference_type', { length: 20 }),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    lotId: uuid('lot_id'),
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
    unitCostPaise: bigint('unit_cost_paise', { mode: 'bigint' }),
    state: varchar('state', { length: 12 }).default('DRAFT').notNull(),
    scheduledDate: timestamp('scheduled_date', { withTimezone: true }),
    doneDate: timestamp('done_date', { withTimezone: true }),
    transferId: uuid('transfer_id'),
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
  ],
);

// 4. Stock quants
export const invStockQuants = pgTable(
  'inv_stock_quants',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    locationId: uuid('location_id')
      .notNull()
      .references(() => invLocations.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id'),
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
    costPricePaise: bigint('cost_price_paise', { mode: 'bigint' }),
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
  ],
);