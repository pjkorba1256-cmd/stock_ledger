CREATE TABLE IF NOT EXISTS "inv_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"vendor_id" uuid,
	"manufacturing_date" date,
	"expiry_date" date,
	"reference" varchar(100),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_lots_product_name_unique" UNIQUE("product_id","name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_lots_product_idx" ON "inv_lots" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_lots_expiry_idx" ON "inv_lots" USING btree ("expiry_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inv_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_number" varchar(50) NOT NULL,
	"type" varchar(10) NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"source_location_id" uuid,
	"destination_location_id" uuid,
	"partner_id" varchar(100),
	"partner_type" varchar(10),
	"reference_id" varchar(100),
	"reference_type" varchar(30),
	"state" varchar(12) DEFAULT 'DRAFT' NOT NULL,
	"scheduled_date" timestamp with time zone,
	"done_date" timestamp with time zone,
	"notes" text,
	"created_by" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_transfers_transfer_number_unique" UNIQUE("transfer_number"),
	CONSTRAINT "inv_transfers_type_check" CHECK ("type" IN ('RECEIPT', 'DELIVERY', 'INTERNAL', 'RETURN')),
	CONSTRAINT "inv_transfers_partner_type_check" CHECK ("partner_type" IS NULL OR "partner_type" IN ('VENDOR', 'CUSTOMER')),
	CONSTRAINT "inv_transfers_state_check" CHECK ("state" IN ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "inv_transfers" DROP CONSTRAINT IF EXISTS "inv_transfers_warehouse_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_transfers" ADD CONSTRAINT "inv_transfers_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_transfers" DROP CONSTRAINT IF EXISTS "inv_transfers_source_location_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_transfers" ADD CONSTRAINT "inv_transfers_source_location_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_transfers" DROP CONSTRAINT IF EXISTS "inv_transfers_destination_location_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_transfers" ADD CONSTRAINT "inv_transfers_destination_location_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_transfers_warehouse_idx" ON "inv_transfers" USING btree ("warehouse_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_transfers_source_idx" ON "inv_transfers" USING btree ("source_location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_transfers_dest_idx" ON "inv_transfers" USING btree ("destination_location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_transfers_state_idx" ON "inv_transfers" USING btree ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_transfers_number_idx" ON "inv_transfers" USING btree ("transfer_number");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inv_transfer_counters" (
	"counter_date" date PRIMARY KEY NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inv_stock_scrap" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"lot_id" uuid,
	"location_id" uuid NOT NULL,
	"scrap_location_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"reason" varchar(20) NOT NULL,
	"notes" text,
	"stock_move_id" uuid,
	"performed_by" varchar(100) NOT NULL,
	"approved_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_stock_scrap_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "inv_stock_scrap_reason_check" CHECK ("reason" IN ('DAMAGED', 'EXPIRED', 'QUALITY_FAILED', 'OTHER'))
);
--> statement-breakpoint
ALTER TABLE "inv_stock_scrap" DROP CONSTRAINT IF EXISTS "inv_stock_scrap_lot_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_scrap" ADD CONSTRAINT "inv_stock_scrap_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inv_lots"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_stock_scrap" DROP CONSTRAINT IF EXISTS "inv_stock_scrap_location_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_scrap" ADD CONSTRAINT "inv_stock_scrap_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_stock_scrap" DROP CONSTRAINT IF EXISTS "inv_stock_scrap_scrap_location_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_scrap" ADD CONSTRAINT "inv_stock_scrap_scrap_location_id_fk" FOREIGN KEY ("scrap_location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_stock_scrap" DROP CONSTRAINT IF EXISTS "inv_stock_scrap_stock_move_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_scrap" ADD CONSTRAINT "inv_stock_scrap_stock_move_id_fk" FOREIGN KEY ("stock_move_id") REFERENCES "public"."inv_stock_moves"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_scrap_product_idx" ON "inv_stock_scrap" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_scrap_lot_idx" ON "inv_stock_scrap" USING btree ("lot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_scrap_location_idx" ON "inv_stock_scrap" USING btree ("location_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inv_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_reference" varchar(100) NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"location_id" uuid NOT NULL,
	"lot_id" uuid,
	"quant_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"state" varchar(20) DEFAULT 'RESERVED' NOT NULL,
	"expires_at" timestamp with time zone,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"picked_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_by" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_reservations_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "inv_reservations_state_check" CHECK ("state" IN ('RESERVED', 'CONFIRMED', 'PICKED', 'DELIVERED', 'CANCELLED', 'EXPIRED', 'RELEASED'))
);
--> statement-breakpoint
ALTER TABLE "inv_reservations" DROP CONSTRAINT IF EXISTS "inv_reservations_location_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_reservations" ADD CONSTRAINT "inv_reservations_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_reservations" DROP CONSTRAINT IF EXISTS "inv_reservations_lot_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_reservations" ADD CONSTRAINT "inv_reservations_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inv_lots"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_reservations" DROP CONSTRAINT IF EXISTS "inv_reservations_quant_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_reservations" ADD CONSTRAINT "inv_reservations_quant_id_fk" FOREIGN KEY ("quant_id") REFERENCES "public"."inv_stock_quants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_reservations_merchant_idx" ON "inv_reservations" USING btree ("merchant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_reservations_order_ref_idx" ON "inv_reservations" USING btree ("order_reference");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_reservations_state_idx" ON "inv_reservations" USING btree ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_reservations_expires_at_idx" ON "inv_reservations" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_reservations_lot_idx" ON "inv_reservations" USING btree ("lot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_reservations_product_idx" ON "inv_reservations" USING btree ("product_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inv_stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_number" varchar(50) NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"state" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"baseline_date" timestamp with time zone DEFAULT now() NOT NULL,
	"counted_by" varchar(100) NOT NULL,
	"approved_by" varchar(100),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_stock_counts_count_number_unique" UNIQUE("count_number"),
	CONSTRAINT "inv_stock_counts_state_check" CHECK ("state" IN ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'POSTED', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "inv_stock_counts" DROP CONSTRAINT IF EXISTS "inv_stock_counts_warehouse_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_counts" ADD CONSTRAINT "inv_stock_counts_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_stock_counts" DROP CONSTRAINT IF EXISTS "inv_stock_counts_location_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_counts" ADD CONSTRAINT "inv_stock_counts_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_counts_warehouse_idx" ON "inv_stock_counts" USING btree ("warehouse_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_counts_location_idx" ON "inv_stock_counts" USING btree ("location_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inv_stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"system_quantity" numeric(14, 3) NOT NULL,
	"counted_quantity" numeric(14, 3) NOT NULL,
	"variance_quantity" numeric(14, 3) NOT NULL,
	"adjustment_move_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inv_stock_count_lines" DROP CONSTRAINT IF EXISTS "inv_stock_count_lines_count_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_count_lines" ADD CONSTRAINT "inv_stock_count_lines_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inv_stock_counts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_stock_count_lines" DROP CONSTRAINT IF EXISTS "inv_stock_count_lines_lot_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_count_lines" ADD CONSTRAINT "inv_stock_count_lines_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inv_lots"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_stock_count_lines" DROP CONSTRAINT IF EXISTS "inv_stock_count_lines_adj_move_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_count_lines" ADD CONSTRAINT "inv_stock_count_lines_adj_move_id_fk" FOREIGN KEY ("adjustment_move_id") REFERENCES "public"."inv_stock_moves"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_count_lines_count_idx" ON "inv_stock_count_lines" USING btree ("count_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_count_lines_product_idx" ON "inv_stock_count_lines" USING btree ("product_id");
--> statement-breakpoint

ALTER TABLE "inv_stock_moves" DROP CONSTRAINT IF EXISTS "inv_stock_moves_lot_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_moves" ADD CONSTRAINT "inv_stock_moves_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inv_lots"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inv_stock_moves" DROP CONSTRAINT IF EXISTS "inv_stock_moves_transfer_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_moves" ADD CONSTRAINT "inv_stock_moves_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."inv_transfers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_moves_transfer_idx" ON "inv_stock_moves" USING btree ("transfer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_moves_lot_idx" ON "inv_stock_moves" USING btree ("lot_id");
--> statement-breakpoint

ALTER TABLE "inv_stock_quants" DROP CONSTRAINT IF EXISTS "inv_stock_quants_lot_id_fk";
--> statement-breakpoint
ALTER TABLE "inv_stock_quants" ADD CONSTRAINT "inv_stock_quants_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inv_lots"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_quants_lot_idx" ON "inv_stock_quants" USING btree ("lot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_stock_quants_prod_loc_idx" ON "inv_stock_quants" USING btree ("product_id","location_id");
