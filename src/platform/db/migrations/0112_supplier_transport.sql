-- Transportation under Suppliers. A supplier may supply fuel, provide transport, or both.
-- Existing suppliers keep supplying fuel and are not transporters. A delivery may record which
-- supplier carried it; the older free-text transporter name stays for rows that already have one.
-- Additive only: RLS, grants and triggers on both tables are unchanged. Local development databases until approved.
ALTER TABLE "app"."suppliers" ADD COLUMN "provides_fuel" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD COLUMN "provides_transport" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD CONSTRAINT "suppliers_provides_something_ck"
  CHECK ("provides_fuel" OR "provides_transport");
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD COLUMN "transporter_supplier_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_transporter_supplier_fk"
  FOREIGN KEY ("tenant_id", "transporter_supplier_id") REFERENCES "app"."suppliers" ("tenant_id", "id");
