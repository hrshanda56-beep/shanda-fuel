-- Integration candidate: based on incoming 0035_expenses through 0040.
-- Do NOT replay on a database containing the incompatible operational expenses
-- table. Its separately reviewed conversion must run first. No legacy IDs drop.
ALTER TABLE app.expenses ADD COLUMN shift_id uuid,ADD COLUMN observed_at timestamptz,ADD COLUMN current_version_id uuid;
ALTER TABLE app.expenses ADD CONSTRAINT unified_expense_shift_fk FOREIGN KEY(tenant_id,station_id,shift_id) REFERENCES app.shifts(tenant_id,station_id,id),ADD CONSTRAINT unified_expense_shift_time_ck CHECK((shift_id IS NULL)=(observed_at IS NULL));
CREATE TABLE app.expense_versions(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,station_id uuid NOT NULL,expense_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0),previous_version_id uuid,
 category_id uuid NOT NULL,expense_date text NOT NULL,description text NOT NULL,payee text,reference text,
 amount numeric(20,4) NOT NULL CHECK(amount>0),currency text NOT NULL CHECK(currency='USD'),
 shift_id uuid,observed_at timestamptz,lineage_status text NOT NULL CHECK(lineage_status IN('COMPLETE','LEGACY_SNAPSHOT')),
 change_reason text NOT NULL CHECK(length(btrim(change_reason))>0),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,station_id,id),UNIQUE(tenant_id,station_id,expense_id,id),UNIQUE(tenant_id,station_id,expense_id,version_number),UNIQUE(tenant_id,station_id,expense_id,previous_version_id),
 CHECK((version_number=1 AND previous_version_id IS NULL) OR(version_number>1 AND previous_version_id IS NOT NULL)),CHECK((shift_id IS NULL)=(observed_at IS NULL)),
 FOREIGN KEY(tenant_id,station_id,expense_id) REFERENCES app.expenses(tenant_id,station_id,id),
 FOREIGN KEY(tenant_id,station_id,expense_id,previous_version_id) REFERENCES app.expense_versions(tenant_id,station_id,expense_id,id),
 FOREIGN KEY(tenant_id,station_id,shift_id) REFERENCES app.shifts(tenant_id,station_id,id),
 FOREIGN KEY(tenant_id,category_id) REFERENCES app.expense_categories(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES app.memberships(tenant_id,id)
);
ALTER TABLE app.expenses ADD CONSTRAINT unified_expense_current_version_fk FOREIGN KEY(tenant_id,station_id,id,current_version_id) REFERENCES app.expense_versions(tenant_id,station_id,expense_id,id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- Existing facts are a present snapshot, never a claim about unknown history.
INSERT INTO app.expense_versions(id,tenant_id,station_id,expense_id,version_number,category_id,expense_date,description,payee,reference,amount,currency,lineage_status,change_reason,created_by)
 SELECT gen_random_uuid(),tenant_id,station_id,id,1,category_id,expense_date,description,payee,reference,amount,currency,'LEGACY_SNAPSHOT','Existing immutable expense facts at integration',submitted_by FROM app.expenses;
UPDATE app.expenses e SET current_version_id=v.id FROM app.expense_versions v WHERE v.tenant_id=e.tenant_id AND v.station_id=e.station_id AND v.expense_id=e.id;
ALTER TABLE app.expenses ALTER COLUMN current_version_id SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION app.unified_expense_initial_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE sh app.shifts%ROWTYPE;
BEGIN
 IF TG_WHEN='BEFORE' THEN
  IF NEW.current_version_id IS NOT NULL THEN RAISE EXCEPTION 'initial expense version is server assigned'; END IF;
  NEW.current_version_id:=gen_random_uuid();
  IF NEW.shift_id IS NOT NULL THEN
   SELECT * INTO sh FROM app.shifts WHERE tenant_id=NEW.tenant_id AND station_id=NEW.station_id AND id=NEW.shift_id FOR UPDATE;
   IF sh.id IS NULL OR sh.state IS DISTINCT FROM 'OPEN' OR NEW.observed_at IS NULL OR NEW.observed_at<sh.opened_at OR NEW.observed_at>clock_timestamp() OR NEW.expense_date IS DISTINCT FROM sh.business_date THEN RAISE EXCEPTION 'expense must belong to its open station shift' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 INSERT INTO app.expense_versions(id,tenant_id,station_id,expense_id,version_number,category_id,expense_date,description,payee,reference,amount,currency,shift_id,observed_at,lineage_status,change_reason,created_by)
 VALUES(NEW.current_version_id,NEW.tenant_id,NEW.station_id,NEW.id,1,NEW.category_id,NEW.expense_date,NEW.description,NEW.payee,NEW.reference,NEW.amount,NEW.currency,NEW.shift_id,NEW.observed_at,'COMPLETE','Initial expense submission',NEW.submitted_by);
 RETURN NEW;
END $$;
CREATE TRIGGER unified_expense_initial_pointer BEFORE INSERT ON app.expenses FOR EACH ROW EXECUTE FUNCTION app.unified_expense_initial_version();
CREATE TRIGGER unified_expense_initial_snapshot AFTER INSERT ON app.expenses FOR EACH ROW EXECUTE FUNCTION app.unified_expense_initial_version();
CREATE FUNCTION app.unified_expense_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN RAISE EXCEPTION 'expense versions and source references are immutable';END $$;
CREATE TRIGGER unified_expense_version_immutable BEFORE UPDATE OR DELETE ON app.expense_versions FOR EACH ROW EXECUTE FUNCTION app.unified_expense_immutable();
CREATE FUNCTION app.unified_expense_parent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NEW.shift_id IS DISTINCT FROM OLD.shift_id OR NEW.observed_at IS DISTINCT FROM OLD.observed_at OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN RAISE EXCEPTION 'expense evidence requires an authorized version correction'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER unified_expense_parent_guard BEFORE UPDATE ON app.expenses FOR EACH ROW EXECUTE FUNCTION app.unified_expense_parent_guard();
--> statement-breakpoint
-- Typed reference alongside existing recognition ledger. Existing movements stay
-- unchanged; links to imported snapshots are explicitly labelled limited lineage.
CREATE TABLE app.expense_recognition_version_sources(
 tenant_id uuid NOT NULL,station_id uuid NOT NULL,movement_id uuid NOT NULL,expense_id uuid NOT NULL,expense_version_id uuid NOT NULL,lineage_status text NOT NULL CHECK(lineage_status IN('COMPLETE','LEGACY_SNAPSHOT')),
 PRIMARY KEY(tenant_id,movement_id),
 FOREIGN KEY(tenant_id,movement_id) REFERENCES app.expense_recognition_movements(tenant_id,id),
 FOREIGN KEY(tenant_id,station_id,expense_id,expense_version_id) REFERENCES app.expense_versions(tenant_id,station_id,expense_id,id)
);
INSERT INTO app.expense_recognition_version_sources(tenant_id,station_id,movement_id,expense_id,expense_version_id,lineage_status)
 SELECT m.tenant_id,m.station_id,m.id,e.id,e.current_version_id,'LEGACY_SNAPSHOT' FROM app.expense_recognition_movements m JOIN app.expenses e ON e.tenant_id=m.tenant_id AND e.station_id=m.station_id AND e.id=m.source_id WHERE m.source_type='EXPENSE';
CREATE TRIGGER expense_recognition_version_source_immutable BEFORE UPDATE OR DELETE ON app.expense_recognition_version_sources FOR EACH ROW EXECUTE FUNCTION app.unified_expense_immutable();
CREATE FUNCTION app.capture_expense_recognition_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE e app.expenses%ROWTYPE;
BEGIN
 IF NEW.source_type<>'EXPENSE' THEN RETURN NEW;END IF;
 SELECT * INTO e FROM app.expenses WHERE tenant_id=NEW.tenant_id AND station_id=NEW.station_id AND id=NEW.source_id FOR UPDATE;
 IF e.id IS NULL OR e.amount IS DISTINCT FROM NEW.amount OR e.category_id IS DISTINCT FROM NEW.category_id THEN RAISE EXCEPTION 'recognition must match exact expense evidence';END IF;
 INSERT INTO app.expense_recognition_version_sources(tenant_id,station_id,movement_id,expense_id,expense_version_id,lineage_status) VALUES(NEW.tenant_id,NEW.station_id,NEW.id,e.id,e.current_version_id,'COMPLETE');RETURN NEW;
END $$;
CREATE TRIGGER capture_expense_recognition_version AFTER INSERT ON app.expense_recognition_movements FOR EACH ROW EXECUTE FUNCTION app.capture_expense_recognition_version();
--> statement-breakpoint
CREATE TABLE app.reconciliation_expense_version_sources(
 tenant_id uuid NOT NULL,station_id uuid NOT NULL,revision_id uuid NOT NULL,expense_id uuid NOT NULL,expense_version_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,station_id,revision_id,expense_id),
 FOREIGN KEY(tenant_id,station_id,revision_id) REFERENCES app.reconciliation_revisions(tenant_id,station_id,id),
 FOREIGN KEY(tenant_id,station_id,expense_id,expense_version_id) REFERENCES app.expense_versions(tenant_id,station_id,expense_id,id)
);
CREATE TRIGGER reconciliation_expense_version_source_immutable BEFORE UPDATE OR DELETE ON app.reconciliation_expense_version_sources FOR EACH ROW EXECUTE FUNCTION app.unified_expense_immutable();
--> statement-breakpoint
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['expense_versions','expense_recognition_version_sources','reconciliation_expense_version_sources'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',relation_name);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',relation_name);
 EXECUTE format('CREATE POLICY unified_expense_context ON app.%I USING(tenant_id=app.current_tenant_id() AND app.has_active_membership() AND station_id=nullif(current_setting(''app.station_id'',true),'''')::uuid)',relation_name);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime')THEN EXECUTE format('REVOKE ALL ON app.%I FROM app_runtime',relation_name);EXECUTE format('GRANT SELECT ON app.%I TO app_runtime',relation_name);END IF;
 END LOOP;
END $$;
