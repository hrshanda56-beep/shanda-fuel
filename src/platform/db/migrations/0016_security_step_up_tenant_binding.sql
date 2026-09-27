-- Production step-up is scoped to the tenant selected for the challenge.
-- The existing session assurance fields remain session-bound; this field
-- prevents a valid challenge from being reused in another tenant context.
ALTER TABLE auth.session
  ADD COLUMN step_up_tenant_id uuid;
