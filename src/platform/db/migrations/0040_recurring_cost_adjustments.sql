ALTER TABLE "app"."recurring_cost_recognitions"
  ADD COLUMN "adjustment_of_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_recognitions"
  DROP CONSTRAINT "recurring_cost_recognitions_period_date_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_cost_recognitions_active_period_date_uidx"
  ON "app"."recurring_cost_recognitions" USING btree ("tenant_id", "period_id", "recognition_date")
  WHERE "state" = 'RECOGNIZED';
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_recognitions"
  ADD CONSTRAINT "recurring_cost_recognitions_adjustment_of_fk"
  FOREIGN KEY ("tenant_id", "adjustment_of_id")
  REFERENCES "app"."recurring_cost_recognitions"("tenant_id", "id")
  ON DELETE no action ON UPDATE no action;
