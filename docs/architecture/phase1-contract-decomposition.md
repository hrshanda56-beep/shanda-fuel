# Phase 1 contract decomposition

Status: reviewed planning artifact; implementation may proceed only for the
bounded sub-contracts explicitly marked ready below. No migration is
authorized by this document.

This document decomposes the bounded Phase 1 work that is already supported by
accepted decisions and the existing A3–A11 contracts. It does not choose
accounting, tax, credit-control, approval, or infrastructure policy that is
not already canonical.

## M4-T03 — Daily Operations

The fixed workflow is **Open Shift → Record Activity → Reconcile → Supervisor
Review → Close Shift**. The submitting operator and approving Supervisor remain
distinct actors; manager/administrator exception handling is separate. DEC-032
through DEC-035 and DEC-038 are the source of truth for these meanings.

Each implementation slice below is independently reviewable. A slice may be
implemented only after its command and read-model contract is confirmed against
the existing module boundaries.

| Slice | Authoritative contract | Existing evidence | Remaining implementation boundary |
| --- | --- | --- | --- |
| Accountability and close approval | DEC-032; A3/A5 reconciliation state machine | `src/modules/forecourt/production-reconciliation.ts`, `daily-reconciliation.ts`, and integration coverage already separate submit, return, approval, and lock | Extend only where a missing transition or projection is demonstrated; preserve distinct submitter/approver identities |
| Approved-fuel attribution | DEC-034 | The decision fixes recipient, authorizer, reason/category, and applicable reference | Define the smallest named command/read projection that carries those facts; do not infer benefit, tax, or accounting treatment |
| Cash custody and deposit evidence | DEC-035; A6 cash boundary | Existing cash collection/deposit workflows and tests provide the current state and actor model | Add only missing custody/deposit evidence or projection; preserve amount, handing-over/depositing actor, receiving/verifying actor, timestamp, and bank/deposit reference |
| Exception-first close summary | DEC-038; A10/A11 composition | A11 composes reconciliation, cash, provider, and reporting states without a second reconciliation engine | Add authoritative exception/approval projection only when its source and permission contract are identified; presentation must not infer approval from UI state |
| Interrupted delivery/calibration/transfer handling | Existing A4/A11 boundaries | A11 explicitly leaves delivery and inventory linkage in A4 | Remains a separate scoped contract; no new inventory or reconciliation model is created in M4-T03 |

### Required contract checklist for each new write

Before implementation, the owning slice must specify:

1. command name and state transition;
2. tenant/legal-entity/station scope resolved from the trusted actor, never
   request labels;
3. permission and any step-up/approval requirement;
4. exact decimal and date/time representation where applicable;
5. audit event and actor attribution;
6. idempotency key and replay behavior;
7. optimistic-concurrency/stale-state behavior;
8. correction, reversal, or exception path;
9. loading, error, empty, and accessibility states at the UI boundary; and
10. unit, PostgreSQL, integration, and browser coverage appropriate to the
    slice.

No slice may weaken RLS, tenant isolation, actor separation, append-oriented
audit, or correction/reversal semantics. Bounded configuration may control only
the settings allowed by DEC-037 and may not disable required controls.

## M5-T01 — Customer lifecycle specification

The delivery order is fixed by DEC-036:

1. credit accounts and enforceable limits;
2. prepaid monetary value;
3. statements;
4. vehicles and drivers;
5. prepaid litres; and
6. benefits.

The existing A8 customer-account boundary is the starting contract. It already
defines tenant-scoped customers/accounts, exact-decimal append-oriented ledger
entries, credit and prepaid account types, authorizations/reservations, source
references to immutable A5 evidence, idempotency, correction/reversal, and
RLS-fail-closed behavior. M5-T01 must extend or clarify that contract rather
than add a second ledger or recalculate A5 sales.

DEC-041 resolves the product semantics for credit caps, money-value prepaid,
monthly reporting statements, default station pricing, optional vehicle/driver
restrictions, deferred benefits, metadata/tax boundaries, single operational
currency, lifecycle states, and the default customer authorization meaning.
The following remain separate implementation gates rather than product
questions to be inferred: exact accounting/ledger treatment where the existing
A8 contract is insufficient, role-permission migration alignment, the monthly
statement read-model contract, lifecycle transition command details, and the
later vehicle/driver, customer-specific pricing, benefits, tax, and FX
contracts.

The first M5-T02 slice is ready for positive CREDIT limit enforcement and
active-customer/account transaction guards. It must preserve exact decimals,
tenant/RLS boundaries, audit/idempotency, and the existing A8 ledger rather
than introduce a second accounting model.

## Current outcome

- M4-T03 is decomposed into bounded Daily Operations slices and is ready for
  an individual slice to receive a reviewed implementation contract.
- M5-T01 is accepted for the DEC-041 customer lifecycle semantics, with the
  remaining accounting, permission-migration, read-model, and later-feature
  gates recorded above.
- M5-T02 is ready for the bounded positive-credit-limit and active-customer/
  account transaction-guard slice; full lifecycle writes remain separately
  gated by reviewed command, permission, audit, and migration contracts.
- No production access, provisioning, Stage 1/Stage 2 execution, migration,
  or schema change is authorized by this artifact.
