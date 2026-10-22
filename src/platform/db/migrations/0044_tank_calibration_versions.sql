ALTER TABLE "app"."tank_calibration_points"
  ADD COLUMN "chart_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."tank_calibration_points"
  ADD CONSTRAINT "tank_calibration_points_chart_version_ck" CHECK ("chart_version" >= 1);
--> statement-breakpoint
ALTER TABLE "app"."tank_calibration_points"
  DROP CONSTRAINT "tank_calibration_points_tank_measurement_uidx";
--> statement-breakpoint
ALTER TABLE "app"."tank_calibration_points"
  ADD CONSTRAINT "tank_calibration_points_tank_version_measurement_uidx"
  UNIQUE ("tenant_id", "tank_id", "measurement_unit", "chart_version", "measurement_value");
