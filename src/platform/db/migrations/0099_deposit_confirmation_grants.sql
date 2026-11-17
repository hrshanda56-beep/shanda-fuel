-- Migration 0093 added bank_date and confirmation_reason to app.bank_deposits, and confirming a
-- deposit now writes both. The application role may update only the columns it is granted
-- (0006), so every confirmation was refused with "permission denied". Grant just these two
-- columns; no other deposit column and no other table changes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE (bank_date, confirmation_reason) ON app.bank_deposits TO app_runtime;
  END IF;
END
$$;
