CREATE TABLE "app"."legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"registration_reference" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "legal_entities_tenant_id_id_uidx" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."membership_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"scope_type" text NOT NULL,
	"legal_entity_id" uuid,
	"station_id" uuid,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "membership_role_assignments_tenant_id_uidx" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"disabled_at" timestamp,
	"suspended_at" timestamp,
	"locked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "memberships_tenant_identity_uidx" UNIQUE("tenant_id","identity_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."permission_definitions" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."role_definitions" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."role_permissions" (
	"role_code" text NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permissions_role_code_permission_code_pk" PRIMARY KEY("role_code","permission_code")
);
--> statement-breakpoint
CREATE TABLE "platform"."security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid,
	"actor_id" uuid,
	"event_code" text NOT NULL,
	"request_id" uuid NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"key_id" text NOT NULL,
	"algorithm" text DEFAULT 'hmac-sha256' NOT NULL,
	"signature" text NOT NULL,
	CONSTRAINT "security_events_tenant_id_uidx" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Africa/Harare' NOT NULL,
	"status" text DEFAULT 'ONBOARDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "stations_tenant_code_uidx" UNIQUE("tenant_id","code"),
	CONSTRAINT "stations_tenant_legal_entity_id_id_uidx" UNIQUE("tenant_id","legal_entity_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."temporary_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	"scope_type" text NOT NULL,
	"legal_entity_id" uuid,
	"station_id" uuid,
	"expires_at" timestamp NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp,
	"revoked_by_membership_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "temporary_permission_grants_tenant_id_uidx" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "app"."legal_entities" ADD CONSTRAINT "legal_entities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership_role_assignments" ADD CONSTRAINT "membership_role_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership_role_assignments" ADD CONSTRAINT "membership_role_assignments_role_code_role_definitions_code_fk" FOREIGN KEY ("role_code") REFERENCES "platform"."role_definitions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership_role_assignments" ADD CONSTRAINT "membership_role_assignments_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership_role_assignments" ADD CONSTRAINT "membership_role_assignments_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership_role_assignments" ADD CONSTRAINT "membership_role_assignments_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_identity_id_user_id_fk" FOREIGN KEY ("identity_id") REFERENCES "auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."role_permissions" ADD CONSTRAINT "role_permissions_role_code_role_definitions_code_fk" FOREIGN KEY ("role_code") REFERENCES "platform"."role_definitions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permission_definitions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "platform"."permission_definitions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."security_events" ADD CONSTRAINT "security_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."security_events" ADD CONSTRAINT "security_events_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stations" ADD CONSTRAINT "stations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stations" ADD CONSTRAINT "stations_tenant_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_permission_code_fk" FOREIGN KEY ("permission_code") REFERENCES "platform"."permission_definitions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_revoked_by_fk" FOREIGN KEY ("tenant_id","revoked_by_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_entities_tenant_status_idx" ON "app"."legal_entities" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "membership_role_assignments_membership_scope_idx" ON "app"."membership_role_assignments" USING btree ("tenant_id","membership_id","scope_type");--> statement-breakpoint
CREATE INDEX "membership_role_assignments_role_scope_idx" ON "app"."membership_role_assignments" USING btree ("tenant_id","role_code","scope_type");--> statement-breakpoint
CREATE INDEX "memberships_tenant_identity_idx" ON "app"."memberships" USING btree ("tenant_id","identity_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_status_idx" ON "app"."memberships" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "security_events_tenant_occurred_idx" ON "platform"."security_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "security_events_tenant_event_code_idx" ON "platform"."security_events" USING btree ("tenant_id","event_code");--> statement-breakpoint
CREATE INDEX "stations_tenant_status_idx" ON "app"."stations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "temporary_permission_grants_active_lookup_idx" ON "app"."temporary_permission_grants" USING btree ("tenant_id","membership_id","permission_code","expires_at");--> statement-breakpoint
CREATE INDEX "temporary_permission_grants_revocation_idx" ON "app"."temporary_permission_grants" USING btree ("tenant_id","revoked_at");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "app"."tenants" USING btree ("status");

-- Hand-authored security layer. Drizzle owns table/index metadata above; this
-- reviewed SQL owns invariants, context functions, RLS, and least-privilege
-- grants and must not be regenerated away.
ALTER TABLE app.tenants
  ADD CONSTRAINT tenants_status_ck CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'));
ALTER TABLE app.legal_entities
  ADD CONSTRAINT legal_entities_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'));
ALTER TABLE app.stations
  ADD CONSTRAINT stations_status_ck CHECK (status IN ('ONBOARDING', 'ACTIVE', 'INACTIVE', 'ARCHIVED'));
ALTER TABLE app.memberships
  ADD CONSTRAINT memberships_status_ck CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DISABLED'));
ALTER TABLE app.membership_role_assignments
  ADD CONSTRAINT membership_role_assignments_scope_ck CHECK (
    (scope_type = 'TENANT' AND legal_entity_id IS NULL AND station_id IS NULL)
    OR (scope_type = 'LEGAL_ENTITY' AND legal_entity_id IS NOT NULL AND station_id IS NULL)
    OR (scope_type = 'STATION' AND legal_entity_id IS NOT NULL AND station_id IS NOT NULL)
  );
ALTER TABLE app.temporary_permission_grants
  ADD CONSTRAINT temporary_permission_grants_scope_ck CHECK (
    (scope_type = 'TENANT' AND legal_entity_id IS NULL AND station_id IS NULL)
    OR (scope_type = 'LEGAL_ENTITY' AND legal_entity_id IS NOT NULL AND station_id IS NULL)
    OR (scope_type = 'STATION' AND legal_entity_id IS NOT NULL AND station_id IS NOT NULL)
  );
ALTER TABLE platform.security_events
  ADD CONSTRAINT security_events_algorithm_ck CHECK (algorithm = 'hmac-sha256');

INSERT INTO platform.permission_definitions (code, description) VALUES
  ('tenant.context.select', 'Select the active tenant context'),
  ('tenant.view', 'View tenant metadata'),
  ('tenant.manage', 'Manage tenant metadata'),
  ('legal_entity.view', 'View legal-entity metadata'),
  ('legal_entity.manage', 'Manage legal-entity metadata'),
  ('station.view', 'View station metadata'),
  ('station.manage', 'Manage station metadata'),
  ('membership.view', 'View tenant memberships'),
  ('membership.invite', 'Invite an identity to a tenant'),
  ('membership.manage', 'Manage membership and role assignments'),
  ('membership.disable', 'Disable a tenant membership'),
  ('role.view', 'View role definitions and assignments'),
  ('role.manage', 'Manage role assignments'),
  ('document.view', 'View tenant documents'),
  ('document.upload', 'Upload tenant documents'),
  ('report.view', 'View available reports'),
  ('report.export', 'Export a report'),
  ('audit.view', 'View tenant audit events')
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform.role_definitions (code, description) VALUES
  ('OWNER', 'Tenant owner'),
  ('ADMINISTRATOR', 'Tenant administrator'),
  ('FINANCE', 'Finance operator'),
  ('SUPERVISOR', 'Station supervisor'),
  ('ATTENDANT', 'Station attendant')
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT 'OWNER', code FROM platform.permission_definitions
ON CONFLICT DO NOTHING;

INSERT INTO platform.role_permissions (role_code, permission_code) VALUES
  ('ADMINISTRATOR', 'tenant.context.select'), ('ADMINISTRATOR', 'tenant.view'),
  ('ADMINISTRATOR', 'tenant.manage'), ('ADMINISTRATOR', 'legal_entity.view'),
  ('ADMINISTRATOR', 'legal_entity.manage'), ('ADMINISTRATOR', 'station.view'),
  ('ADMINISTRATOR', 'station.manage'), ('ADMINISTRATOR', 'membership.view'),
  ('ADMINISTRATOR', 'membership.invite'), ('ADMINISTRATOR', 'membership.manage'),
  ('ADMINISTRATOR', 'membership.disable'), ('ADMINISTRATOR', 'role.view'),
  ('ADMINISTRATOR', 'role.manage'), ('ADMINISTRATOR', 'document.view'),
  ('ADMINISTRATOR', 'document.upload'), ('ADMINISTRATOR', 'report.view'),
  ('ADMINISTRATOR', 'report.export'), ('ADMINISTRATOR', 'audit.view'),
  ('FINANCE', 'tenant.context.select'), ('FINANCE', 'tenant.view'),
  ('FINANCE', 'legal_entity.view'), ('FINANCE', 'station.view'),
  ('FINANCE', 'document.view'), ('FINANCE', 'document.upload'),
  ('FINANCE', 'report.view'), ('FINANCE', 'report.export'), ('FINANCE', 'audit.view'),
  ('SUPERVISOR', 'tenant.context.select'), ('SUPERVISOR', 'tenant.view'),
  ('SUPERVISOR', 'station.view'), ('SUPERVISOR', 'document.view'),
  ('SUPERVISOR', 'document.upload'), ('SUPERVISOR', 'report.view'),
  ('ATTENDANT', 'tenant.context.select'), ('ATTENDANT', 'station.view')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('app.tenant_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN current_setting('app.tenant_id', true)::uuid
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION app.current_actor_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('app.actor_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN current_setting('app.actor_id', true)::uuid
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION app.current_membership_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('app.membership_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN current_setting('app.membership_id', true)::uuid
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION app.has_active_membership() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.memberships m
    WHERE m.tenant_id = app.current_tenant_id()
      AND m.id = app.current_membership_id()
      AND m.identity_id = app.current_actor_id()
      AND m.status = 'ACTIVE'
  )
$$;

CREATE OR REPLACE FUNCTION app.revoke_membership_grants_on_status_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'ACTIVE' AND OLD.status = 'ACTIVE' THEN
    UPDATE app.temporary_permission_grants
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE tenant_id = NEW.tenant_id
      AND membership_id = NEW.id
      AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER revoke_membership_grants
AFTER UPDATE OF status ON app.memberships
FOR EACH ROW EXECUTE FUNCTION app.revoke_membership_grants_on_status_change();

ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_context ON app.tenants
  USING (id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (id = app.current_tenant_id() AND app.has_active_membership());

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'legal_entities', 'stations', 'membership_role_assignments',
    'temporary_permission_grants'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())',
      table_name
    );
  END LOOP;
END
$$;

ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_context ON app.memberships
  USING (tenant_id = app.current_tenant_id() AND id = app.current_membership_id() AND identity_id = app.current_actor_id())
  WITH CHECK (tenant_id = app.current_tenant_id() AND id = app.current_membership_id() AND identity_id = app.current_actor_id());
CREATE POLICY memberships_identity_lookup ON app.memberships
  FOR SELECT USING (identity_id = app.current_actor_id());

ALTER TABLE platform.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.security_events FORCE ROW LEVEL SECURITY;
CREATE POLICY security_events_context ON platform.security_events
  FOR SELECT USING (tenant_id = app.current_tenant_id() AND app.has_active_membership());
CREATE POLICY security_events_append ON platform.security_events
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());

DROP POLICY IF EXISTS temporary_grant_revocation ON app.temporary_permission_grants;
CREATE POLICY temporary_grant_revocation ON app.temporary_permission_grants
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND revoked_at IS NOT NULL);

DO $$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER SCHEMA app OWNER TO migration_owner;
    ALTER SCHEMA platform OWNER TO migration_owner;
    FOREACH table_name IN ARRAY ARRAY[
      'tenants', 'legal_entities', 'stations', 'memberships',
      'membership_role_assignments', 'temporary_permission_grants'
    ] LOOP
      EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name);
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY['permission_definitions', 'role_definitions', 'role_permissions', 'security_events'] LOOP
      EXECUTE format('ALTER TABLE platform.%I OWNER TO migration_owner', table_name);
    END LOOP;
    EXECUTE 'ALTER FUNCTION app.current_tenant_id() OWNER TO migration_owner';
    EXECUTE 'ALTER FUNCTION app.current_actor_id() OWNER TO migration_owner';
    EXECUTE 'ALTER FUNCTION app.current_membership_id() OWNER TO migration_owner';
    EXECUTE 'ALTER FUNCTION app.has_active_membership() OWNER TO migration_owner';
    EXECUTE 'ALTER FUNCTION app.revoke_membership_grants_on_status_change() OWNER TO migration_owner';
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA app, auth, platform FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    GRANT USAGE, CREATE ON SCHEMA app, auth, platform TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT USAGE ON SCHEMA app, auth, platform TO app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app, auth TO app_runtime;
    GRANT SELECT ON ALL TABLES IN SCHEMA platform TO app_runtime;
    GRANT SELECT, INSERT ON platform.security_events TO app_runtime;
    REVOKE DELETE ON app.memberships FROM app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON platform.security_events FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT USAGE ON SCHEMA app, auth, platform TO job_runtime;
    GRANT SELECT ON ALL TABLES IN SCHEMA app, auth, platform TO job_runtime;
    GRANT INSERT ON platform.security_events TO job_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON platform.security_events FROM job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT USAGE ON SCHEMA app, auth, platform TO diagnostics_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA app, auth, platform TO diagnostics_readonly;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON platform.security_events FROM diagnostics_readonly;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION app.current_tenant_id(), app.current_actor_id(),
  app.current_membership_id(), app.has_active_membership()
TO app_runtime, job_runtime, diagnostics_readonly;
