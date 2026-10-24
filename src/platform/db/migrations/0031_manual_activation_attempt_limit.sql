ALTER TABLE app.staff_invitations ADD COLUMN activation_failed_attempts integer NOT NULL DEFAULT 0
  CONSTRAINT staff_invitations_activation_attempts_ck CHECK (activation_failed_attempts BETWEEN 0 AND 5);
-- Owner-only capability access under FORCE RLS, matching the registry policy
-- introduced in 0029. Runtime principals receive no new table policy.
CREATE POLICY staff_invitations_security_definer ON app.staff_invitations
  TO migration_owner USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
--> statement-breakpoint
-- A manager's replacement token starts a new attempt budget. The lockout command
-- changes both the hash and counter together, so it does not reset itself.
CREATE FUNCTION app.reset_manual_activation_attempts() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     AND NEW.activation_failed_attempts = OLD.activation_failed_attempts THEN
    NEW.activation_failed_attempts := 0;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_activation_token_reset BEFORE UPDATE OF token_hash
ON app.staff_invitations FOR EACH ROW EXECUTE FUNCTION app.reset_manual_activation_attempts();
--> statement-breakpoint
CREATE FUNCTION app.check_manual_activation_attempt(p_staff_number text, p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, platform AS $$
DECLARE invitation app.staff_invitations%ROWTYPE;
BEGIN
  SELECT i.* INTO invitation FROM app.staff_invitations i
  JOIN app.staff_number_registry r ON r.id = i.staff_number_registry_id
  WHERE r.normalized_staff_number = upper(btrim(p_staff_number))
    AND r.status = 'RESERVED' AND r.reserved_invitation_id = i.id
    AND i.delivery_method = 'MANUAL' AND i.status = 'PENDING'
    AND i.expires_at > clock_timestamp()
  FOR UPDATE OF i;
  IF NOT FOUND OR invitation.activation_failed_attempts >= 5 THEN RETURN false; END IF;
  IF invitation.token_hash = p_token_hash THEN RETURN true; END IF;
  UPDATE app.staff_invitations SET
    activation_failed_attempts = activation_failed_attempts + 1,
    -- Burn the original hash permanently on attempt five. Even older identity
    -- capabilities cannot accept the old code after this point.
    token_hash = CASE WHEN activation_failed_attempts = 4
      THEN replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
      ELSE token_hash END,
    updated_at = clock_timestamp()
  WHERE id = invitation.id;
  RETURN false;
END $$;
ALTER FUNCTION app.check_manual_activation_attempt(text,text) OWNER TO migration_owner;
REVOKE ALL ON FUNCTION app.check_manual_activation_attempt(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.check_manual_activation_attempt(text,text) TO app_runtime;
ALTER FUNCTION app.reset_manual_activation_attempts() OWNER TO migration_owner;
REVOKE ALL ON FUNCTION app.reset_manual_activation_attempts() FROM PUBLIC;
