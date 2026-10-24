-- Preserve the incoming finance state machine; only a scoped correction
-- capability can advance unreviewed facts. Posted changes remain reversals.
CREATE OR REPLACE FUNCTION app.a6_expense_state_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approved_count integer;
BEGIN
  IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
    IF current_user IS DISTINCT FROM pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='app.correct_expense_version(uuid,uuid,text,text,text,text,text)'::regprocedure)) OR current_user=session_user OR OLD.state<>'SUBMITTED' OR NEW.state<>'SUBMITTED' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.expense_date IS DISTINCT FROM OLD.expense_date OR NEW.shift_id IS DISTINCT FROM OLD.shift_id OR NEW.observed_at IS DISTINCT FROM OLD.observed_at OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'expense correction capability required';END IF;
    IF EXISTS(SELECT 1 FROM app.expense_approvals WHERE tenant_id=OLD.tenant_id AND expense_id=OLD.id) OR EXISTS(SELECT 1 FROM app.expense_payments WHERE tenant_id=OLD.tenant_id AND expense_id=OLD.id AND state='RECORDED') THEN RAISE EXCEPTION 'reviewed or settled expense requires controlled rejection/reversal';END IF;
    IF NOT EXISTS(SELECT 1 FROM app.expense_versions v WHERE v.tenant_id=NEW.tenant_id AND v.station_id=NEW.station_id AND v.expense_id=NEW.id AND v.id=NEW.current_version_id AND v.previous_version_id=OLD.current_version_id AND v.amount=NEW.amount AND v.description=NEW.description AND v.payee IS NOT DISTINCT FROM NEW.payee AND v.reference IS NOT DISTINCT FROM NEW.reference) THEN RAISE EXCEPTION 'expense facts must match their exact successor version';END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
     NEW.station_id IS DISTINCT FROM OLD.station_id OR
     NEW.category_id IS DISTINCT FROM OLD.category_id OR
     NEW.expense_date IS DISTINCT FROM OLD.expense_date OR
     NEW.description IS DISTINCT FROM OLD.description OR
     NEW.payee IS DISTINCT FROM OLD.payee OR
     NEW.reference IS DISTINCT FROM OLD.reference OR
     NEW.currency IS DISTINCT FROM OLD.currency OR
     NEW.amount IS DISTINCT FROM OLD.amount OR
     NEW.required_approvals IS DISTINCT FROM OLD.required_approvals OR
     NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR
     NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'expense facts are immutable; use a named correction command';
  END IF;
  IF OLD.state = 'SUBMITTED' AND NEW.state NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'submitted expenses can only be approved or rejected';
  END IF;
  IF OLD.state = 'APPROVED' AND NEW.state NOT IN ('APPROVED', 'POSTED') THEN
    RAISE EXCEPTION 'approved expenses can only be posted';
  END IF;
  IF OLD.state = 'POSTED' AND NEW.state NOT IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted expenses can only be reversed';
  END IF;
  IF OLD.state IN ('REJECTED', 'REVERSED') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'rejected and reversed expenses are terminal';
  END IF;
  IF NEW.state = 'APPROVED' AND OLD.state = 'SUBMITTED' THEN
    SELECT count(*) INTO approved_count
    FROM app.expense_approvals
    WHERE tenant_id = NEW.tenant_id AND expense_id = NEW.id AND decision = 'APPROVED';
    IF approved_count < NEW.required_approvals THEN
      RAISE EXCEPTION 'expense does not have the required number of approvals';
    END IF;
  END IF;
  IF NEW.state = 'REVERSED' AND OLD.state = 'POSTED' AND EXISTS (
    SELECT 1 FROM app.expense_payments
    WHERE tenant_id = NEW.tenant_id AND expense_id = NEW.id AND state = 'RECORDED'
  ) THEN
    RAISE EXCEPTION 'reverse recorded settlements before reversing the expense';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.unified_expense_parent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NEW.shift_id IS DISTINCT FROM OLD.shift_id OR NEW.observed_at IS DISTINCT FROM OLD.observed_at THEN RAISE EXCEPTION 'shift evidence association is immutable';END IF;
 IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id AND (current_user IS DISTINCT FROM pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='app.correct_expense_version(uuid,uuid,text,text,text,text,text)'::regprocedure)) OR current_user=session_user) THEN RAISE EXCEPTION 'authorized expense version correction required';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.correct_expense_version(p_expense uuid,p_expected uuid,p_amount text,p_description text,p_payee text,p_reference text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE tenant uuid:=app.current_tenant_id();station uuid:=nullif(current_setting('app.station_id',true),'')::uuid;actor uuid:=app.current_membership_id();e app.expenses%ROWTYPE;prior app.expense_versions%ROWTYPE;new_id uuid:=gen_random_uuid();threshold numeric(20,4);required integer;
BEGIN
 IF NOT app.has_active_membership() OR NOT EXISTS(SELECT 1 FROM app.membership_role_assignments a JOIN app.stations s ON s.tenant_id=a.tenant_id AND s.id=station WHERE a.tenant_id=tenant AND a.membership_id=actor AND(a.expires_at IS NULL OR a.expires_at>now()) AND((a.role_code='SUPERVISOR' AND a.scope_type='STATION' AND a.station_id=station) OR(a.role_code IN('OWNER','ADMINISTRATOR') AND(a.scope_type='TENANT' OR(a.scope_type='LEGAL_ENTITY' AND a.legal_entity_id=s.legal_entity_id) OR(a.scope_type='STATION' AND a.station_id=station))))) THEN RAISE EXCEPTION 'station expense correction denied' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM app.expenses WHERE tenant_id=tenant AND station_id=station AND id=p_expense;
 IF e.shift_id IS NOT NULL THEN PERFORM 1 FROM app.shifts WHERE tenant_id=tenant AND station_id=station AND id=e.shift_id FOR UPDATE;END IF;
 SELECT * INTO e FROM app.expenses WHERE tenant_id=tenant AND station_id=station AND id=p_expense FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION 'expense not found' USING ERRCODE='P0002';END IF;
 IF e.current_version_id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'stale expense version' USING ERRCODE='40001';END IF;
 IF e.state<>'SUBMITTED' OR EXISTS(SELECT 1 FROM app.expense_approvals WHERE tenant_id=tenant AND expense_id=e.id) OR EXISTS(SELECT 1 FROM app.expense_payments WHERE tenant_id=tenant AND expense_id=e.id AND state='RECORDED') OR EXISTS(SELECT 1 FROM app.reconciliation_expense_version_sources x JOIN app.reconciliation_revisions r ON r.tenant_id=x.tenant_id AND r.station_id=x.station_id AND r.id=x.revision_id WHERE x.tenant_id=tenant AND x.station_id=station AND x.expense_id=e.id AND r.state<>'READY') THEN RAISE EXCEPTION 'expense must be unreviewed and unused by a submitted report; otherwise use controlled return or reversal' USING ERRCODE='40001';END IF;
 IF e.shift_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.shifts WHERE tenant_id=tenant AND station_id=station AND id=e.shift_id AND state='OPEN') THEN RAISE EXCEPTION 'closed shift corrections require an explicit exception workflow' USING ERRCODE='40001';END IF;
 IF p_amount IS NULL OR p_amount!~ '^\d{1,16}(\.\d{1,4})?$' OR p_amount::numeric<=0 OR length(btrim(coalesce(p_description,''))) NOT BETWEEN 1 AND 500 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'valid exact amount, description and correction reason required' USING ERRCODE='22023';END IF;
 SELECT * INTO prior FROM app.expense_versions WHERE id=p_expected AND tenant_id=tenant AND station_id=station AND expense_id=e.id;
 SELECT second_approval_threshold INTO threshold FROM app.expense_policies WHERE tenant_id=tenant AND legal_entity_id=e.legal_entity_id;required:=CASE WHEN threshold IS NOT NULL AND p_amount::numeric>=threshold THEN 2 ELSE 1 END;
 INSERT INTO app.expense_versions(id,tenant_id,station_id,expense_id,version_number,previous_version_id,category_id,expense_date,description,payee,reference,amount,currency,shift_id,observed_at,lineage_status,change_reason,created_by)
 VALUES(new_id,tenant,station,e.id,prior.version_number+1,prior.id,e.category_id,e.expense_date,p_description,nullif(btrim(p_payee),''),nullif(btrim(p_reference),''),p_amount::numeric,e.currency,e.shift_id,e.observed_at,prior.lineage_status,p_reason,actor);
 UPDATE app.expenses SET amount=p_amount::numeric,description=p_description,payee=nullif(btrim(p_payee),''),reference=nullif(btrim(p_reference),''),current_version_id=new_id,required_approvals=required,version=version+1,updated_at=clock_timestamp() WHERE id=e.id AND tenant_id=tenant AND station_id=station;
 RETURN jsonb_build_object('expenseId',e.id,'versionId',new_id,'versionNumber',prior.version_number+1,'version',e.version+1);
END $$;
REVOKE ALL ON FUNCTION app.correct_expense_version(uuid,uuid,text,text,text,text,text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime')THEN GRANT EXECUTE ON FUNCTION app.correct_expense_version(uuid,uuid,text,text,text,text,text) TO app_runtime;END IF;END $$;
--> statement-breakpoint
CREATE FUNCTION app.guard_unified_reconciliation_expense_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE report_shift uuid;rev_state text;source_shift uuid;current_source uuid;
BEGIN
 SELECT h.shift_id,r.state INTO report_shift,rev_state FROM app.reconciliation_revisions r JOIN app.reconciliations h ON h.tenant_id=r.tenant_id AND h.station_id=r.station_id AND h.id=r.reconciliation_id WHERE r.tenant_id=NEW.tenant_id AND r.station_id=NEW.station_id AND r.id=NEW.revision_id FOR UPDATE OF r;
 SELECT shift_id,current_version_id INTO source_shift,current_source FROM app.expenses WHERE tenant_id=NEW.tenant_id AND station_id=NEW.station_id AND id=NEW.expense_id FOR UPDATE;
 IF report_shift IS NULL OR rev_state IS DISTINCT FROM 'READY' OR source_shift IS DISTINCT FROM report_shift OR current_source IS DISTINCT FROM NEW.expense_version_id THEN RAISE EXCEPTION 'expense version source must belong to the unsubmitted report shift';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_unified_reconciliation_expense_source BEFORE INSERT ON app.reconciliation_expense_version_sources FOR EACH ROW EXECUTE FUNCTION app.guard_unified_reconciliation_expense_source();
