# A9 provider settlement reconciliation

Status: merged and present in `main` at integration tip `244ad14`.
Canonical migration `0009_provider_settlements.sql` and the implementation are
part of the merged migration and module sequence. The repository contains the
PostgreSQL integration coverage and it has passed in the merged CI integration
suite; local re-execution requires `DATABASE_URL`.

## Boundary

A9 consumes approved, posted, or locked A5 `reconciliation_payments` whose
method is `POS` or `ECOCASH`. It does not consume `CASH`, `BANK_TRANSFER`,
customer credit, prepaid, staff/management fuel, or `OTHER_APPROVED` evidence.
Cash custody, collections, deposits, and bank allocations remain A6-owned.

Provider settlement evidence is separate from A5 sale/payment evidence. A
settlement stores provider/account identity, station, transaction date,
settlement date, currency, reported gross, optional reported fees/deductions,
optional reported net, source metadata, and a reconciliation state. No general
ledger treatment or automatic fee posting is introduced.

## Provider/account model

`payment_providers` is tenant-scoped and configurable for card acquirers, POS,
mobile-money, and other electronic providers. `provider_accounts` stores the
provider/merchant reference and currency. An account can be shared at tenant
scope or constrained to a legal entity/station; a settlement is always
station-scoped so allocation cannot silently cross station boundaries.

## Matching and correction

`provider_settlement_allocations` is normalized relational evidence. A
settlement can match many A5 payment rows, and one A5 row may be allocated over
multiple provider settlements, subject to exact-decimal capacity checks on both
sides. Allocation commands lock the A5 evidence first and the settlement
second. Duplicate commands use the existing idempotency table; import/source
keys and allocation keys are also unique within a tenant.

Allocations are append-only. Corrections use a named reversal allocation and
reopen the settlement as `EXCEPTION`; provider settlement facts themselves are
immutable. Explicit reconciliation marks an exact match `RECONCILED` and a
remaining variance `EXCEPTION`, requiring a reason for the latter.

## Read/API surface

- `POST /api/settlements/commands` for provider/account setup, settlement
  recording/import, allocation, reversal, and reconciliation commands.
- `GET /api/settlements/summary` for station-scoped settlement summaries.
- `GET /api/settlements/unmatched` for station-scoped unmatched A5 POS/ECOCASH
  evidence.
- `/stations/{stationId}/settlements?tenantId={tenantId}` for the minimal
  finance review, allocation, refresh, and reconcile surface.

All authoritative commands resolve tenant/station/actor context through the A1
server authority path, use signed audit events, and fail closed without a
trusted context.
