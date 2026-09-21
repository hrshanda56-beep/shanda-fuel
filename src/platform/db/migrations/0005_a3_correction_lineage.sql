ALTER TABLE "app"."meter_segments" ADD COLUMN "correction_of_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD COLUMN "reversal_of_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "source_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "source_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "correction_of_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id");
--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_correction_of_fk" FOREIGN KEY ("tenant_id", "station_id", "correction_of_segment_id") REFERENCES "app"."meter_segments"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_reversal_of_fk" FOREIGN KEY ("tenant_id", "station_id", "reversal_of_segment_id") REFERENCES "app"."meter_segments"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_source_revision_fk" FOREIGN KEY ("tenant_id", "station_id", "source_revision_id") REFERENCES "app"."reconciliation_revisions"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_correction_of_fk" FOREIGN KEY ("tenant_id", "station_id", "correction_of_revision_id") REFERENCES "app"."reconciliation_revisions"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
