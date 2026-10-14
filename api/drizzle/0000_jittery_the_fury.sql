CREATE TABLE "inv_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"parent_location_id" uuid,
	"name" varchar(200) NOT NULL,
	"code" varchar(50) NOT NULL,
	"type" varchar(20) NOT NULL,
	"barcode" varchar(100),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_locations_warehouse_code_unique" UNIQUE("warehouse_id","code"),
	CONSTRAINT "inv_locations_no_self_parent" CHECK ("inv_locations"."id" <> "inv_locations"."parent_location_id"),
	CONSTRAINT "inv_locations_type_check" CHECK ("inv_locations"."type" IN ('INTERNAL', 'SUPPLIER', 'CUSTOMER', 'LOSS', 'SCRAP', 'TRANSIT'))
);
--> statement-breakpoint
CREATE TABLE "inv_stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_id" varchar(100),
	"reference_type" varchar(20),
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"lot_id" uuid,
	"source_location_id" uuid NOT NULL,
	"destination_location_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost_paise" bigint,
	"state" varchar(12) DEFAULT 'DRAFT' NOT NULL,
	"scheduled_date" timestamp with time zone,
	"done_date" timestamp with time zone,
	"transfer_id" uuid,
	"performed_by" varchar(100) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_stock_moves_distinct_locations" CHECK ("inv_stock_moves"."source_location_id" <> "inv_stock_moves"."destination_location_id"),
	CONSTRAINT "inv_stock_moves_quantity_positive" CHECK ("inv_stock_moves"."quantity" > 0),
	CONSTRAINT "inv_stock_moves_reference_type_check" CHECK ("inv_stock_moves"."reference_type" IS NULL OR "inv_stock_moves"."reference_type" IN ('GRN', 'SALE', 'RETURN', 'TRANSFER', 'ADJUSTMENT', 'SCRAP')),
	CONSTRAINT "inv_stock_moves_state_check" CHECK ("inv_stock_moves"."state" IN ('DRAFT', 'CONFIRMED', 'DONE', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "inv_stock_quants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"location_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"reserved_quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"cost_price_paise" bigint,
	"last_count_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_stock_quants_product_variant_location_lot_unique" UNIQUE NULLS NOT DISTINCT("product_id","variant_id","location_id","lot_id"),
	CONSTRAINT "inv_stock_quants_quantity_nonneg" CHECK ("inv_stock_quants"."quantity" >= 0),
	CONSTRAINT "inv_stock_quants_reserved_nonneg" CHECK ("inv_stock_quants"."reserved_quantity" >= 0),
	CONSTRAINT "inv_stock_quants_reserved_le_quantity" CHECK ("inv_stock_quants"."reserved_quantity" <= "inv_stock_quants"."quantity")
);
--> statement-breakpoint
CREATE TABLE "inv_warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(20) NOT NULL,
	"address" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "inv_locations" ADD CONSTRAINT "inv_locations_warehouse_id_inv_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_locations" ADD CONSTRAINT "inv_locations_parent_location_id_inv_locations_id_fk" FOREIGN KEY ("parent_location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_stock_moves" ADD CONSTRAINT "inv_stock_moves_source_location_id_inv_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_stock_moves" ADD CONSTRAINT "inv_stock_moves_destination_location_id_inv_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_stock_quants" ADD CONSTRAINT "inv_stock_quants_location_id_inv_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inv_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inv_locations_parent_idx" ON "inv_locations" USING btree ("parent_location_id");--> statement-breakpoint
CREATE INDEX "inv_stock_moves_product_idx" ON "inv_stock_moves" USING btree ("product_id","done_date");--> statement-breakpoint
CREATE INDEX "inv_stock_moves_source_idx" ON "inv_stock_moves" USING btree ("source_location_id");--> statement-breakpoint
CREATE INDEX "inv_stock_moves_destination_idx" ON "inv_stock_moves" USING btree ("destination_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_warehouses_one_default_per_merchant" ON "inv_warehouses" USING btree ("merchant_id") WHERE "inv_warehouses"."is_default" = true;