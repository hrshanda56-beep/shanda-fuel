-- S18 / ADR-020: emailing alert digests. PROPOSED, OFF BY DEFAULT, needs security review before
-- any production use (docs/decisions/ADR-020-alert-email-delivery.md).
--
-- Four things:
--   1. app.alert_email_settings     one row per organisation; `enabled` is the master switch and is
--                                   OFF until the owner turns it on.
--   2. app.alert_email_preferences  a person's own switch. No row means "receive"; a row with
--                                   receive = false is an opt-out. A person writes only their own.
--   3. app.alert_deliveries         append-only record of what was emailed (alert ids and the
--                                   provider message id, never addresses or alert text). This is
--                                   what stops the same alert being emailed twice.
--   4. app.alert_digest_recipients  the ONE cross-organisation read the job needs: who to email.
--                                   SECURITY DEFINER, fixed search_path, returns a fixed column
--                                   list, and nothing else crosses organisations. Each person's
--                                   alerts are then read as that person with ordinary RLS.
CREATE TABLE "app"."alert_email_settings" (
  "tenant_id" uuid PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "updated_by" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."alert_email_settings" ADD CONSTRAINT "alert_email_settings_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."alert_email_settings" ADD CONSTRAINT "alert_email_settings_updated_by_fk"
  FOREIGN KEY ("tenant_id", "updated_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "app"."alert_email_preferences" (
  "tenant_id" uuid NOT NULL,
  "membership_id" uuid NOT NULL,
  "receive" boolean NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "alert_email_preferences_pk" PRIMARY KEY ("tenant_id", "membership_id")
);
--> statement-breakpoint
ALTER TABLE "app"."alert_email_preferences" ADD CONSTRAINT "alert_email_preferences_membership_fk"
  FOREIGN KEY ("tenant_id", "membership_id")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "app"."alert_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "membership_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "item_ids" text[] NOT NULL,
  "message_id" text NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "alert_deliveries_message_ck" CHECK (btrim("message_id") <> '' AND char_length("message_id") <= 200),
  CONSTRAINT "alert_deliveries_items_ck" CHECK (cardinality("item_ids") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "app"."alert_deliveries" ADD CONSTRAINT "alert_deliveries_membership_fk"
  FOREIGN KEY ("tenant_id", "membership_id")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."alert_deliveries" ADD CONSTRAINT "alert_deliveries_station_fk"
  FOREIGN KEY ("tenant_id", "station_id")
  REFERENCES "app"."stations"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "alert_deliveries_recent_idx"
  ON "app"."alert_deliveries" ("tenant_id", "membership_id", "station_id", "sent_at" DESC);
--> statement-breakpoint
CREATE FUNCTION app.alert_deliveries_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'alert deliveries are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER alert_deliveries_append_only
BEFORE UPDATE OR DELETE ON app.alert_deliveries
FOR EACH ROW EXECUTE FUNCTION app.alert_deliveries_append_only();
--> statement-breakpoint
ALTER TABLE app.alert_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.alert_email_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY alert_email_settings_tenant_context ON app.alert_email_settings
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
-- The recipient function runs as its owner and may only read this table, never change it.
CREATE POLICY alert_email_settings_definer_read ON app.alert_email_settings
  FOR SELECT TO migration_owner USING (current_user = 'migration_owner');
--> statement-breakpoint
ALTER TABLE app.alert_email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.alert_email_preferences FORCE ROW LEVEL SECURITY;
-- A person reads and writes only their own switch.
CREATE POLICY alert_email_preferences_own ON app.alert_email_preferences
  USING (
    tenant_id = app.current_tenant_id() AND app.has_active_membership()
    AND membership_id = app.current_membership_id()
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id() AND app.has_active_membership()
    AND membership_id = app.current_membership_id()
  );
CREATE POLICY alert_email_preferences_definer_read ON app.alert_email_preferences
  FOR SELECT TO migration_owner USING (current_user = 'migration_owner');
--> statement-breakpoint
ALTER TABLE app.alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.alert_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY alert_deliveries_own ON app.alert_deliveries
  USING (
    tenant_id = app.current_tenant_id() AND app.has_active_membership()
    AND membership_id = app.current_membership_id()
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id() AND app.has_active_membership()
    AND membership_id = app.current_membership_id()
  );
--> statement-breakpoint
-- Who should be emailed. Active people only, in organisations that switched alert email on, who
-- have not switched it off: owners, administrators and finance for the stations their role covers,
-- and a supervisor for the station they are assigned to. Returns exactly these columns.
-- Station status ACTIVE only; an expired role assignment does not count.
CREATE FUNCTION app.alert_digest_recipients(p_limit integer)
RETURNS TABLE (
  tenant_id uuid,
  legal_entity_id uuid,
  station_id uuid,
  station_name text,
  membership_id uuid,
  identity_id uuid,
  email text,
  display_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT DISTINCT
    s.tenant_id, s.legal_entity_id, s.id, s.name, m.id, m.identity_id, u.email, u.name
  FROM app.alert_email_settings es
  JOIN app.tenants t ON t.id = es.tenant_id AND t.status = 'ACTIVE'
  JOIN app.memberships m ON m.tenant_id = es.tenant_id AND m.status = 'ACTIVE'
  JOIN app.users u ON u.id = m.identity_id
  JOIN app.membership_role_assignments a
    ON a.tenant_id = m.tenant_id AND a.membership_id = m.id
   AND (a.expires_at IS NULL OR a.expires_at > now())
  JOIN app.stations s
    ON s.tenant_id = m.tenant_id AND s.status = 'ACTIVE'
   AND (
     (a.role_code IN ('OWNER', 'ADMINISTRATOR', 'FINANCE') AND (
       a.scope_type = 'TENANT'
       OR (a.scope_type = 'LEGAL_ENTITY' AND s.legal_entity_id = a.legal_entity_id)
       OR (a.scope_type = 'STATION' AND s.id = a.station_id)
     ))
     OR (a.role_code = 'SUPERVISOR' AND a.scope_type = 'STATION' AND s.id = a.station_id)
   )
  WHERE es.enabled
    AND btrim(u.email) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM app.alert_email_preferences p
      WHERE p.tenant_id = m.tenant_id AND p.membership_id = m.id AND NOT p.receive
    )
  ORDER BY s.tenant_id, s.id, m.id
  LIMIT greatest(least(coalesce(p_limit, 0), 1000), 0)
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.alert_email_settings OWNER TO migration_owner;
    ALTER TABLE app.alert_email_preferences OWNER TO migration_owner;
    ALTER TABLE app.alert_deliveries OWNER TO migration_owner;
    ALTER FUNCTION app.alert_deliveries_append_only() OWNER TO migration_owner;
    ALTER FUNCTION app.alert_digest_recipients(integer) OWNER TO migration_owner;
  END IF;
  REVOKE ALL ON FUNCTION app.alert_digest_recipients(integer) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.alert_email_settings TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.alert_email_settings FROM app_runtime;
    GRANT SELECT, INSERT, UPDATE ON app.alert_email_preferences TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.alert_email_preferences FROM app_runtime;
    GRANT SELECT, INSERT ON app.alert_deliveries TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.alert_deliveries FROM app_runtime;
    GRANT EXECUTE ON FUNCTION app.alert_digest_recipients(integer) TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.alert_digest_recipients(integer) TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.alert_email_settings TO diagnostics_readonly;
  END IF;
END
$$;
