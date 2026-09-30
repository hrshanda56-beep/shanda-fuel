# ADR-016: Security production gates and durable request limiting

## Status

Accepted for the repository-side security hardening branch. Provider execution
and GitHub security-product availability remain separate operational gates.

## Context

The Security P0 baseline is already verified. Its remaining follow-up was the
historical `app_runtime` privilege model and a durable rate limiter suitable for
the Node runtime deployed behind Vercel and backed by Neon PostgreSQL. The
repository must not add a paid service or claim provider configuration that has
not been witnessed.

## Decision

- Migration `0020_security_runtime_least_privilege_rate_limit` is forward-only.
  It removes app-runtime `DELETE` from every `app` table, then retains it only
  on the seven draft reconciliation detail tables used by the current
  replacement flow. It removes `TRUNCATE`, `TRIGGER`, and `REFERENCES` from
  `app` and `auth` tables. It does not revoke Better Auth's required auth-table
  DML or the existing explicit per-table application grants.
- Rate limiting is stored durably in PostgreSQL in
  `platform.rate_limit_windows`. The runtime receives only `EXECUTE` on the
  fixed-signature `platform.consume_rate_limit` security-definer function; it
  has no direct table access. The function uses an atomic fixed-window upsert,
  validates its bounds, hashes client buckets before storage, and returns
  bounded retry metadata.
- Auth POSTs and command POSTs are protected in staging/production. Local and
  test environments do not pretend to have a deployed edge or durable provider
  topology.
- The deployment edge must normalize a trusted client-address header before
  Node receives the request. This is a provider prerequisite, not repository
  evidence.

## Consequences

The application retains the historical table-level `SELECT`/`INSERT`/`UPDATE`
rights required by current modules, the seven-table draft reconciliation delete
capability, and auth retains the DML required by Better Auth. This is a measured
reduction, not a full least-privilege claim. A future privilege review can
replace remaining broad grants with a generated usage map after representative
runtime-role workflow proof.

Rate-limit rows are operational security state, not business or financial
truth. The current function bounds stale-row cleanup per active key; an
operator-owned cleanup job may later remove all expired rows under a separate
reviewed capability.

## Recovery and rollback implications

The migration has no down-migration. If the release is incompatible, revert the
application deployment only when the database remains compatible. A database
incident uses the backup/restore and incident runbooks; do not restore or edit
the rate-limit table as a substitute for domain correction. A restored database
must retain migration `0020` and the function/table privilege proof before
traffic is returned.
