-- A company's logo with a transparent background, shown on the loading truck (feedback round, #257).
-- Additive only. A small PNG kept as base64 text, next to the JPEG used on printed documents, so no
-- file storage is needed. Local development databases until approved.

ALTER TABLE "app"."sales_doc_profiles" ADD COLUMN "app_logo_png_base64" text;
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_profiles" ADD CONSTRAINT "sales_doc_profiles_app_logo_ck" CHECK (
  "app_logo_png_base64" IS NULL OR (
    char_length("app_logo_png_base64") <= 300000
    AND "app_logo_png_base64" ~ '^iVBORw0KGgo[A-Za-z0-9+/]+=*$'
  )
);
