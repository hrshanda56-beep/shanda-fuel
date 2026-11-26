-- The company's TIN and company registration number, printed on the letterhead of quotations,
-- invoices and receipts (feedback round, #308). Additive only: two optional text columns on the
-- existing company profile, so its row security, grants and audit stay as they are. Issued
-- documents keep the letterhead they were issued with, so nothing already issued changes.
-- Local development databases until approved.

ALTER TABLE "app"."sales_doc_profiles" ADD COLUMN "tin" text;
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_profiles" ADD COLUMN "registration_number" text;
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_profiles" ADD CONSTRAINT "sales_doc_profiles_ids_ck" CHECK (
  coalesce(char_length("tin"), 0) <= 60 AND coalesce(char_length("registration_number"), 0) <= 60
);
