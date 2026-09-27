# Tenant recovery runbook

## Status

**OPEN — an approved isolated-restore exercise is required before pilot sign-off.**

The intended boundary is tenant-scoped logical recovery: restore a copy or
isolated extract, validate the affected tenant and lineage, review the repair
with the responsible domain/accounting owner, and apply named application
correction/reversal commands where supported. Never restore over production or
disable RLS to repair one tenant.

## Procedure to complete with the database owner

1. Identify tenant, incident scope, last known-good timestamp, and affected
   source records without copying unrelated tenant data into the case.
2. Use [`backup-restore.md`](backup-restore.md) to create an isolated recovery
   target and record the backup/PITR evidence.
3. Validate tenant hierarchy, foreign-key/lineage relationships, audit and
   security events, idempotency state, and relevant projections under approved
   tenant context.
4. Produce a proposed repair or compensating command list. Obtain domain and
   accounting approval before execution; do not edit authoritative tables by
   hand.
5. Re-run tenant-isolation, reconciliation/reporting, audit, and duplicate-
   effect checks. Record what could not be repaired and the customer impact.
6. Quarantine or destroy the isolated copy under the approved retention policy.

Provider-specific extract tooling, projection rebuild ownership, and a tested
evidence bundle are still missing and remain post-RC operational work.
