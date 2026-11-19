-- Delivery loss: why the litres received differ from the delivery note, and the follow-up on who
-- pays for it. Additive only. The explanation sits on the delivery row, written when the delivery
-- is recorded, so the existing "confirmed deliveries are immutable" guard keeps it frozen. The
-- claim follow-up lives in its own table because it changes after the delivery is confirmed.
-- Nothing here posts to any ledger. Local development databases until approved.

ALTER TABLE "app"."fuel_deliveries"
  ADD COLUMN "variance_cause" text,
  ADD COLUMN "variance_note" text,
  ADD COLUMN "load_temperature_c" numeric(4, 1);
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries"
  ADD CONSTRAINT "fuel_deliveries_variance_cause_chk" CHECK (
    "variance_cause" IS NULL OR "variance_cause" IN
      ('THEFT_SUSPECTED', 'TEMPERATURE', 'MEASURING_ERROR', 'SPILL_OR_LEAK', 'LOADING_SHORT', 'OTHER')
  ),
  ADD CONSTRAINT "fuel_deliveries_variance_note_chk" CHECK (
    "variance_note" IS NULL OR char_length("variance_note") <= 500
  ),
  ADD CONSTRAINT "fuel_deliveries_variance_other_chk" CHECK (
    "variance_cause" IS DISTINCT FROM 'OTHER' OR btrim(coalesce("variance_note", '')) <> ''
  ),
  ADD CONSTRAINT "fuel_deliveries_load_temperature_chk" CHECK (
    "load_temperature_c" IS NULL OR "load_temperature_c" BETWEEN -30 AND 80
  );
--> statement-breakpoint
CREATE TABLE "app"."fuel_delivery_loss_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "liable_party" text NOT NULL,
  "status" text NOT NULL,
  "recovered_amount" numeric(20, 4),
  "currency" text,
  "note" text,
  "updated_by" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fuel_delivery_loss_claims_tenant_id_id_uidx" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "fuel_delivery_loss_claims_delivery_uidx" UNIQUE ("tenant_id", "delivery_id"),
  CONSTRAINT "fuel_delivery_loss_claims_party_ck" CHECK ("liable_party" IN ('NONE', 'DRIVER', 'TRANSPORTER', 'SUPPLIER', 'OTHER')),
  CONSTRAINT "fuel_delivery_loss_claims_status_ck" CHECK ("status" IN ('NONE', 'RAISED', 'SETTLED', 'WRITTEN_OFF')),
  CONSTRAINT "fuel_delivery_loss_claims_pair_ck" CHECK (("liable_party" = 'NONE') = ("status" = 'NONE')),
  CONSTRAINT "fuel_delivery_loss_claims_amount_ck" CHECK (
    ("status" = 'SETTLED' AND "recovered_amount" IS NOT NULL AND "recovered_amount" > 0 AND "currency" IS NOT NULL)
    OR ("status" <> 'SETTLED' AND "recovered_amount" IS NULL)
  ),
  CONSTRAINT "fuel_delivery_loss_claims_note_ck" CHECK ("note" IS NULL OR char_length("note") <= 500),
  CONSTRAINT "fuel_delivery_loss_claims_currency_ck" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_loss_claims" ADD CONSTRAINT "fuel_delivery_loss_claims_delivery_fk"
  FOREIGN KEY ("tenant_id", "station_id", "delivery_id")
  REFERENCES "app"."fuel_deliveries"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_loss_claims" ADD CONSTRAINT "fuel_delivery_loss_claims_updated_by_fk"
  FOREIGN KEY ("tenant_id", "updated_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "fuel_delivery_loss_claims_station_idx"
  ON "app"."fuel_delivery_loss_claims" ("tenant_id", "station_id", "status");
--> statement-breakpoint
ALTER TABLE app.fuel_delivery_loss_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fuel_delivery_loss_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY fuel_delivery_loss_claims_tenant_context ON app.fuel_delivery_loss_claims
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.fuel_delivery_loss_claims OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.fuel_delivery_loss_claims TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.fuel_delivery_loss_claims FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.fuel_delivery_loss_claims TO diagnostics_readonly;
  END IF;
END
$$;
