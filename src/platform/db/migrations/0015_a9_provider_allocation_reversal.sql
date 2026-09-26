-- The deferred allocation guard sees the row being inserted. Exclude that
-- row from the duplicate-reversal check while retaining the prior-reversal
-- check for every other row linked to the same original allocation.
CREATE OR REPLACE FUNCTION app.a9_provider_allocation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE payment_amount numeric(20,4);
DECLARE payment_method text;
DECLARE reconciliation_state text;
DECLARE payment_station uuid;
DECLARE settlement_station uuid;
DECLARE settlement_state text;
DECLARE settlement_gross numeric(20,4);
DECLARE allocated_to_payment numeric(20,4);
DECLARE allocated_to_settlement numeric(20,4);
DECLARE prior_reversal uuid;
DECLARE original_settlement uuid;
DECLARE original_payment uuid;
DECLARE original_station uuid;
DECLARE original_state text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'provider settlement allocations are append-only; use a named reversal';
  END IF;
  SELECT p.amount, p.method, p.station_id, r.state
    INTO payment_amount, payment_method, payment_station, reconciliation_state
    FROM app.reconciliation_payments p
    JOIN app.reconciliations r
      ON r.tenant_id = p.tenant_id AND r.station_id = p.station_id AND r.id = p.reconciliation_id
   WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.reconciliation_payment_id
   FOR UPDATE OF p, r;
  IF payment_amount IS NULL THEN RAISE EXCEPTION 'A5 payment evidence does not exist'; END IF;
  IF payment_station IS DISTINCT FROM NEW.station_id THEN RAISE EXCEPTION 'A5 payment evidence station mismatch'; END IF;
  IF NEW.state = 'POSTED' THEN
    IF payment_method NOT IN ('POS','ECOCASH') THEN RAISE EXCEPTION 'cash or non-provider A5 evidence cannot be allocated to a provider settlement'; END IF;
    IF reconciliation_state NOT IN ('APPROVED','POSTED','LOCKED') THEN RAISE EXCEPTION 'A5 payment evidence is not eligible for provider settlement matching'; END IF;
    SELECT s.station_id, s.state, s.gross_amount
      INTO settlement_station, settlement_state, settlement_gross
      FROM app.provider_settlements s
     WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.settlement_id
     FOR UPDATE;
    IF settlement_station IS NULL THEN RAISE EXCEPTION 'Provider settlement does not exist'; END IF;
    IF settlement_station IS DISTINCT FROM NEW.station_id THEN RAISE EXCEPTION 'Provider settlement station mismatch'; END IF;
    IF settlement_state IN ('RECONCILED') THEN RAISE EXCEPTION 'A reconciled provider settlement is finalized'; END IF;
    SELECT COALESCE(sum(active.amount), 0) INTO allocated_to_payment
      FROM app.provider_settlement_allocations active
     WHERE active.tenant_id = NEW.tenant_id
       AND active.reconciliation_payment_id = NEW.reconciliation_payment_id
       AND active.state = 'POSTED'
       AND NOT EXISTS (
         SELECT 1 FROM app.provider_settlement_allocations reversal
          WHERE reversal.tenant_id = active.tenant_id
            AND reversal.reversal_of_id = active.id
            AND reversal.state = 'REVERSED'
       );
    SELECT COALESCE(sum(active.amount), 0) INTO allocated_to_settlement
      FROM app.provider_settlement_allocations active
     WHERE active.tenant_id = NEW.tenant_id
       AND active.settlement_id = NEW.settlement_id
       AND active.state = 'POSTED'
       AND NOT EXISTS (
         SELECT 1 FROM app.provider_settlement_allocations reversal
          WHERE reversal.tenant_id = active.tenant_id
            AND reversal.reversal_of_id = active.id
            AND reversal.state = 'REVERSED'
       );
    IF allocated_to_payment > payment_amount THEN RAISE EXCEPTION 'provider allocations exceed A5 payment evidence'; END IF;
    IF allocated_to_settlement > settlement_gross THEN RAISE EXCEPTION 'provider allocations exceed settlement gross amount'; END IF;
  ELSE
    SELECT amount, state, reversal_of_id, settlement_id, reconciliation_payment_id, station_id
      INTO payment_amount, original_state, prior_reversal, original_settlement, original_payment, original_station
      FROM app.provider_settlement_allocations
     WHERE tenant_id = NEW.tenant_id AND id = NEW.reversal_of_id
     FOR UPDATE;
    IF payment_amount IS NULL OR original_state <> 'POSTED' THEN RAISE EXCEPTION 'Only a posted allocation can be reversed'; END IF;
    IF original_settlement IS DISTINCT FROM NEW.settlement_id
       OR original_payment IS DISTINCT FROM NEW.reconciliation_payment_id
       OR original_station IS DISTINCT FROM NEW.station_id THEN
      RAISE EXCEPTION 'Allocation reversal must retain the original settlement, payment, and station';
    END IF;
    IF NEW.amount IS DISTINCT FROM payment_amount THEN RAISE EXCEPTION 'Allocation reversal amount must equal the original'; END IF;
    IF prior_reversal IS NOT NULL THEN RAISE EXCEPTION 'An allocation reversal cannot itself be reversed'; END IF;
    IF EXISTS (
      SELECT 1
        FROM app.provider_settlement_allocations
       WHERE tenant_id = NEW.tenant_id
         AND id <> NEW.id
         AND reversal_of_id = NEW.reversal_of_id
         AND state = 'REVERSED'
    ) THEN
      RAISE EXCEPTION 'The provider settlement allocation is already reversed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
