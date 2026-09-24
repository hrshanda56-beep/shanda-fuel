# A10 management reporting

## Purpose

A10 provides rebuildable management views over the canonical A4–A9 source domains. It is a read model: it does not create a second transaction table, mutate source ledgers, or change source ownership.

The implementation exposes:

- `GET /api/reports/management` for a posted management overview.
- `GET /api/reports/daily` for daily operations rows.
- `/reports` for the minimal responsive management dashboard.

All routes require an authenticated actor, a valid tenant membership, `report.view`, and an authorized tenant or station scope. An optional station selector is checked against the authenticated station scope before any report query runs.

## Source mapping and finalized facts

| Report area | Canonical source | Finalized/read rule |
| --- | --- | --- |
| Sales, litres, payment evidence, variance, expenses | A5 reconciliation revisions, meter readings, payments, expenses, cash declarations | Latest revision per reconciliation with state `APPROVED`, `POSTED`, or `LOCKED` |
| Cash collected and banked | A6 cash collections, collection allocations, bank deposits and deposit allocations | Collections use non-reversed collections; banked uses confirmed deposit allocations on deposits whose `deposited_at` UTC calendar date is in range |
| Provider exposure | A9 provider settlements and settlement allocations, A5 POS/ECOCASH payments | A5 evidence uses finalized reconciliations; allocations use active `POSTED` allocations; settlement totals use settlement date |
| Supplier exposure | A7 supplier account movements | Balance as of `toDate` using movements with `effective_date <= toDate`; movement signs remain A7-owned |
| Customer exposure | A8 customer ledger and authorizations | Balance as of `toDate`; ledger uses `business_date <= toDate`, reservations use active `AUTHORIZED`/`PARTIALLY_USED` authorizations requested before the end of `toDate` |
| Stock and variance | A4 inventory movements, tanks, dips, deliveries | Movement business date through `toDate`; latest dip measured before the end of `toDate`; confirmed deliveries in the selected range |

The selected latest revision prevents an approved correction and its superseded revision from being counted twice. Each aggregate returns canonical reconciliation, payment, collection, deposit, settlement, supplier/customer, tank, movement, delivery, or expense IDs where the source supports them.

## Date basis

The API includes a `dateBasis` object so a range is not presented as if every source shared one date field:

- sales, A5 cash evidence, provider evidence, and A5 expenses: A5 `business_date`.
- collections: A6 `cash_collections.business_date`.
- banked cash: A6 `bank_deposits.deposited_at` interpreted as a UTC calendar date; the deposit state must be `CONFIRMED`. This is intentionally independent of the linked collection's business date.
- provider settlements: A9 `settlement_date`.
- suppliers: A7 movements with `effective_date <= toDate`, so the outstanding balance is a position as of `toDate`, not activity limited to `fromDate`–`toDate`.
- customers: A8 ledger `business_date <= toDate` and authorization `requested_at` before the end of `toDate`; balances are positions as of `toDate`, not period flows.
- inventory: A4 `business_date` for movements and `measured_at` for the latest physical dip as of `toDate`.

Daily rows use a neutral `reportDate` key. Each metric is placed on that date using its own source-specific basis above; the row must not be read as a shared A5 business-date bucket. A provider settlement can therefore appear on its settlement date even when its A5 payment evidence belongs to an earlier business date, and a bank deposit can appear on its `deposited_at` UTC date even when its linked collection has another business date.

## Exact-decimal and security rules

PostgreSQL performs bounded numeric aggregation, and the application normalizes results through `ExactDecimal`/`decimal.js`. Money is serialized at scale 4, litres at scale 3, and realized unit prices at scale 6. No `Number()` or `parseFloat()` is used at an authoritative calculation boundary.

The reporting service resolves the tenant from the authenticated server context, validates optional station membership through the tenant transaction, authorizes the requested scope with `report.view`, and executes reads inside the trusted tenant transaction wrapper. PostgreSQL tenant RLS remains in force. Browser-provided tenant and station values are selectors only, never authority.

## Management position boundary

The dashboard is intentionally labeled a management/operational view. It does not claim to be a general ledger, trial balance, statutory P&L, balance sheet, cash-flow statement, tax report, or bank statement.

Gross margin is not exposed. This branch has A4 landed-cost evidence on deliveries and inventory movements, but it does not have a canonical posted sale-recognition movement plus chronological attributable COGS/revaluation calculation that would support a defensible sold-fuel cost basis. Revenue and cost evidence remain separate.

A8 customer ledger balances do not contain a station dimension. A tenant-wide report returns `availability: AVAILABLE` and balances as of `toDate`; a station-filtered report returns `availability: UNAVAILABLE_STATION_DIMENSION`, nullable customer totals, and no customer balance rows rather than leaking or inventing a station allocation. PREPAID_LITRES remains quantity evidence and is never converted to money.

## Migration and performance

A10 requires no schema migration `0010`. The service uses existing indexed source predicates and bounded aggregates. It does not add materialized views, a reporting warehouse, or summary transaction tables. Export and artifact persistence remain future work; the returned row shape is ready for CSV/XLSX serialization without changing calculations.
