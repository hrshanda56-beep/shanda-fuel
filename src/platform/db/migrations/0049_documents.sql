CREATE TABLE "app"."documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "object_key" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "documents_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "documents_tenant_object_key_uidx" UNIQUE("tenant_id", "object_key"),
  CONSTRAINT "documents_subject_type_ck" CHECK ("subject_type" in (
    'FUEL_DELIVERY', 'BANK_DEPOSIT', 'CASH_HANDOVER', 'RECONCILIATION', 'EXPENSE'
  )),
  CONSTRAINT "documents_kind_ck" CHECK ("kind" in (
    'INVOICE', 'DELIVERY_NOTE', 'DEPOSIT_SLIP', 'RECEIPT', 'PHOTO', 'OTHER'
  )),
  CONSTRAINT "documents_filename_nonempty_ck" CHECK (btrim("file_name") <> ''),
  CONSTRAINT "documents_content_type_ck" CHECK ("content_type" in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  CONSTRAINT "documents_byte_size_ck" CHECK ("byte_size" > 0 and "byte_size" <= 10485760),
  CONSTRAINT "documents_sha256_ck" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_station_fk"
  FOREIGN KEY ("tenant_id", "legal_entity_id", "station_id")
  REFERENCES "app"."stations"("tenant_id", "legal_entity_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_uploaded_by_fk"
  FOREIGN KEY ("tenant_id", "uploaded_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "documents_subject_idx"
  ON "app"."documents" USING btree ("tenant_id", "station_id", "subject_type", "subject_id");
--> statement-breakpoint
ALTER TABLE app.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_tenant_context ON app.documents
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.documents OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.documents TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.documents FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.documents TO diagnostics_readonly;
  END IF;
END
$$;
