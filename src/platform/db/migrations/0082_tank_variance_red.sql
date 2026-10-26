-- Tank variance limits become two thresholds. The existing acceptable_variance_litres is the
-- yellow one (a difference above it must be explained); variance_red_litres is the new red one (a
-- difference above it is urgent). Where red is empty it is twice yellow, as before, so nothing
-- changes for tanks that never set one.
ALTER TABLE "app"."tanks" ADD COLUMN "variance_red_litres" numeric(18, 3);
--> statement-breakpoint
ALTER TABLE "app"."tanks" ADD CONSTRAINT "tanks_variance_red_ck"
  CHECK ("variance_red_litres" IS NULL OR "variance_red_litres" >= 0);
--> statement-breakpoint
ALTER TABLE "app"."tanks" ADD CONSTRAINT "tanks_variance_red_not_below_yellow_ck"
  CHECK ("variance_red_litres" IS NULL OR "acceptable_variance_litres" IS NULL
    OR "variance_red_litres" >= "acceptable_variance_litres");
