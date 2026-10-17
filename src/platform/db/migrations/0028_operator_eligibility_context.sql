-- Preserve strict membership RLS while allowing a station operator to record
-- a boundary on behalf of another eligible operator. This internal snapshot
-- is maintained by database triggers, is not directly readable by runtime
-- roles, and is queried only by the tenant-checked capability function below.
CREATE TABLE "app"."membership_status_context" (
  "tenant_id" uuid NOT NULL,
  "membership_id" uuid NOT NULL,
  "status" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "membership_status_context_pk" PRIMARY KEY("tenant_id", "membership_id"),
  CONSTRAINT "membership_status_context_membership_fk"
    FOREIGN KEY ("tenant_id", "membership_id")
    REFERENCES "app"."memberships"("tenant_id", "id")
);
--> statement-breakpoint
CREATE INDEX "membership_status_context_status_idx"
  ON "app"."membership_status_context" USING btree ("tenant_id", "status");

ALTER TABLE app.membership_status_context
  ADD CONSTRAINT membership_status_context_status_ck
  CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DISABLED'));

ALTER TABLE app.membership_status_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membership_status_context FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_status_context_internal ON app.membership_status_context
  USING (
    current_user = 'migration_owner'
    OR (
      tenant_id = app.current_tenant_id()
      AND app.current_actor_id() IS NOT NULL
      AND app.current_membership_id() IS NOT NULL
    )
  )
  WITH CHECK (
    current_user = 'migration_owner'
    OR (
      tenant_id = app.current_tenant_id()
      AND app.current_actor_id() IS NOT NULL
      AND app.current_membership_id() IS NOT NULL
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.membership_status_context OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    REVOKE ALL ON app.membership_status_context FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    REVOKE ALL ON app.membership_status_context FROM job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    REVOKE ALL ON app.membership_status_context FROM diagnostics_readonly;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app.sync_membership_status_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app.membership_status_context
     WHERE tenant_id = OLD.tenant_id
       AND membership_id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO app.membership_status_context (tenant_id, membership_id, status, updated_at)
  VALUES (NEW.tenant_id, NEW.id, NEW.status, clock_timestamp())
  ON CONFLICT (tenant_id, membership_id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.sync_membership_status_context() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.sync_membership_status_context() OWNER TO migration_owner;
  END IF;
END
$$;

-- The trigger inserts the immutable exception fact on behalf of the boundary
-- command. Its owner must be the controlled migration owner so the existing
-- append-only mutation guard recognizes this named capability path.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.create_meter_exception_for_unavailable_boundary() OWNER TO migration_owner;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS membership_status_context_sync ON app.memberships;
CREATE TRIGGER membership_status_context_sync
  AFTER INSERT OR UPDATE OF status OR DELETE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION app.sync_membership_status_context();

INSERT INTO app.membership_status_context (tenant_id, membership_id, status, updated_at)
SELECT tenant_id, id, status, clock_timestamp()
  FROM app.memberships
ON CONFLICT (tenant_id, membership_id) DO UPDATE
  SET status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION app.is_station_operator(
  p_tenant_id uuid,
  p_station_id uuid,
  p_membership_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
  SELECT app.current_tenant_id() IS NOT DISTINCT FROM p_tenant_id
     AND app.has_active_membership()
     AND EXISTS (
       SELECT 1
       FROM app.membership_role_assignments AS assignment
       JOIN app.membership_status_context AS membership_status
         ON membership_status.tenant_id = assignment.tenant_id
        AND membership_status.membership_id = assignment.membership_id
       WHERE assignment.tenant_id = p_tenant_id
         AND assignment.membership_id = p_membership_id
         AND membership_status.status = 'ACTIVE'
         AND assignment.scope_type = 'STATION'
         AND assignment.station_id = p_station_id
         AND assignment.role_code IN ('ATTENDANT', 'SUPERVISOR')
         AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
     );
$$;

REVOKE ALL ON FUNCTION app.is_station_operator(uuid, uuid, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.is_station_operator(uuid, uuid, uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.is_station_operator(uuid, uuid, uuid) TO app_runtime;
  END IF;
END
$$;
