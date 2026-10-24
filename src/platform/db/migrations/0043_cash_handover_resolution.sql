ALTER TABLE "app"."cash_handovers"
  ADD COLUMN "resolution_note" text,
  ADD COLUMN "resolved_by" uuid,
  ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."cash_handovers"
  ADD CONSTRAINT "cash_handovers_resolved_by_fk"
  FOREIGN KEY ("tenant_id", "resolved_by")
  REFERENCES "app"."memberships"("tenant_id", "id")
  ON DELETE no action ON UPDATE no action;
