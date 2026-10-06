# Phase 1 backend and data-gap audit

Status: **IMPLEMENTED IN BRANCH / VERIFIED IN ISOLATION**

This audit supports M4-T01. It maps the owner-required Phase 1 capability
families to evidence in the current repository baseline (`origin/main` at
the time this branch was created). It does not promote unresolved product,
accounting, tax, approval, or onboarding questions into requirements.

## Classification

- **Implemented** means the repository contains an exercised domain/API/UI
  slice for the capability. It does not imply production release completion.
- **Partial** means a meaningful source-of-truth or read-oriented slice exists,
  but the owner-required workflow, persistence, export, or approval boundary is
  incomplete.
- **Missing** means the repository currently has only a module boundary,
  documentation contract, or no implementation evidence.
- **WAITING_HUMAN — PRODUCT DECISION** means implementation must not proceed
  until the canonical open question is answered.

## Gap matrix

| Capability | Evidence in repository | Classification | Next safe work | Gate or dependency |
| --- | --- | --- | --- | --- |
| Tenant authority, RLS, authentication, audit | `src/modules/tenancy`, `src/modules/identity`, `src/platform`, canonical migrations and security tests | Implemented foundation | Reuse existing authority and transaction wrappers | Security-sensitive changes require independent review |
| Forecourt, daily operations, reconciliation | `src/modules/forecourt`, `/api/forecourt/*`, daily/reconciliation E2E and integration tests | Partial | Confirm owner workflow depth and implement only approved transitions | Supervisor/accountability, approved-fuel, cash handover, and sign-off semantics remain open |
| Inventory, deliveries, costing, and COGS | `src/modules/inventory`, `src/modules/costing`, inventory routes, A12 costing documents/tests | Partial | Complete only explicitly accepted operational gaps | Preserve movement authority, exact decimals, chronological COGS, and correction/reversal rules |
| Cash, banking, and provider settlements | `src/modules/cash`, `src/modules/settlements`, cash/settlement routes and tests | Partial | Reconcile remaining custody/deposit/provider requirements | Cash custody, banking responsibility, and provider-specific behavior remain policy-sensitive |
| Supplier and creditor workflows | `src/modules/creditors`, supplier routes and tests, A7 design document | Partial | Extend only after supplier/payment lifecycle requirements are confirmed | Do not conflate supplier payments with expenses or inventory movements |
| Customer read surface and account primitives | `src/modules/customers`, customer commands/statements, A8 migration and tests | Partial | Use the existing ledger/reservation model for the approved lifecycle slice | Full customer lifecycle order and rules are open owner decisions |
| Full customer lifecycle | No canonical final contract for benefits, vehicles/drivers, limits, account states, and approvals | WAITING_HUMAN — PRODUCT DECISION | Prepare a contract only after decisions are recorded | M5-T01 owner decisions; do not guess credit or prepaid policy |
| Expenses and fixed costs | A5 `reconciliation_expenses` schema/persistence, `SaveExpenses`, Daily Operations UI, cash treatment, reporting reads, and integration/E2E coverage exist; `src/modules/expenses/index.ts` remains only a boundary | Partial | Define the standalone expense/fixed-cost lifecycle and extend only from approved contracts | Accounting definitions, approval authority, allocation, and correction treatment required |
| Profitability | `src/modules/profitability` and A10 reporting calculation contracts exist; expense source is incomplete | Partial | Complete calculations only against established expense and posted-source contracts | No synthetic profitability; preserve A10 source/date-basis rules |
| Management reporting and daily reports | `src/modules/reporting`, `src/modules/profitability`, `/api/reports/*`, A10 architecture document | Partial | Add only confirmed report catalogue and data-quality states | Export/artifact persistence and owner report priorities remain future work |
| Reports and exports | Report response/query contracts exist; no export/artifact route or persistence implementation was found | Partial | Specify report/export contracts, authorization, lineage, and checksum before coding | Private artifact storage and export authorization require review |
| Reusable approvals | `src/modules/approvals/index.ts` is only a module boundary; individual domains have local state transitions | Missing | Design the narrow shared approval seam after domain decisions | Do not invent a generic workflow engine or approval authority |
| Notifications and Action Center | `src/modules/notifications/index.ts` is only a module boundary; no durable alert/action implementation was found | Missing | Define trigger, scope, lifecycle, destination, and acknowledgement contracts | Alert urgency and notification policy are unresolved |
| Documents and attachments | `src/modules/documents/index.ts` is only a module boundary; no owner workflow implementation was found | Missing | Define document ownership, private storage, retention, and audit contract | Storage/security policy required before implementation |
| Pricing and station/setup administration | `src/modules/pricing/index.ts` and `src/modules/stations/index.ts` are boundaries; context/settings provide read-oriented shell support | Partial | Audit required editable settings and price workflows separately | Authorization, effective dating, and approval semantics required |
| Offline/interrupted drafts | Blueprint and wireframes define limited local drafts, but no complete reconciliation/sync implementation was found | Missing | Specify draft ownership, versioning, conflict, retry, and recovery behavior | Must not cache or post authoritative financial mutations offline |
| External provider integrations | Settlement domain models provider evidence, but no provider control-plane adapter or external integration contract is complete | Partial | Define provider-neutral adapter boundary and reconciliation evidence | Provider-specific behavior and credentials require explicit authority |

## Confirmed dependency ordering

1. Preserve the Phase 0 release path and the parked M0-T03 human gate.
2. Complete the backend/data-gap audit (this document).
3. Record owner decisions for customer lifecycle, expenses, approvals, cash
   custody, provider behavior, and notification policy before implementing those
   semantics.
4. Define or reuse source-of-truth contracts before adding UI, exports, or
   projections.
5. Implement reusable approval infrastructure only after the first confirmed
   domain workflows identify the shared minimum seam.
6. Add reporting/export, Action Center, offline, and document capabilities
   only against established data, authorization, and correction contracts.

## Explicit non-decisions

This audit does not choose:

- customer credit limits, benefits, prepaid policy, or approval thresholds;
- expense accounting, tax, GL, or allocation treatment;
- cash custody, banking, or provider-specific responsibility;
- notification urgency, channels, or acknowledgement policy;
- infrastructure identities, production targets, or deployment policy.

Those items remain human/product decisions under the canonical requirements.

## Verification

- Source inventory and route/module inspection completed on the isolated
  `origin/main` baseline.
- No production access, credentials, migrations, schema changes, or external
  mutations were used.
- This document contains no invented client master data or policy values.
