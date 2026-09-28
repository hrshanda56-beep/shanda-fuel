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

Current merged base: `6b85ae5` (`main`, current canonical integration tip;
2026-09-28).

First-parent merged work includes A4 inventory (`afed2eb`), A5 daily
reconciliation (`bca2ea0`), A6 cash/banking (`fba3cfb`), A7 supplier creditors
(`e2e2d81`), A8 customer accounts (`e457098`), A9 provider settlements
(`555f4a5`) plus provider allocation reversal (`46d71a4`, migration 0015),
A10 management reporting (`84c77e2` plus A10.1/A10.2), A11 daily operations
(`79321d8`, PR #17), REV1 revenue, A12 costing/revaluation slices, the release
hardening merge (`5bf7c5c`, PR #32), and Security Wave 1 step-up/MFA
establishment (`244ad14`, PR #33). Security Wave 1 uses Better Auth password
reauthentication plus TOTP, tenant-bound session state, and short-lived expiry.
Supervisors can enroll an authenticator through the authenticated setup flow;
password-only step-up is rejected. This paragraph records merged behavior; it
does not change the authentication or MFA contract.

The repository contains PostgreSQL integration and Playwright tests for the
implemented slices. PostgreSQL tests require `DATABASE_URL`; CI supplies an
ephemeral PostgreSQL 16 service. Browser tests intentionally skip only their
authorized persistence cases when the database/auth environment is absent.
The current RC still requires the authenticated staging gate, a restore drill,
and performance evidence before pilot or production sign-off; those are
operational execution gates, not missing implementation claims.

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
`0001_a1_auth_identity.sql`, `0002_a1_tenant_authorization_security.sql`,
`0016_security_step_up_tenant_binding.sql`, and
`0017_security_totp_mfa.sql`; `tests/integration/a1-isolation.test.ts`,
`tests/integration/security-step-up.test.ts`; `docs/database-security.md`.

Tenant hierarchy, authenticated actor resolution, authorization, fail-closed
tenant context, RLS, runtime-role separation, append-only security events,
tenant-isolation tests, and the production step-up establishment route are
integrated. Migration `0016_security_step_up_tenant_binding.sql` binds
successful step-up state to the active tenant; `assertStepUp` enforces that
binding centrally and expired assurance is invalidated at session resolution.

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
and the full interrupted/partial delivery workflow are not present. WAC and
late-cost revaluation are implemented in the A12 costing workstreams below.

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

Evidence: `src/modules/settlements/`; migrations
`0009_provider_settlements.sql` and `0015_a9_provider_allocation_reversal.sql`; routes under
`src/app/api/settlements/`; `tests/integration/a9-provider-settlements.test.ts`;
`docs/architecture/a9-provider-settlements.md`.

Provider/account setup, settlement recording/import, exact-decimal allocation,
unmatched evidence, named allocation reversal, variance states, reconciliation,
idempotency, audit, RLS, and the minimal finance workspace are integrated.
There is no separate provider-batch aggregate; any such requirement requires
scope clarification.

### A10 — Management reporting — PARTIAL

Evidence: `src/modules/reporting/` and `src/modules/profitability/`; routes
`src/app/api/reports/management/` and `src/app/api/reports/daily/`;
`src/app/reports/page.tsx`; `tests/integration/a10-management-reporting.test.ts`;
`tests/e2e/management-reporting.spec.ts`;
`docs/architecture/a10-management-reporting.md`.

Tenant-safe management and daily read models combine finalized A4–A9 facts,
return source IDs, preserve metric-specific date bases, and expose an initial
responsive dashboard. A10.2 now consumes REV1 revenue and A12 restated COGS for
ordinary-fuel gross margin, including explicit unavailable states. Report
artifacts, export generation, full timestamp-based `as_of`, Action Center
behavior, Explain This Number, operating-expense recognition, and broader
profitability remain incomplete.

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

### A12.2 — Inventory costing schema and WAC foundation — PARTIAL

Evidence: `src/platform/db/schema/a12.ts`; migration
`0011_a12_inventory_costing_wac.sql`; `src/modules/costing/domain.ts`; unit
tests in `src/modules/costing/domain.test.ts`; PostgreSQL coverage in
`tests/integration/a12-costing.test.ts`.

The four costing authorities, tenant/station RLS, append-only guards, explicit
revaluation workflow metadata, deterministic chronological replay, exact
decimal WAC arithmetic, UNVALUED semantics, sale attribution basis, and replay
fingerprints are present. A12.2 does not implement the later valuation and
revaluation commands; those are delivered by A12.3 and A12.4.

### A12.3 — Opening, receipt, and canonical sale costing — COMPLETE

Evidence: migration `0012_a12_cost_projection_writer`; costing persistence in
`src/modules/costing/persistence.ts`; inventory commands in
`src/modules/inventory/commands.ts`; atomic A5 approval integration in
`src/modules/forecourt/production-reconciliation.ts`; focused unit and
PostgreSQL coverage in `src/modules/costing/domain.test.ts` and
`tests/integration/a12-costing.test.ts`.

Opening and explicit per-allocation receipt valuation append authoritative cost
events and persist deterministic WAC projection state through a narrow
security-definer writer. Approved canonical meter-segment sales append exactly
one negative `SALE_COGS` event and one immutable pre-sale-WAC attribution in the
same transaction as the A5 sale movement and approval. Mixed currencies,
insufficient stock, unvalued sales, and ordinary late historical cost commands
are rejected. A12.4 provides the separate approved late-cost revaluation
workflow. No FX, adjustment/transfer costing, or A10 profitability changes are
included.

### REV1 — Canonical ordinary fuel-sale revenue — PARTIAL

Evidence: `src/modules/revenue/`; migration
`0014_rev1_sale_revenue.sql`; atomic posting integration in
`src/modules/forecourt/production-reconciliation.ts`; ADR-014 and
`docs/architecture/revenue.md`.

Wave 1 establishes one immutable, tenant-aware revenue movement per positive
unsuperseded A3 meter segment. The amount is exact-decimal segment litres times
segment selling price, and posting is atomic with the A4 SALE and A12
SALE_COGS/attribution. A5 `accounted_sales`, A5 reading `sales_value`, A10
reporting integration beyond A10.2, historical backfill, corrections,
reversals, refunds, discounts, tax, non-fuel, internal/benefit, and FX revenue
remain outside this wave.

### A12.4 — Late-cost historical revaluation — COMPLETE

Evidence: migration `0013_a12_late_cost_revaluation.sql`; costing persistence
and inventory commands in `src/modules/costing/`; PostgreSQL coverage in
`tests/integration/a12-costing.test.ts`; and A5 production-bridge coverage in
`tests/integration/a5-production-reconciliation.test.ts`.

The request → approve → post workflow recognizes an authoritative late opening
or receipt movement, appends its ordinary cost event and deterministic
`COGS_REVALUATION` line/event evidence, replays the affected stream, and
preserves A4 movements, original `SALE_COGS`, and original sale attributions.
Production `ConfirmDelivery` and the applicable opening-balance path can leave a
historical late source explicitly `UNVALUED`; A5 approval remains atomic and
blocked until revaluation succeeds, after which later sales use the corrected
WAC. Whole-history revaluation is the only supported v1 posting semantics.
Bounded restatement is intentionally deferred from v1 by the A12.5 closure;
that is a product/accounting scope decision, not an implementation defect.
The nullable `restatementFromAt` / `restatementThroughAt` fields remain
reserved metadata for migration compatibility, and non-null public request
values remain rejected without creating an envelope. The A5 production bridge
is covered by focused PostgreSQL integration evidence.

### A12.5 — Bounded-restatement closure — COMPLETE

Evidence: `docs/decisions/ADR-013-a12-late-cost-revaluation.md`;
`docs/spec/REQUIREMENTS_TRACEABILITY.md`; and the bounds-rejection coverage in
`tests/integration/a12-costing.test.ts`.

A12.5 confirms that v1 uses complete causally affected historical-stream
revaluation through the current projection. No bounded accounting, boundary
carry entries, A4/A5 changes, costing-calculation changes, or persistence
behavior changes are included. Reporting period filtering and future `as_of`
reporting remain separate reporting concerns.

## Roadmap phase reconciliation

| Phase | Status | Reconciled scope |
| --- | --- | --- |
| Phase 0 — Repository and engineering foundation | **COMPLETE** | Toolchain, CI/test harness, Drizzle/PostgreSQL workflow, environment validation, and modular monolith foundation. |
| Phase 1 — Tenancy, identity, authorization, and security | **COMPLETE** | Tenant hierarchy, identity, authorization, RLS, runtime roles, security events, and isolation proof. |
| Phase 2 — Core forecourt vertical slice | **COMPLETE** | Business day → shift → meters → declarations → reconciliation → approval/post/lock, with representative mobile workflow. |
| Phase 3 — Inventory, tanks, deliveries, and costing | **PARTIAL** | Tank/dip/delivery/movement/adjustment foundation is implemented; A12.3 and A12.4 provide opening/receipt valuation, canonical sale COGS, persisted WAC projections, and late-cost revaluation; inventory pools, transfers, calibration execution, and full delivery interruption flow remain. |
| Phase 3 — WAC and late-cost revaluation | **COMPLETE** | A12.3 provides opening/receipt valuation and canonical pre-sale-WAC COGS; A12.4 provides append-only whole-history revaluation and the production A5 bridge; A12.5 closes bounded posting as intentionally deferred from v1 by design. |
| Phase 4 — Cash, banking, and electronic settlements | **PARTIAL** | Collections, deposits, manual bank confirmation, and A9 provider settlement reconciliation are implemented; cash counts, handovers, disputes, and any separate provider-batch scope remain. |
| Phase 5 — Suppliers, customers, and expenses | **PARTIAL** | Supplier creditors are complete; the implemented customer subset is complete; customer invoices/benefits/policy items and expenses/recurring costs remain. |
| Phase 5 — Customer commercial policy | **REQUIRES_CLIENT_DECISION** | Credit limits, approval thresholds, billing cadence, tax invoice treatment, prepaid funding/conversion, benefit policy, and vehicle/driver rules are not invented by the repository. |
| Phase 6 — Profitability, reporting, and owner dashboard | **PARTIAL** | A10.2 now provides canonical ordinary-fuel revenue and gross-margin reporting from REV1/A12 authorities; exports/artifacts, full as-of, Action Center, and Explain This Number remain incomplete. |
| Phase 6 — Profitability and gross margin | **PARTIAL** | Canonical REV1 revenue and A12 restated COGS are consumed by the A10 profitability read model with latest-finalized-revision, business-date, tenant, and station safeguards; operating expenses, fixed-cost recognition, and broader profitability remain incomplete. |
| Phase 7 — Production hardening | **PARTIAL** | Security/RLS foundations, representative accessibility/weak-network behavior, release notes, operational procedures, health/readiness checks, staging smoke tooling, and Lane 4 database PITR/integrity/security plus isolated app-to-restored-DB evidence exist. Recovery-aware R2 code and a dedicated drill are implemented, but separate locked recovery-bucket configuration, retention approval, and witnessed deleted-object recovery remain open; production-grade monitoring integration, offline sync, and full incident/tenant-recovery exercises also remain. |
| Phase 8 — Pilot and cutover | **PARTIAL** | Onboarding workbook and per-tank opening balance support exist; approved cross-domain opening batch, training, shadow operation, UAT, discrepancy classification, and pilot exit evidence remain. |
| Phase 8 — Client/accounting/signed-scope inputs | **REQUIRES_CLIENT_DECISION** | Real station master data, opening positions, accounting/tax policy, external identifiers, and signed SOW/contract scope are outside repository-only determination. |

## Explicit non-goals and limitations

The Blueprint and architecture documents explicitly exclude or defer a full
general ledger/statutory suite, tax engine before accountant confirmation,
direct bank/provider APIs, unrestricted offline financial posting, OCR/AI
posting, microservices/event-bus/warehouse infrastructure, and several A11
capabilities. These are not implementation defects unless the signed scope
later requires them.
