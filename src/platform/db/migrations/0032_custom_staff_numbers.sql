ALTER TABLE app.staff_number_registry DROP CONSTRAINT staff_number_registry_staff_number_ck;
ALTER TABLE app.staff_number_registry ADD CONSTRAINT staff_number_registry_staff_number_ck CHECK (staff_number ~ '^[A-Z0-9][A-Z0-9_-]{3,31}$');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.reserve_staff_number(
  p_invitation_id uuid,
  p_staff_number text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
DECLARE
  normalized text;
  registry_id uuid;
BEGIN
  normalized := upper(btrim(p_staff_number));
  IF p_invitation_id IS NULL OR normalized !~ '^[A-Z0-9][A-Z0-9_-]{3,31}$' THEN
    RAISE EXCEPTION 'staff number reservation unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.staff_invitations invitation
    WHERE invitation.id = p_invitation_id
      AND invitation.tenant_id = app.current_tenant_id()
  ) THEN
    RAISE EXCEPTION 'staff number reservation unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT app.has_active_membership() THEN
    RAISE EXCEPTION 'staff number reservation unavailable' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO app.staff_number_registry (
    staff_number, normalized_staff_number, reserved_invitation_id, status
  ) VALUES (normalized, normalized, p_invitation_id, 'RESERVED')
  RETURNING id INTO registry_id;

  RETURN registry_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'That staff number is already in use' USING ERRCODE = '23505';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.resolve_manual_staff_invitation(
  p_token_hash text,
  p_staff_number text
)
RETURNS TABLE (
  invitation_id uuid,
  tenant_id uuid,
  invited_name text,
  assigned_role text,
  scope_type text,
  legal_entity_id uuid,
  registry_id uuid,
  staff_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
DECLARE
  normalized text;
BEGIN
  normalized := upper(btrim(p_staff_number));
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR normalized !~ '^[A-Z0-9][A-Z0-9_-]{3,31}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT invitation.id,
         invitation.tenant_id,
         invitation.invited_name,
         invitation.assigned_role,
         invitation.scope_type,
         invitation.legal_entity_id,
         registry.id,
         registry.staff_number
  FROM app.staff_invitations invitation
  JOIN app.staff_number_registry registry
    ON registry.id = invitation.staff_number_registry_id
  WHERE invitation.token_hash = p_token_hash
    AND invitation.delivery_method = 'MANUAL'
    AND invitation.status = 'PENDING'
    AND invitation.expires_at > clock_timestamp()
    AND registry.normalized_staff_number = normalized
    AND registry.status = 'RESERVED'
  FOR UPDATE;
END;
$$;
