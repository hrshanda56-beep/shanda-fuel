ALTER TABLE "app"."stations"
  ADD COLUMN "responsible_supervisor_membership_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."stations"
  ADD CONSTRAINT "stations_responsible_supervisor_fk"
  FOREIGN KEY ("tenant_id", "responsible_supervisor_membership_id")
  REFERENCES "app"."memberships"("tenant_id", "id")
  ON DELETE no action ON UPDATE no action;
