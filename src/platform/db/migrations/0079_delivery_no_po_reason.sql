-- A delivery with no purchase order must say why, for the audit trail. The reason is recorded when
-- the delivery is created and ConfirmDelivery refuses a delivery that has neither an active
-- purchase-order link nor a reason. RLS, grants and triggers on app.fuel_deliveries are unchanged.
ALTER TABLE "app"."fuel_deliveries" ADD COLUMN "no_po_reason" text;
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD COLUMN "no_po_note" text;
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_no_po_reason_chk" CHECK (
  "no_po_reason" IS NULL OR "no_po_reason" IN ('EMERGENCY_PURCHASE', 'CASH_PURCHASE', 'SUPPLIER_DIRECT', 'PO_NOT_RAISED', 'OTHER')
);
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_no_po_note_chk" CHECK (
  "no_po_note" IS NULL OR ("no_po_reason" IS NOT NULL AND length(btrim("no_po_note")) > 0 AND length("no_po_note") <= 300)
);
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_no_po_other_note_chk" CHECK (
  "no_po_reason" IS DISTINCT FROM 'OTHER' OR "no_po_note" IS NOT NULL
);
