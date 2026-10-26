-- Alert email delivery is opt-in, tenant isolated and idempotent. The cron job
-- gets only a narrow recipient projection; alert contents are still loaded under
-- each recipient's normal application authority.
CREATE TABLE app.alert_email_preferences (
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_email_preferences_pk PRIMARY KEY (tenant_id, membership_id),
  CONSTRAINT alert_email_preferences_membership_fk
    FOREIGN KEY (tenant_id, membership_id) REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT alert_email_preferences_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by) REFERENCES app.memberships (tenant_id, id)
);
--> statement-breakpoint

CREATE TABLE app.alert_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  station_id uuid NOT NULL,
  digest_key text NOT NULL,
  item_ids jsonb NOT NULL,
  state text NOT NULL DEFAULT 'CLAIMED',
  provider_message_id text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  claim_expires_at timestamptz,
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_email_deliveries_tenant_id_id_uidx UNIQUE (tenant_id, id),
  CONSTRAINT alert_email_deliveries_recipient_digest_uidx
    UNIQUE (tenant_id, membership_id, station_id, digest_key),
  CONSTRAINT alert_email_deliveries_membership_fk
    FOREIGN KEY (tenant_id, membership_id) REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT alert_email_deliveries_station_fk
    FOREIGN KEY (tenant_id, station_id) REFERENCES app.stations (tenant_id, id),
  CONSTRAINT alert_email_deliveries_state_ck CHECK (state IN ('CLAIMED', 'FAILED', 'SENT')),
  CONSTRAINT alert_email_deliveries_digest_key_ck CHECK (btrim(digest_key) <> ''),
  CONSTRAINT alert_email_deliveries_sent_shape_ck CHECK (
    (state = 'SENT' AND sent_at IS NOT NULL AND provider_message_id IS NOT NULL)
    OR state <> 'SENT'
  )
);
--> statement-breakpoint

CREATE INDEX alert_email_deliveries_recipient_idx
  ON app.alert_email_deliveries (tenant_id, membership_id, station_id, sent_at);
--> statement-breakpoint

ALTER TABLE app.alert_email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.alert_email_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY alert_email_preferences_tenant_context ON app.alert_email_preferences
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
ALTER TABLE app.alert_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.alert_email_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY alert_email_deliveries_tenant_context ON app.alert_email_deliveries
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint

-- This is the only cross-tenant read used by the scheduled job. It returns no
-- alert text or financial values and follows the same station scope relation as
-- the application permission model. Preferences default to off.
CREATE FUNCTION app.alert_email_recipients(p_limit integer)
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
SET search_path = pg_catalog, app, platform, pg_temp
AS $$
  SELECT DISTINCT
    m.tenant_id,
    s.legal_entity_id,
    s.id,
    s.name,
    m.id,
    m.identity_id,
    lower(btrim(u.email)),
    NULLIF(btrim(u.name), '')
  FROM app.alert_email_preferences preference
  JOIN app.memberships m
    ON m.tenant_id = preference.tenant_id
   AND m.id = preference.membership_id
  JOIN app.users u ON u.id = m.identity_id
  JOIN app.tenants t ON t.id = m.tenant_id AND t.status = 'ACTIVE'
  JOIN app.stations s ON s.tenant_id = m.tenant_id AND s.status = 'ACTIVE'
  JOIN app.legal_entities le
    ON le.tenant_id = s.tenant_id
   AND le.id = s.legal_entity_id
   AND le.status = 'ACTIVE'
  JOIN app.membership_role_assignments assignment
    ON assignment.tenant_id = m.tenant_id
   AND assignment.membership_id = m.id
   AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
  JOIN platform.role_permissions report_permission
    ON report_permission.role_code = assignment.role_code
   AND report_permission.permission_code = 'report.view'
  JOIN platform.role_permissions station_permission
    ON station_permission.role_code = assignment.role_code
   AND station_permission.permission_code = 'station.view'
  WHERE preference.enabled
    AND m.status = 'ACTIVE'
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
    AND (
      assignment.scope_type = 'TENANT'
      OR (assignment.scope_type = 'LEGAL_ENTITY' AND assignment.legal_entity_id = s.legal_entity_id)
      OR (assignment.scope_type = 'STATION' AND assignment.legal_entity_id = s.legal_entity_id AND assignment.station_id = s.id)
    )
  ORDER BY m.tenant_id, s.id, m.id
  LIMIT greatest(least(coalesce(p_limit, 0), 1000), 0)
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.alert_email_recipients(integer) OWNER TO migration_owner;
  END IF;
  REVOKE ALL ON FUNCTION app.alert_email_recipients(integer) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.alert_email_recipients(integer) TO app_runtime;
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.alert_email_preferences OWNER TO migration_owner;
    ALTER TABLE app.alert_email_deliveries OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.alert_email_preferences TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.alert_email_preferences FROM app_runtime;
    GRANT SELECT, INSERT, UPDATE ON app.alert_email_deliveries TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.alert_email_deliveries FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.alert_email_preferences, app.alert_email_deliveries TO diagnostics_readonly;
  END IF;
END
$$;
