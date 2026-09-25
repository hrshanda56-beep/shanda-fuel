# Implementation status

This document reconciles the original Phase 0–8 roadmap with the code,
canonical migrations, tests, and architecture present on the integration base.
It is an implementation-status record, not a replacement for the Blueprint,
Wireframes, contracts, or workstream ownership rules.

Status vocabulary:

- **COMPLETE** — the scoped capability is implemented in the merged repository
  and has concrete repository evidence.
- **PARTIAL** — a meaningful subset is implemented, but the roadmap capability
  is broader than the merged slice.
- **OPEN** — the repository does not yet implement the capability.
- **REQUIRES_CLIENT_DECISION** — implementation is intentionally blocked by an
  unresolved client, accounting, legal, or signed-scope decision.

## Integration base

Current merged base: `79321d895d45835058702439ced0191b4e205d15` (`main`).

First-parent merged work includes A4 inventory (`afed2eb`), A5 daily
reconciliation (`bca2ea0`), A6 cash/banking (`fba3cfb`), A7 supplier creditors
(`e2e2d81`), A8 customer accounts (`e457098`), A9 provider settlements
(`555f4a5`), A10 management reporting (`84c77e2`), and A11 daily operations
(`79321d8`, PR #17).

The repository contains PostgreSQL integration and Playwright tests for the
implemented slices. A fresh test run is environment-dependent: PostgreSQL
tests require `DATABASE_URL`, and the current workspace did not have a usable
package-manager install path during this audit.

## Merged workstreams

### A0 — Integration foundation — COMPLETE

Evidence: `package.json`; `src/platform/db/`; migration
`src/platform/db/migrations/0000_platform_namespaces.sql`;
`tests/integration/db.smoke.test.ts`; `docs/architecture/database.md`.

The toolchain, modular-monolith structure, Drizzle/PostgreSQL boundary,
environment validation, migration journal, and test harness are present.

### A1 — Platform security — COMPLETE

Evidence: `src/modules/identity/`, `src/modules/tenancy/`,
`src/modules/authorization/`, `src/platform/auth/`,
`src/platform/db/tenant-context.ts`; migrations
`0001_a1_auth_identity.sql` and `0002_a1_tenant_authorization_security.sql`;
`tests/integration/a1-isolation.test.ts`; `docs/database-security.md`.

Tenant hierarchy, authenticated actor resolution, authorization, fail-closed
tenant context, RLS, runtime-role separation, append-only security events, and
tenant-isolation tests are integrated.

### A2 — UI foundation — COMPLETE

Evidence: `src/design-system/`; `src/app/page.tsx`;
`tests/e2e/accessibility.spec.ts`; `tests/e2e/smoke.spec.ts`.

Responsive shell, semantic primitives, permission-aware navigation projection,
truthful state components, focus behavior, and representative accessibility
coverage are integrated. A2 remains presentation-only.

### A3 — Forecourt and reconciliation — COMPLETE

Evidence: `src/modules/forecourt/`; migrations
`0003_a3_forecourt_reconciliation.sql` and
`0005_daily_reconciliation.sql`; integration tests
`a3-forecourt.test.ts`, `a3-business-day-lifecycle.test.ts`,
`a3-segmented-shifts.test.ts`, and `a5-production-reconciliation.test.ts`;
E2E tests `production-reconciliation.spec.ts` and
`daily-reconciliation.spec.ts`; ADR-003 through ADR-006.

Business days, shifts, meter installations and segments, effective pricing,
payment declarations, immutable reconciliation revisions, return/approval/
posting/locking, server-derived exact-decimal totals, audit/idempotency/outbox,
and the production reconciliation workflow are integrated.

### A4 — Inventory and deliveries — PARTIAL

Evidence: `src/modules/inventory/`; migration
`0004_a4_inventory.sql`; `tests/integration/a4-inventory.test.ts`.

Tanks, direct-litre dips, calibration-point storage, delivery records and
allocations, append-only inventory movements, opening balances, stock
projections, negative-stock prevention, and controlled adjustments are present.
Inventory pools, a transfer command/workflow, calibration execution/interpolation,
full interrupted/partial delivery workflow, WAC, and late-cost revaluation are
not present.

### A6 — Cash and banking — PARTIAL

Evidence: `src/modules/cash/`; migration `0006_cash_banking.sql`;
`tests/integration/a6-cash-banking.test.ts`.

Collections, partial collection allocation, deposits, deposit allocation,
manual bank confirmation, exact-decimal capacity checks, idempotency, audit,
and tenant/permission checks are implemented. Cash count, handover, dispute,
and complete custody state-machine commands remain incomplete.

### A7 — Supplier creditors — COMPLETE

Evidence: `src/modules/creditors/`; migration `0007_supplier_creditors.sql`;
`src/app/api/suppliers/`; `tests/integration/a7-supplier-creditors.test.ts`.

Supplier master records, invoices/credit notes, creditor movements, supplier
payments, bounded allocations, reversals, derived summaries/statements, exact
arithmetic, idempotency, audit, and tenant-safe persistence are integrated.

### A8 — Customer accounts — PARTIAL

Evidence: `src/modules/customers/`; migration
`0008_customer_accounts.sql`; `tests/integration/a8-customer-accounts.test.ts`;
`docs/architecture/a8-customer-accounts-proposal.md`.

Customer identity, credit accounts, prepaid value/litres, product-specific
balances, authorizations/reservations, fuel usage, payments/top-ups, append-only
ledger behavior, statements, and A5 evidence linkage are implemented. Customer
invoices, benefits, vehicle/driver controls, and several commercial policies
remain unresolved.

### A9 — Provider settlement reconciliation — COMPLETE

Evidence: `src/modules/settlements/`; migration
`0009_provider_settlements.sql`; routes under
`src/app/api/settlements/`; `tests/integration/a9-provider-settlements.test.ts`;
`docs/architecture/a9-provider-settlements.md`.

Provider/account setup, settlement recording/import, exact-decimal allocation,
unmatched evidence, named allocation reversal, variance states, reconciliation,
idempotency, audit, RLS, and the minimal finance workspace are integrated.
There is no separate provider-batch aggregate; any such requirement requires
scope clarification.

### A10 — Management reporting — PARTIAL

Evidence: `src/modules/reporting/`; routes
`src/app/api/reports/management/` and `src/app/api/reports/daily/`;
`src/app/reports/page.tsx`; `tests/integration/a10-management-reporting.test.ts`;
`tests/e2e/management-reporting.spec.ts`;
`docs/architecture/a10-management-reporting.md`.

Tenant-safe management and daily read models combine finalized A4–A9 facts,
return source IDs, preserve metric-specific date bases, and expose an initial
responsive dashboard. Gross margin, canonical COGS, report artifacts, export
generation, full timestamp-based `as_of`, Action Center behavior, and Explain
This Number are not complete.

### A11 — Daily operations workspace — COMPLETE

Evidence: `src/app/operations/`; `src/modules/forecourt/ui/daily-operations-workspace.tsx`;
`tests/integration/a11-daily-operations.test.ts`;
`tests/e2e/a11-daily-operations.spec.ts` and
`tests/e2e/production-reconciliation.spec.ts`;
`docs/architecture/a11-daily-operations-workspace.md`.

The mobile-first station/day/shift composition, server-backed draft
continuation, evidence entry, exact server-owned calculations, submit/return/
approve/lock flow, and downstream status links are integrated. A11 does not
implement costing, its own reporting engine, GL, tax, bank/provider APIs, or
full offline synchronization; it links to the existing A10 reporting surface.

## Roadmap phase reconciliation

| Phase | Status | Reconciled scope |
| --- | --- | --- |
| Phase 0 — Repository and engineering foundation | **COMPLETE** | Toolchain, CI/test harness, Drizzle/PostgreSQL workflow, environment validation, and modular monolith foundation. |
| Phase 1 — Tenancy, identity, authorization, and security | **COMPLETE** | Tenant hierarchy, identity, authorization, RLS, runtime roles, security events, and isolation proof. |
| Phase 2 — Core forecourt vertical slice | **COMPLETE** | Business day → shift → meters → declarations → reconciliation → approval/post/lock, with representative mobile workflow. |
| Phase 3 — Inventory, tanks, deliveries, and costing | **PARTIAL** | Tank/dip/delivery/movement/adjustment foundation is implemented; inventory pools, transfers, calibration execution, full delivery interruption flow, WAC, and revaluation remain. |
| Phase 3 — WAC and late-cost revaluation | **OPEN** | No chronological WAC/COGS/revaluation implementation exists. |
| Phase 4 — Cash, banking, and electronic settlements | **PARTIAL** | Collections, deposits, manual bank confirmation, and A9 provider settlement reconciliation are implemented; cash counts, handovers, disputes, and any separate provider-batch scope remain. |
| Phase 5 — Suppliers, customers, and expenses | **PARTIAL** | Supplier creditors are complete; the implemented customer subset is complete; customer invoices/benefits/policy items and expenses/recurring costs remain. |
| Phase 5 — Customer commercial policy | **REQUIRES_CLIENT_DECISION** | Credit limits, approval thresholds, billing cadence, tax invoice treatment, prepaid funding/conversion, benefit policy, and vehicle/driver rules are not invented by the repository. |
| Phase 6 — Profitability, reporting, and owner dashboard | **PARTIAL** | A10 management/daily reporting is present, but profitability/COGS/gross margin, exports/artifacts, full as-of, Action Center, and Explain This Number are incomplete. |
| Phase 6 — Profitability and gross margin | **OPEN** | Requires WAC/revaluation and posted sale-recognition/COGS foundations. |
| Phase 7 — Production hardening | **PARTIAL** | Security/RLS foundations and representative accessibility/weak-network behavior exist; full cross-module review, performance, offline sync, observability, backup/restore, and incident readiness remain. |
| Phase 8 — Pilot and cutover | **PARTIAL** | Onboarding workbook and per-tank opening balance support exist; approved cross-domain opening batch, training, shadow operation, UAT, discrepancy classification, and pilot exit evidence remain. |
| Phase 8 — Client/accounting/signed-scope inputs | **REQUIRES_CLIENT_DECISION** | Real station master data, opening positions, accounting/tax policy, external identifiers, and signed SOW/contract scope are outside repository-only determination. |

## Explicit non-goals and limitations

The Blueprint and architecture documents explicitly exclude or defer a full
general ledger/statutory suite, tax engine before accountant confirmation,
direct bank/provider APIs, unrestricted offline financial posting, OCR/AI
posting, microservices/event-bus/warehouse infrastructure, and several A11
capabilities. These are not implementation defects unless the signed scope
later requires them.
