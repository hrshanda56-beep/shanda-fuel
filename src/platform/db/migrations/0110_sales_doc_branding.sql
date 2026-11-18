-- Company logo and brand colour for quotations, invoices and receipts (DEC-045, round 2).
-- Additive only. The logo is a small JPEG kept as base64 text so no file storage is needed.
-- Local development databases until approved.

ALTER TABLE "app"."sales_doc_profiles" ADD COLUMN "logo_jpeg_base64" text;
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_profiles" ADD COLUMN "brand_colour" text;
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_profiles" ADD CONSTRAINT "sales_doc_profiles_logo_ck" CHECK (
  "logo_jpeg_base64" IS NULL OR (
    char_length("logo_jpeg_base64") <= 300000 AND "logo_jpeg_base64" ~ '^[A-Za-z0-9+/]+=*$'
  )
);
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_profiles" ADD CONSTRAINT "sales_doc_profiles_colour_ck" CHECK (
  "brand_colour" IS NULL OR "brand_colour" ~ '^#[0-9A-Fa-f]{6}$'
);
