# ADR-005 — Payment declaration canonical model

## Status

Proposed for A0/A1 verification on `agent/a3-core-forecourt`.

## Context

Migration `0003_a3_forecourt_reconciliation.sql` and `src/platform/db/schema/a3.ts` defined two
competing representations of a reconciliation's payment declarations:

1. A `payment_declarations` SQL table with typed columns, category/amount/currency check
   constraints, and foreign keys to `reconciliation_revisions` and `memberships`.
2. A `declarations` JSONB column on `reconciliation_revisions`, written by
   `submitReconciliationFromRequest` and `createReconciliationFromRequest`
   (`src/modules/forecourt/commands.ts`) and validated by the
   `validate_reconciliation_revision_payload` trigger.

No application code ever read from or wrote to `payment_declarations`; it was dead schema.

## Decision

The JSONB representation on `reconciliation_revisions.declarations` is the single canonical
model. `payment_declarations` is removed from the schema and from `0003` (the migration is
unmerged, so this is an edit to `0003`, not a new migration).

Reasons this is the right model for A3, not merely the path of least resistance:

- Declarations are entered atomically, once, as part of `SubmitReconciliation` — there is no
  product requirement in the Blueprint/Wireframes for iteratively editing individual declaration
  rows across multiple requests before submit. A single "count the drawer and submit" call matches
  the actual forecourt EOD workflow.
- The category enum (`CASH | ELECTRONIC | CUSTOMER_ACCOUNT | PREPAID | BENEFIT_INTERNAL | OTHER`)
  is already a controlled Zod enum at the command boundary (`declarationPayload` in
  `commands.ts`) and a domain type (`ReconciliationPaymentCategory` in `domain.ts`) — there is no
  uncontrolled string.
- `declaredBy` is always `context.actor.membershipId`, the trusted server-resolved actor; it is
  never accepted from the request body. `declaredFor` carries an explicit on-behalf-of subject
  when set.
- Amounts are parsed through `money()` / `ExactDecimal` and the accounted total is computed
  server-side in `calculateReconciliation` (`domain.ts`) by summing `ExactDecimal` values — never
  a client-supplied or JS floating-point total.
- Once a revision reaches `SUBMITTED`, `PENDING_APPROVAL`, `APPROVED`, or `POSTED`, the
  `reject_authoritative_forecourt_mutation` trigger blocks any change to `declarations` (along
  with every other authoritative revision field) except the named `APPROVED → POSTED` and
  `POSTED → LOCKED` transitions. This gives the JSONB column the same immutable-snapshot guarantee
  a separate "submitted declaration rows" table would have provided, without a second table to
  keep synchronized.

A future workstream that needs genuinely incremental, multi-request declaration entry (e.g. an
attendant progressively logging cash drops through a shift before the EOD count) should introduce
a purpose-built append-only table at that time, scoped to that requirement — not resurrect
`payment_declarations` as a mutable pre-submit draft store with no current caller.

## Consequences

- `payment_declarations` no longer appears in `0003_a3_forecourt_reconciliation.sql`,
  `src/platform/db/schema/a3.ts`, the Drizzle snapshot metadata, or role grants.
- The declaration production command surface for A3 is `CreateReconciliation` (initializes an
  empty declaration set on the first revision) and `SubmitReconciliation` (accepts the full
  declaration array, computes `accountedSales`/`variance` server-side, and snapshots it
  immutably). No separate `SetReconciliationDeclaration`/`UpsertReconciliationDeclaration`
  command exists, and none is needed while declarations are entered atomically at submit time.
- A5 can rely on the posted revision's `declarations` JSONB as the exact, immutable, typed
  accounted-total source; it must not expect a `payment_declarations` table.

## Source requirements

`AGENTS.md` exact-arithmetic and posted/locked correction invariants; ADR-003, ADR-004;
`docs/workstreams/A3_FORECOURT_RECONCILIATION.md`.
