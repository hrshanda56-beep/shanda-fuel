-- Better Auth 1.7.5 TOTP enrollment state.
ALTER TABLE auth."user"
  ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE auth.two_factor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  verified boolean NOT NULL DEFAULT true,
  failed_verification_count integer NOT NULL DEFAULT 0,
  locked_until timestamp,
  CONSTRAINT auth_two_factor_user_id_uidx UNIQUE (user_id)
);

CREATE INDEX auth_two_factor_user_id_idx ON auth.two_factor (user_id);
CREATE INDEX auth_two_factor_secret_idx ON auth.two_factor (secret);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE auth.two_factor OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT USAGE ON SCHEMA auth TO app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.two_factor TO app_runtime;
    REVOKE TRUNCATE, TRIGGER, REFERENCES ON auth.two_factor FROM app_runtime;
  END IF;
END
$$;
