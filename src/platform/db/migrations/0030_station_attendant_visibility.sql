-- Operational membership visibility only: keep self/management policies intact.
-- No table-level UPDATE/DELETE grant on authoritative evidence is required.
CREATE POLICY memberships_station_attendants ON app.memberships
  FOR SELECT TO app_runtime
  USING (
    tenant_id = app.current_tenant_id()
    AND status = 'ACTIVE'
    AND app.has_active_membership()
    AND EXISTS (
      SELECT 1 FROM app.membership_role_assignments target
      WHERE target.tenant_id = app.current_tenant_id()
        AND target.membership_id = memberships.id
        AND target.role_code = 'ATTENDANT'
        AND target.scope_type = 'STATION'
        AND target.station_id::text = current_setting('app.station_id', true)
        AND (target.expires_at IS NULL OR target.expires_at > now())
    )
    AND EXISTS (
      SELECT 1 FROM app.stations station
      WHERE station.tenant_id = app.current_tenant_id()
        AND station.id::text = current_setting('app.station_id', true)
        AND (
          EXISTS (
            SELECT 1 FROM app.membership_role_assignments actor
            JOIN platform.role_permissions permission ON permission.role_code = actor.role_code
            WHERE actor.tenant_id = station.tenant_id
              AND actor.membership_id = app.current_membership_id()
              AND permission.permission_code IN ('reconciliation.view', 'meter.boundary.capture')
              AND (actor.expires_at IS NULL OR actor.expires_at > now())
              AND (actor.scope_type = 'TENANT'
                OR (actor.scope_type = 'LEGAL_ENTITY' AND actor.legal_entity_id = station.legal_entity_id)
                OR (actor.scope_type = 'STATION' AND actor.station_id = station.id
                    AND actor.legal_entity_id = station.legal_entity_id))
          )
          OR EXISTS (
            SELECT 1 FROM app.temporary_permission_grants permission
            WHERE permission.tenant_id = station.tenant_id
              AND permission.membership_id = app.current_membership_id()
              AND permission.permission_code IN ('reconciliation.view', 'meter.boundary.capture')
              AND permission.revoked_at IS NULL AND permission.expires_at > now()
              AND (permission.scope_type = 'TENANT'
                OR (permission.scope_type = 'LEGAL_ENTITY' AND permission.legal_entity_id = station.legal_entity_id)
                OR (permission.scope_type = 'STATION' AND permission.station_id = station.id
                    AND permission.legal_entity_id = station.legal_entity_id))
          )
        )
    )
  );

--> statement-breakpoint
-- PostgreSQL row locks require UPDATE on at least one column. Only the
-- immutable identifier is granted; the authoritative mutation trigger rejects
-- changing it. State, version, readings and all economic fields remain ungranted.
-- This supports existing FOR UPDATE/FOR SHARE readers, including A12 triggers,
-- while seal_meter_segment remains the only OPEN -> SEALED write capability.
GRANT UPDATE (id) ON app.meter_segments TO app_runtime;

--> statement-breakpoint
-- A12/REV1 attribution triggers take FOR SHARE locks on these immutable
-- sources. Their unconditional append-only triggers reject even id=id.
GRANT UPDATE (id) ON app.inventory_movements, app.inventory_cost_events, app.inventory_sale_cost_attributions TO app_runtime;
