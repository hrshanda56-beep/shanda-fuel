CREATE TABLE "app"."expense_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "expense_id" uuid NOT NULL,
  "object_key" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "expense_attachments_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "expense_attachments_tenant_object_key_uidx" UNIQUE("tenant_id", "object_key"),
  CONSTRAINT "expense_attachments_filename_nonempty_ck" CHECK (btrim("app"."expense_attachments"."file_name") <> ''),
  CONSTRAINT "expense_attachments_content_type_ck" CHECK ("app"."expense_attachments"."content_type" in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  CONSTRAINT "expense_attachments_byte_size_ck" CHECK ("app"."expense_attachments"."byte_size" > 0 and "app"."expense_attachments"."byte_size" <= 10485760),
  CONSTRAINT "expense_attachments_sha256_ck" CHECK ("app"."expense_attachments"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "app"."expense_attachments" ADD CONSTRAINT "expense_attachments_station_fk"
  FOREIGN KEY ("tenant_id", "legal_entity_id", "station_id")
  REFERENCES "app"."stations"("tenant_id", "legal_entity_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_attachments" ADD CONSTRAINT "expense_attachments_expense_fk"
  FOREIGN KEY ("tenant_id", "station_id", "expense_id")
  REFERENCES "app"."expenses"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_attachments" ADD CONSTRAINT "expense_attachments_uploaded_by_fk"
  FOREIGN KEY ("tenant_id", "uploaded_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expense_attachments_expense_idx"
  ON "app"."expense_attachments" USING btree ("tenant_id", "station_id", "expense_id");
--> statement-breakpoint
ALTER TABLE app.expense_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.expense_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_attachments_tenant_context ON app.expense_attachments
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.expense_attachments OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.expense_attachments TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.expense_attachments FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.expense_attachments TO diagnostics_readonly;
  END IF;
END
$$;
