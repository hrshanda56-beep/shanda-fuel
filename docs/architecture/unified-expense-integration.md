# Unified expense integration candidate

## Approved direction

Use the incoming PR #146 expense identity and finance workflow as the base.
Add immutable domain-specific fact versions, optional shift association and exact
reconciliation source references. Preserve incoming approvals, attachments,
settlements, recurring costs, recognition movements and reversals. There must be
one expense identity, not independently editable shift and finance copies.

## Isolated implementation

Base: PR #146 head `186f66d82b5529315ceb63149ede3fbf4c7135f7`.
The original dirty Clerk worktree is preserved. This checkout contains the
incoming code plus the unified expense extension, not the full operational-data
refactor. No merge, commit, push, deployment or remote DB change is performed.

Separately approved local test database: `shanda_unified_expense_test` on the
existing dedicated local PostgreSQL server. The original `shanda_finance_test`
was not converted or overwritten. Incoming migrations 0000–0040 and new
0047/0048 were installed here only, with recorded checksums.

## Data model

- `expenses` retains identity, current fact projection and finance lifecycle.
  Added `shift_id`, `observed_at`, `current_version_id`.
- `expense_versions` stores immutable fact versions: category, date, description,
  payee/reference, exact amount, optional shift/time and provenance. The parent
  projection and successor version advance atomically through the guarded
  correction capability. The projection is not a separately editable copy.
- `expense_recognition_version_sources` pins existing recognition identities to
  exact expense versions. Old recognition rows remain unchanged.
- `reconciliation_expense_version_sources` uses typed tenant/station/version FKs.
  Inserts must match an unsubmitted revision's exact shift/current version.
  Report submission integration remains pending; the existence of this table
  does not establish that every report has a complete expense manifest.
- Settlement facts stay in `expense_payments`; versions do not claim an expense
  has been paid. No cash/bank movement is created by this extension.

## Corrections

`CorrectExpenseFacts` uses authenticated actor/scope, audit and idempotency.
Only scoped Supervisor/Owner/Administrator roles may append facts. The request
must identify the expected version and give a reason. Approvals, settlements,
submitted report use and closed shift context block this initial correction
path. Existing posted corrections remain controlled reversals. An explicit
closed-shift exception workflow is not implemented here.

## History and migration collision

The incoming migrations 0035–0040 and the old local migrations 0035–0046 have
conflicting identities and incompatible `app.expenses` definitions. Numbers
0041–0046 are deliberately not reused by the integration candidate. This is
not permission to rewrite checksums in databases that applied the old stream.

Do not run this migration chain against the existing local database or Neon.
A conversion must first inventory applied hashes, preserve old versions and
source references, and map every old text category/payment claim to the
canonical finance contracts. Unknown category classifications or payment
proof must be flagged, not invented. No old payment-method label alone creates
an expense settlement or cash movement. Historical report references must
continue pointing to exact preserved versions. The old SQL must be retained as
historical migration evidence, not silently renumbered and replayed.

0047 labels existing incoming facts as `LEGACY_SNAPSHOT`: version 1 is a snapshot
at integration, not a claim that earlier revisions never existed. It does not
guess old shift links. New captures are `COMPLETE`.

## Outstanding gates

- Conversion of the other worktree and its applied local/dev histories.
- Complete operational reconciliation consumption/submission integration.
- Regression failures exposed in the incoming approval/recurring suites.
- Full combined operational/finance integration, browser acceptance, independent
  review and release validation. No production-readiness claim.

## Validation checkpoint

- Full unit suite: 171 files / 1,199 tests passed.
- Focused runtime-role unified version/correction/API suite: 5 tests passed.
- Wider expense suite: 14 passed / 3 failed; self-approval visibility, recurring
  test fixture missing its selected ID, and dependent audit expectations remain
  unresolved. The initial pre-migration integration attempt failed in test-harness
  mock setup, so it is not claimed as a successful database RED proof. The new
  correction suite did demonstrate missing-function RED before 0048, then GREEN.
- TypeScript, focused ESLint, formatting and diff checks passed.
- Build/browser/independent review and live migration-conversion tests not run.
- Neon/production contacted: NO. Commit/push/merge/deploy: NO.
