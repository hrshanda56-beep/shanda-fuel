-- Migration 0094 added AUDITOR, AREA_MANAGER and CASH_COLLECTOR but left the invitation scope rule
-- on its original five roles, so inviting any of the three failed with a check violation (23514).
--
-- AUDITOR reads every screen of the organisation: company-wide, like an owner or administrator.
-- AREA_MANAGER and CASH_COLLECTOR work on selected stations, like a supervisor.
--
-- Only this one check constraint is replaced. No table, policy, grant or row changes.
ALTER TABLE app.staff_invitations DROP CONSTRAINT staff_invitations_scope_ck;
--> statement-breakpoint
ALTER TABLE app.staff_invitations ADD CONSTRAINT staff_invitations_scope_ck CHECK (
  (scope_type = 'TENANT' AND legal_entity_id IS NULL AND assigned_role IN ('OWNER', 'ADMINISTRATOR', 'AUDITOR'))
  OR (scope_type = 'LEGAL_ENTITY' AND legal_entity_id IS NOT NULL AND assigned_role IN ('FINANCE'))
  OR (scope_type = 'STATION' AND legal_entity_id IS NOT NULL AND assigned_role IN ('FINANCE', 'SUPERVISOR', 'ATTENDANT', 'AREA_MANAGER', 'CASH_COLLECTOR'))
);
