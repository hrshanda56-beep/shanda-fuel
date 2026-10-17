-- The A9 append-only validation trigger must inspect and lock the original
-- allocation while the runtime role is intentionally denied direct mutation.
-- PostgreSQL requires UPDATE privilege for row locks; the existing trigger
-- still rejects every UPDATE/DELETE, so this grants lock capability without
-- weakening the append-only invariant or changing trigger tenant context.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE ON app.provider_settlement_allocations TO app_runtime;
  END IF;
END;
$$;
