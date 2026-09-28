# Requirements traceability

This compact matrix reconciles the roadmap requirements with evidence present
on integration base `6b85ae5`. Statuses use
the vocabulary defined in `docs/implementation-status.md`.

| Requirement | Implementation | Migration | Test evidence | Status | Limitation / next decision |
| --- | --- | --- | --- | --- | --- |
| Tenant hierarchy, identity, authorization, RLS | `src/modules/identity/`, `tenancy/`, `authorization/`, `src/platform/db/tenant-context.ts` | `0001_a1_auth_identity.sql`, `0002_a1_tenant_authorization_security.sql`, `0016_security_step_up_tenant_binding.sql`, `0017_security_totp_mfa.sql` | `tests/integration/a1-isolation.test.ts`, `tests/integration/security-step-up.test.ts` | COMPLETE | Final deployed staging/release review still belongs to Phase 7; the merged step-up/MFA behavior is recorded here without changing its contract. |
| Forecourt day/shift/meter/pricing workflow | `src/modules/forecourt/` | `0003_a3_forecourt_reconciliation.sql` | `tests/integration/a3-forecourt.test.ts`, `a3-business-day-lifecycle.test.ts`, `a3-segmented-shifts.test.ts` | COMPLETE | A3 remains the source for meter-derived quantity and sales evidence. |
| Daily reconciliation evidence and approval workflow | `src/modules/forecourt/daily-reconciliation.ts`, `production-reconciliation.ts` | `0005_daily_reconciliation.sql` | `tests/integration/a5-production-reconciliation.test.ts`, `tests/e2e/production-reconciliation.spec.ts` | COMPLETE | A5 payment evidence is distinct from downstream cash/provider settlement. |
| Tank, dip, delivery, movement, adjustment foundation | `src/modules/inventory/` | `0004_a4_inventory.sql` | `tests/integration/a4-inventory.test.ts` | PARTIAL | No complete inventory-pool/transfer/calibration-execution/partial-delivery workflow. |
| WAC, COGS, late-cost revaluation (A12.4/A12.5) | `src/modules/costing/`, `src/modules/inventory/commands.ts` | `0011_a12_inventory_costing_wac.sql`, `0012_a12_cost_projection_writer.sql`, `0013_a12_late_cost_revaluation.sql` | `src/modules/costing/domain.test.ts`, `tests/integration/a12-costing.test.ts`, `tests/integration/a5-production-reconciliation.test.ts` | COMPLETE | Whole-history late-cost revaluation is the supported v1 posting contract. A12.5 intentionally defers bounded posting from v1 by design, not because of an implementation defect; nullable boundary metadata remains reserved, and non-null public values remain rejected. A10.2 consumes the resulting restated COGS for ordinary-fuel gross-margin reporting; broader profitability remains open. |
| Cash collections, deposits, bank confirmation | `src/modules/cash/`, `src/app/api/cash/` | `0006_cash_banking.sql` | `tests/integration/a6-cash-banking.test.ts` | COMPLETE | V1 uses manual bank confirmation; no direct bank API is required. |
| Cash counts, handovers, disputes | Cash schema/domain scaffolding only | `0006_cash_banking.sql` | No complete command/E2E evidence | PARTIAL | `src/modules/cash/commands.ts` exposes collection/deposit commands, not the full custody workflow. |
| Supplier creditors | `src/modules/creditors/`, `src/app/api/suppliers/` | `0007_supplier_creditors.sql` | `tests/integration/a7-supplier-creditors.test.ts` | COMPLETE | Tax/VAT and final commercial terms remain client/accounting inputs. |
| Customer credit/prepaid/authorization/payment subset | `src/modules/customers/`, `src/app/api/customers/` | `0008_customer_accounts.sql` | `tests/integration/a8-customer-accounts.test.ts` | COMPLETE | Customer invoices, benefits, vehicle/driver rules, and policy thresholds remain unresolved. |
| Expenses and recurring-cost recognition | `src/modules/expenses/index.ts` is a boundary placeholder | None | No expense-domain integration test | OPEN | A5 reconciliation expense evidence is not the expense ledger. |
| Provider settlement reconciliation | `src/modules/settlements/`, `src/app/api/settlements/` | `0009_provider_settlements.sql`, `0015_a9_provider_allocation_reversal.sql` | `tests/integration/a9-provider-settlements.test.ts` | COMPLETE | Named allocation reversal is append-only and excluded from active settlement totals; no separate provider-batch aggregate exists. Clarify only if contractually required. |
| Management reporting read model | `src/modules/reporting/`, `/api/reports/*`, `/reports` | None (`A10` intentionally adds no migration) | `tests/integration/a10-management-reporting.test.ts`, `tests/e2e/management-reporting.spec.ts` | PARTIAL | Management/operational view only; not GL, statutory P&L, or statutory net-profit reporting. A10.2 adds canonical ordinary-fuel revenue and gross margin. |
| Profitability, COGS, gross margin | `src/modules/profitability/`, A10 management read model | None | `src/modules/profitability/domain.test.ts`, `tests/integration/a10-management-reporting.test.ts` | PARTIAL | Canonical recognized revenue minus restated COGS is implemented; operating expenses, fixed-cost recognition, exports/artifacts, and broader profitability remain incomplete. |
| Canonical ordinary fuel-sale revenue | `src/modules/revenue/`, `app.sale_recognition_movements` | `0014_rev1_sale_revenue.sql` | Revenue domain/unit coverage plus A5/A4/A12 posting and rollback coverage; A10.2 reporting assertions | PARTIAL | REV1 wave 1 establishes immutable segment-level ordinary fuel revenue. Corrections, refunds, discounts, tax, non-fuel, internal/benefit, FX, and historical backfill remain explicitly out of scope. |
| Report lineage and date-basis metadata | A10 reporting contracts/queries return source IDs and `dateBasis` | None | A10 integration assertions cover IDs/date basis | PARTIAL | No persisted report run, artifact, checksum, or calculation-version record. |
| PDF/XLSX exports | No export implementation | None | No export E2E/integration test | OPEN | Export authorization and artifact lifecycle remain to be designed. |
| Full timestamp-based `as_of` behavior | Date-based A10 positions; customer/supplier/inventory queries have limited as-of inputs | None | No report-artifact as-of test | PARTIAL | Blueprint requires posted-time cutoff and prior-artifact stability. |
| Explain This Number and owner Action Center | Minimal `/reports` dashboard | None | Management reporting E2E covers filters/readability only | OPEN | Requires report drill-down, explanation lineage, and action projections. |
| A11 daily operations composition | `src/app/operations/`, `daily-operations-workspace.tsx` | None | `tests/integration/a11-daily-operations.test.ts`, `tests/e2e/a11-daily-operations.spec.ts` | COMPLETE | No full offline synchronization or conflict merging. |
| Phase 7 hardening | A1 security baseline, design-system/a11 states, health/readiness, staging smoke scripts, and release/operations documentation | Existing migrations only | Representative E2E/axe tests; repository CI gate | PARTIAL | Authenticated staging execution, performance evidence, restore-drill evidence, production monitoring integration, offline sync, and tenant-recovery exercise remain open. |
| Phase 8 onboarding/opening/cutover | `docs/onboarding/README.md`, setup workbook, A4 `RecordOpeningBalance` | Existing A4 migration only | Synthetic fixtures and smoke flows | PARTIAL | No atomic cross-domain opening batch or real client setup. |
| Training, shadow operation, UAT, pilot exit | No repository implementation/evidence | None | No client UAT or pilot evidence | OPEN | Requires client participation and approved exit criteria. |

## Requirements intentionally outside repository-only determination

The repository does not contain a signed SOW or contract. The following must
be confirmed before they can be classified as engineering requirements:

- customer benefits, invoices, billing cadence, credit limits, and approval
  thresholds;
- Zimbabwe tax/VAT and invoice treatment;
- bank/provider integration obligations and settlement-file formats;
- export formats, report catalogue, support/SLA, and offline scope;
- station master data, calibration charts, payment-provider identifiers,
  supplier/customer masters, thresholds, and opening positions;
- pilot station, training audience, shadow-operation period, UAT evidence, and
  pilot exit gates.
