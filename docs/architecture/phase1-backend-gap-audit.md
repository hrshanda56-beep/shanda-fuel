# Phase 1 backend and data-gap audit

This audit records the implementation boundary observed on the Phase 1
checkpoint `12aa31c` after comparing the Phase 1 plan, product decisions,
current module contracts, persistence code, and tests. It is a read-only
planning artifact for M4-T01; it does not promote unresolved product,
accounting, permission, or migration decisions into implementation scope.

## Evidence and status matrix

| Capability | Current evidence | Status | Safe next slice | Boundary / dependency |
| --- | --- | --- | --- | --- |
| Tenant, legal-entity, and station authorization | `src/modules/tenancy/`, `src/modules/identity/`, `src/modules/authorization/`, tenant transaction context, RLS integration tests | Implemented foundation | Consume existing authority context from new reads and commands | No UI-only filtering; no new scope model |
| Forecourt day, shift, meter, reconciliation, posting, and locking | `src/modules/forecourt/`, A3/A5 integration tests, production reconciliation bridge | Implemented for the existing vertical slice | Add only reviewed Phase 1 read projections or bounded commands | Supervisor/submitter semantics must remain distinct |
| Home-dashboard sales, cash, credit, and stock facts | `src/modules/reporting/queries.ts`, `src/modules/reporting/ui/operations-dashboard.tsx`, reporting tests | Bounded read slice implemented | Expose authoritative close/approval state through a server read contract | No synthetic values; do not redesign the dashboard while Phase 0.5 owns presentation |
| Unresolved exceptions | No reviewed cross-domain exception catalogue or lifecycle contract | Open / unavailable | Define exception sources, severity, lifecycle, and destination before coding | Requires a reviewed read-model contract; do not infer from UI errors or raw status counts |
| Shift approval / close status | Existing shift and reconciliation state records are available through `src/modules/forecourt/operations-overview.ts` | Partially available | Publish a small server-side status projection using those authoritative states | Exact dashboard wording and aggregation remain UI integration work |
| Daily Operations accountability and close | `src/modules/forecourt/daily-operations.ts`, `production-reconciliation.ts`, A11 tests | Existing workflow is authoritative; richer Phase 1 depth remains partial | Implement one reviewed slice at a time: approved-fuel evidence, cash custody, or close projection | Each write needs permission, audit, idempotency, and concurrency coverage |
| Inventory, deliveries, and costing | `src/modules/inventory/`, `src/modules/costing/`, A4/A12 tests | Partial by design | Interrupted delivery, calibration execution, transfers, and remaining pool behavior | A4 owns physical quantity; do not let purchasing or reporting mutate it |
| Cash custody and banking | `src/modules/cash/`, A6 tests | Partial | Cash count, handover, and dispute workflow after command contracts are reviewed | Do not equate collection, deposit, or provider declaration with bank confirmation |
| Supplier creditors | `src/modules/creditors/`, supplier routes, A7 tests | Implemented for the merged scope | Use published supplier outputs in reporting | Delivery references must not rewrite A4 movements |
| Customer credit and prepaid accounts | `src/modules/customers/`, A8 tests, lifecycle guard tests | Bounded guard and existing A8 writes implemented | Continue only after permission/migration alignment; lifecycle transitions are separate | Preserve exact decimal ledger/reservation behavior and append-only correction paths |
| Customer monthly statements | `src/modules/customers/queries.ts`, validation tests, statement route | Bounded read model implemented | Add timezone-period tests or later export behavior only under a reviewed contract | Statements must not post, pay, or mutate balances |
| Customer lifecycle transitions | Customer status/account status columns exist, but no reviewed transition command surface | Open | Review transition permission codes, audit payload, idempotency, version checks, and migration integration | Blocked on A0-owned permission/migration alignment; do not add speculative commands |
| Expenses and fixed costs | Reconciliation expense evidence is consumed by reporting; no independent expense lifecycle is established | Partial / open | Confirm expense ownership, recognition, approval, and payment separation | Requires accounting and approval definitions; do not treat A5 evidence as a full expense ledger |
| Reusable approvals | `src/modules/approvals/` exists as a module boundary, but no approved generic workflow contract is integrated across Phase 1 domains | Open | Define the narrowest shared approval contract for a confirmed workflow | Avoid a generic rules engine; self-approval and step-up semantics must be explicit |
| Reports and exports | Management/daily report read paths exist; full report artifacts and PDF/XLSX export are absent | Partial | Reuse canonical calculations for one confirmed report/export slice | Export authorization, lineage, checksum, and exact date/decimal semantics are required |
| Editable settings | `src/modules/settings/` is read-oriented/contextual | Open | Confirm setting groups and permission ownership | Settings cannot weaken RLS, authorization, audit, or actor attribution |
| Offline/interrupted drafts | No authoritative server reconciliation strategy is integrated | Not started | Specify ownership, versioning, conflict, retry, and duplicate-posting behavior first | Do not add a client cache that can imply financial posting |
| Alerts / Action Center | No reviewed alert catalogue or durable lifecycle | Not started | Define trigger, scope, lifecycle, and destination from stable source states | No fabricated urgency or dashboard-only exception logic |

## Dependency order

The audit supports this implementation order for work that is safe to resume
without the Phase 0.5 presentation work:

1. Publish a small server-side close/approval status projection from existing
   forecourt state, with tenant authorization and read-model tests.
2. Review one Daily Operations write slice and its permission, audit,
   idempotency, and concurrency contract before implementation.
3. Resolve the customer-specific permission/migration alignment gate before
   adding lifecycle transition commands.
4. Define the narrow approval contract needed by the first confirmed workflow;
   do not generalize it ahead of that need.
5. Extend reporting/exports only after the authoritative source and date basis
   are fixed for the selected report.

## Explicit non-goals for this checkpoint

- No UI shell, navigation, design token, global CSS, or responsive behavior
  changes.
- No new customer lifecycle mutation, permission seed, or canonical migration.
- No accounting, tax, FX, general-ledger, provider, or production-data
  assumptions.
- No replacement of an authoritative ledger with a dashboard projection.

