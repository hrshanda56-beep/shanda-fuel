# Customer Credit 0025 production preflight

This is a review checklist for migration `0025_customer_credit_station_scope.sql`.
It is documentation only. Do not run these checks or the migration against
production from a development task.

## Scope and change inventory

Before scheduling, record counts from the target database for:

- `app.customers`, including rows with `legal_entity_id IS NULL`;
- `app.customer_accounts`, including rows with `legal_entity_id IS NULL`, the
  existing `station_scope` distribution, and account status distribution;
- `app.customer_ledger_entries`, including rows with a null receiving station;
- `app.customer_fuel_authorizations`, including active authorizations; and
- active stations grouped by tenant and legal entity.

The new `app.customer_account_stations` table should have no pre-existing rows.
Record the expected post-migration count of zero. Do not populate it by
inference during the migration. Existing accounts must remain
`station_scope_configured = false` until an owner/administrator confirms legal
entity and scope through the application.

## Pre-migration checks

- Confirm the migration journal is complete through `0024` and that `0025` has
  not been applied.
- Confirm the expected columns, table, constraints, index, RLS policy, and
  grants do not already exist under another name.
- Confirm every tenant, legal entity, station, membership, and existing
  customer/account relationship passes the intended tenant-aware parent
  constraints.
- Confirm the composite parent keys required by the new foreign keys are
  present and unique.
- Confirm there are no active customer accounts whose authoritative legal
  entity would need to be inferred from station, payment, fuel, or history.
- Confirm backup/restore evidence, rollback ownership, migration owner role,
  application compatibility, and a maintenance window with no new customer
  financial commands admitted during the change.

## Lock and scan review

The `ALTER TABLE` statements on `app.customers`, `app.customer_accounts`, and
`app.customer_ledger_entries` require `ACCESS EXCLUSIVE` locks while each
schema change is applied. The new foreign keys and their supporting
uniqueness requirements must be checked against existing data; PostgreSQL may
scan the referenced and referencing tables. Treat these scans as
size-dependent work, even though the added columns are metadata-only for
existing rows. Creating the new table and its index is separate work, but can
still contend with concurrent access during catalog changes.

Use the recorded row counts and an equivalent-size staging copy to measure
lock wait and FK validation time. Require an approved migration window sized
for the slowest scan plus rollback/verification time. Do not use a production
lock timeout or cancellation as a substitute for scheduling.

## Post-migration verification

- Confirm the migration journal records `0025` exactly once.
- Confirm the new columns, default/check constraints, composite foreign keys,
  station table, unique/index definitions, and receiving-station foreign key.
- Confirm `customer_account_stations` has RLS enabled and forced, its tenant
  policy is present, and runtime/diagnostics grants match the contract.
- Confirm all pre-existing accounts have `station_scope_configured = false`;
  no legal entity or scope was inferred, and historical rows/statements remain
  readable under their existing permissions.
- Re-run the recorded counts and compare only expected schema/default effects.
- Exercise tenant isolation, legal-entity isolation, ALL and SELECTED scope,
  mixed-list atomic rejection, suspended-customer guards, and wrong-station
  authorization lifecycle checks in a non-production smoke environment.
- Monitor lock waits, constraint errors, authorization denials, and audit
  events before reopening new customer financial activity.
