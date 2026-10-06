# Shanda Fuel — Implementation Plan

## 1. Purpose

This plan turns the remaining Shanda Fuel work into ordered, testable tasks suitable for Codex agents. It starts from the latest documented project state and does not reopen completed architectural decisions.

The plan deliberately separates:

- **release-critical Phase 0 closure**, which must be completed before owner handoff; and
- **Phase 1 product expansion**, which should begin only after Phase 0 is owner-ready unless a human explicitly changes priority.

Task status in this file is a planning aid. `/docs/CURRENT_STATUS.md` remains the factual status snapshot.

## 2. Execution principles

1. Work in isolated branches/worktrees.
2. Never alter the dirty primary worktree unless explicitly instructed.
3. Keep implementation and review roles separate for release/security-sensitive work.
4. Do not broaden scope because an adjacent improvement is convenient.
5. Reproduce environment prerequisites before classifying an integration failure as a product defect.
6. Keep production secrets out of chat, files, logs, and argv.
7. Do not touch production unless the assigned task explicitly authorises a human-run production operation.
8. After parallel work is combined, rerun integration gates against the combined candidate.

## 3. Milestone overview

| Milestone | Goal | Release dependency |
| --- | --- | --- |
| M0 | Close production first-user access preflight and bootstrap | Blocks all remaining production owner-access work |
| M1 | Finalize the clean Phase 0 application candidate | Can run mostly in parallel with M0 |
| M2 | Integrate, validate, and deploy the Phase 0 release | Depends on M0 and M1 |
| M3 | Owner acceptance and handoff | Depends on M2 |
| M4 | Phase 1 operational depth and real management data | Starts after Phase 0 unless reprioritized |
| M5 | Phase 1 customer/finance/approval workflows | Can partially parallelize within architectural boundaries |
| M6 | Phase 1 resilience, alerts, settings, and offline/interrupted workflows | Depends on domain contracts from M4/M5 |

---

## Current critical path

The following is the current authoritative Phase 0 sequence, last synchronized
against main `8b9d163763cb4fab52b96aed225f7553f0069e65`:

1. Obtain human authority review of DEC-040 and confirm that the existing
   Neon/provider-owner or deployment-admin boundary is the approved one-time
   authority for assigning and clearing the temporary
   `first_user_provisioner` password.
2. Update or replace the external Stage 1 helper so only that reviewed
   authority boundary performs the password assignment/cleanup; preserve
   `migration_owner` as `NOCREATEROLE`, the existing DEC-011 secret handling,
   all preflight predicates, and all fail-closed behavior. Independently
   review the actual final helper/procedure.
3. Have the approved human operator rerun Stage 1 through the reviewed
   human-controlled procedure, stopping at its scope-discovery hard stop.
4. Classify the rerun result and scope discovery; do not continue to Stage 2
   or provisioning from this task.
5. Select legitimate production scope.
6. Run Stage 2 READ ONLY dry run.
7. Verify zero writes, sentinel unchanged, and password-NULL cleanup.
8. Obtain explicit human approval.
9. Provision the real first user.
10. Run authenticated smoke.
11. FINAL RELEASE GO.
12. Integrate PR #92 plus Customers clean candidate.
13. Integrate verified A8 fix.
14. Integrate reviewed Daily Operations timezone fix.
15. Run full DB/CI/browser/accessibility/responsive verification.
16. Deploy.
17. Verify exact production SHA.
18. Final owner review.
19. OWNER READY handoff.

The documentation merge did not change deployed application behavior. The
production application baseline remains
`53cf4382487271bed68160386cc41c447ab542e2` until a later application release
is verified.

# M0 — Production first-user access closure

## M0-T01 — Implement exhaustive first-user function ACL-grantee preflight — VERIFIED COMPLETE

**Objective**

The former arbitrary unrelated-role spot check has been replaced with an
exhaustive PostgreSQL function ACL assertion that rejects any unexpected
`EXECUTE` grantee.

**Relevant requirements/decisions**

- DEC-002 — RLS/security boundary.
- DEC-005/006 — first-user bootstrap and read-only dry run.
- DEC-028 — do not create a production role merely for a diagnostic probe.
- DEC-029 — exhaustive ACL validation replaces the former spot check.

**Likely files/components affected**

- production first-user operator/runbook material,
- Stage 1 preflight script,
- security/preflight test fixtures where the same invariant is testable,
- possibly existing first-user provisioning preflight tests.

**Dependencies**

- Current reviewed psql16-compatible connection parser.
- Migration 0021 as the source of the approved function/ACL contract.

**Implementation notes**

- Expand `pg_proc` ACLs using PostgreSQL catalog-safe ACL inspection such as `aclexplode` or equivalent.
- Distinguish owner privilege semantics from explicit grantee ACL entries.
- Preserve exact function ownership, `SECURITY DEFINER`, fixed search path, PUBLIC denial, app_runtime denial, and provisioner allowlist checks.
- Reject unexpected grantee or grant-option drift if not part of the approved migration contract.
- Preserve the approved exhaustive assertion and do not reintroduce an
  arbitrary unrelated-role prerequisite.

**Acceptance criteria**

- Any explicit unexpected `EXECUTE` grantee fails preflight.
- Approved migration-owner/provisioner semantics pass.
- PUBLIC and app_runtime negative checks remain explicit.
- Stage 1 no longer requires an invented or unavailable production role.
- No production role/ACL/migration is changed by the implementation.

**Tests/verification**

- Syntax checks for shell/operator scripts.
- Static SQL cases covering approved ACLs, unexpected role, PUBLIC drift, app_runtime drift, owner semantics, and grant option behavior.
- Existing first-user security tests where applicable.
- Independent Access Review before production execution.

**Parallel safety**

- Can run in parallel with M1 application-candidate work.
- Must not run in parallel with another agent editing the same first-user operator scripts.

---

## M0-T02 — Independent Access Review of exhaustive ACL preflight — VERIFIED COMPLETE

**Objective**

Verify that M0-T01 strengthens or preserves security and does not weaken any existing first-user release invariant.

**Dependencies**

- M0-T01 complete.

**Implementation notes**

Review actual files and SQL, not only the implementer report.

**Acceptance criteria**

- REVIEW GREEN.
- Stage 1 no longer depends on an arbitrary unrelated-role spot check.
- Stage 2 remains safe/read-only.
- No migration, production ACL, role, or auth semantic changed.

**Tests/verification**

- Reviewer repeats static/syntax checks as appropriate.

**Parallel safety**

- Review-only; should not mutate the implementation unless a blocker is found and ownership is reassigned.

---

## M0-T03 — Run production Stage 1 through scope discovery — BLOCKED / IN PROGRESS

**Objective**

Perform the reviewed production preflight and discover legitimate bootstrap scope options without provisioning a user.

**Relevant requirements**

- Exact release SHA/worktree/migration hash.
- Provider-membership preflight.
- Migration-applied verification.
- Force RLS/policy/helper/search-path verification.
- Ephemeral provisioner credential lifecycle.
- Direct provisioner session.
- Scope discovery.

**Dependencies**

- M0-T02 REVIEW GREEN.
- An authoritative, independent, non-secret production database target
  invariant has been established and reviewed.
- That invariant has been incorporated into the diagnostic and received an
  independent final procedure review.
- DEC-040 is accepted; the human must obtain the exact provider-approved admin
  role name and load the approved admin URL through the hidden process-local
  workflow.

**Implementation notes**

- Human operator executes the reviewed script; agents do not receive the credential.
- The diagnostic must remain blocked until the independent production target
  invariant is present; `APP_ENV`, `PGHOST`, `PGDATABASE`, `PGPORT`, the
  migration hash, role membership, and server version alone are insufficient.
- The approved human operator has executed the invariant-integrated diagnostic
  from commit `6d436fe0dc35d31a8307de68aac683a22c3922e9`. It completed with
  exit status `0`, passed identity, provider-membership, migration-fingerprint,
  PostgreSQL-version, read-only, and nine-relation RLS/Force-RLS observations,
  returned 19 policy rows including all nine expected provisioning policies,
  and ended with `ROLLBACK` without SQL errors.
- The exact historical operator assertion is recoverable in the approved local
  tooling. It fails with `SELECT 1 / 0` when `policy_checks_ok` is false;
  `policy_checks_ok` requires nine exact `qual` and `with_check` rows and no
  other `first_user_provisioning_%` policy anywhere in `pg_policies`.
- The approved predicate-level diagnostic established that the nine policies
  are present and correct, but `pg_policies.cmd` normalizes raw
  `pg_policy.polcmd='*'` to `'ALL'`. The historical `cmd='*'` comparison was
  therefore a tooling assertion bug; the unexpected-prefixed-policy predicate
  passed.
- The repository-local diagnostic uses `pg_policies.cmd = 'ALL'`, with
  regression coverage preventing the raw `'*'` comparison from returning.
  The external helper now also contains the explicit DEC-040 fixed admin
  handoff, and its actual final diff has received independent GREEN security
  review. Only the human may execute the reviewed procedure and stop at its
  existing scope-discovery hard stop. Do not continue to Stage 2, provisioning,
  or remediation.
- The original policy-assertion failure occurred before temporary provisioner
  password assignment; the later corrected rerun reached that step but could
  not assign the password under the existing role authority, so no scope was
  selected.
- Do not guess tenant/legal-entity/station IDs.
- The corrected Stage 1 rerun passed the policy assertion and all preceding
  checks, then failed at temporary password assignment because PostgreSQL
  18.6 correctly rejects `ALTER ROLE first_user_provisioner PASSWORD` from
  `migration_owner` while that role is `NOCREATEROLE`. The existing
  `ADMIN=true` membership is not sufficient authority for this operation.
- DEC-040 establishes a human-only transport because the repository audit
  found no concrete provider-owner/deployment-admin invocation. It preserves
  the `migration_owner NOCREATEROLE` contract and avoids a durable
  `SECURITY DEFINER` or elevated application credential. The exact admin role
  name must come from the provider control plane; agents must not guess it.
- The local PostgreSQL 18.6 regression suite adds coverage for the intended
  boundary: a `SET ROLE migration_owner` attempt to assign the password must
  be rejected with SQLSTATE `42501`, while the disposable local owner/admin
  fixture can assign and immediately clear the password. No production
  credentials or data are used.

**Current verified result**

- Stage 1 is not complete; the reviewed procedure is ready for the final human
  rerun using the approved admin URL and exact provider-control-plane role name.
- The read-only diagnostic completed successfully; its zero exit status is
  evidence-collection success only and is not a Stage 1 pass.
- No legitimate scope choices were accepted for Stage 2.
- No temporary provisioner credential was assigned by the failed run.
- No user was provisioned.
- The final external helper diff is independently GREEN-reviewed. The human
  must obtain the exact approved admin role/URL inputs before execution.

**Tests/verification**

- Confirm the recorded target invariant is present in the final procedure.
- Independent security review of the initial read-only diagnostic and the
  final password-authority procedure is GREEN.
- The initial human diagnostic evidence is collected and reviewed against
  migrations and the historical assertion.
- Human confirms the reviewed external helper contains the corrected
  normalized `cmd = 'ALL'` predicate, executes the reviewed Stage 1 procedure,
  and returns redacted output only. Agents do not execute production.
- Classify the corrected rerun and scope-discovery result; no Stage 2 or
  provisioning follows from this task.

**Parallel safety**

- Production execution is sequential and human-controlled.

### HUMAN DECISION PACKET — independent production target invariant (RESOLVED)

**Decision recorded in DEC-031:** The human selected a non-secret production
identity authoritative independently of the connection environment being
validated. Do not add credentials or connection strings to repository
documentation.

Suitable invariant categories:

- The exact approved database endpoint hostname, if the provider confirms it
  uniquely and immutably identifies the approved production database/project.
- A provider project/branch/endpoint identifier paired with an approved,
  independently verifiable way for the diagnostic to confirm that identity.
- Another non-secret infrastructure identity exposed by the approved provider
  or operator tooling that cannot simply be supplied by `PGHOST`, `PGDATABASE`,
  `PGPORT`, or `APP_ENV` itself.

**Selected category:** The exact approved endpoint hostname is the primary
invariant, sourced from the authenticated Neon control plane and validated
against the decoded `PGHOST` produced by the existing DEC-011 bootstrap. This
is the strongest and simplest single invariant for the current process-local
libpq design because it adds no credential path, URI parsing, service
indirection, or secret exposure. Its approved value and provider provenance
are recorded in DEC-031.

Do not treat `APP_ENV`, `PGDATABASE`, `PGPORT`, the migration hash, role
membership, or PostgreSQL server version alone as production identity. The
independent security review is GREEN for the initial procedure; the approved
human operator has executed both read-only procedures, and the corrected
normalized comparison is locally ready. Stage 1 remains blocked until DEC-040
is approved and the external helper receives a separately reviewed
password-authority handoff.

---

## M0-T04 — Choose first-user scope and inputs

**Objective**

Record the human-approved first-user identity and organisational scope for the dry run.

**Relevant requirements**

- Email.
- Display name.
- Tenant/legal entity/station chosen only from Stage 1 output.
- Access expiry.
- Fixed 12 read-only permission expectation.

**Dependencies**

- M0-T03.

**Implementation notes**

Do not record plaintext password or production DB credentials in repository documentation.

**Acceptance criteria**

- One unambiguous scope choice is approved.
- Identity inputs are confirmed.
- No real provisioning approval is implied yet.

**Parallel safety**

- Human decision; no code overlap.

---

## M0-T05 — Run production Stage 2 read-only dry run

**Objective**

Validate the selected identity/scope and permission contract without writes.

**Dependencies**

- M0-T04.
- Stage 2 still matches the independently reviewed version.

**Implementation notes**

Stage 2 must remain incapable of real provisioning.

**Acceptance criteria**

- Selected scope validates.
- Identity checks behave as expected.
- Exactly 12 reviewed read-only permissions are asserted.
- Zero-write proof passes.
- Bootstrap sentinel remains unchanged.
- Temporary provisioner password is reset to NULL.
- Post-cleanup direct authentication fails as expected.
- Role/membership/ACL state remains correct.
- Hard stop occurs before real provisioning.

**Tests/verification**

- Human reviews final dry-run PASS summary and cleanup proof.

**Parallel safety**

- Sequential production task.

---

## M0-T06 — Explicit human approval for real first-user provisioning

**Objective**

Create a clear approval boundary between dry-run evidence and the irreversible one-time bootstrap action.

**Dependencies**

- M0-T05 green.

**Acceptance criteria**

- Human explicitly approves the identity/scope/expiry and real provision step.
- Approval is not inferred from previous dry-run instructions.

**Parallel safety**

- Human gate only.

---

## M0-T07 — Provision the real first production user

**Objective**

Execute the separately reviewed real provisioning operation once.

**Dependencies**

- M0-T06 explicit approval.
- Real-provision procedure must be independently reviewed and must use hidden password/audit material handling.

**Implementation notes**

- Do not reuse dry-run scripts by inserting `--provision` into them.
- Preserve sentinel one-time behavior and cleanup.

**Acceptance criteria**

- One intended first user exists in the intended scope.
- Bootstrap sentinel is consumed exactly once as designed.
- Audit evidence exists as designed.
- Temporary provisioner credential is cleared.

**Tests/verification**

- Post-provision catalog/auth/audit verification.

**Parallel safety**

- Sequential production task.

---

## M0-T08 — Authenticated production smoke

**Objective**

Verify that the legitimate first user can use the deployed application through the normal auth path.

**Dependencies**

- M0-T07.

**Acceptance criteria**

- Login succeeds.
- Authorised organisation/station context is available.
- A protected route opens.
- Unauthorized scope is not exposed.
- Logout succeeds.
- Re-login succeeds.

**Tests/verification**

- Browser smoke on production URL only.

**Parallel safety**

- Sequential after provisioning.

---

# M1 — Finalize the clean Phase 0 application candidate

## M1-T01 — Integrate the verified Customers A8 monetary precision fix

**Objective**

Ensure the final clean candidate contains the verified four-decimal customer balance behavior.

**Relevant requirements**

- `NUMERIC(20,4)` money values preserve four decimal places at the API boundary.
- Verified example: `125.3750`.

**Likely files/components affected**

- `src/modules/customers/queries.ts`
- relevant Customers unit/integration tests if the verified change includes them.

**Dependencies**

- Verified A8 fix/result already exists.

**Implementation notes**

- Integrate only the intended A8 product change.
- Do not accidentally include unrelated `src/platform/db/client.ts` edits observed in worktrees.

**Acceptance criteria**

- Customer summary returns four-decimal exact value.
- Tenant isolation remains intact.
- No new migration/RLS/auth/write behavior.

**Tests/verification**

- Customer unit tests.
- A8 PostgreSQL integration.
- Real DB customer summary coverage.
- Broader non-provisioning integration suite.
- Typecheck/lint.

**Parallel safety**

- Can run in parallel with M0 and with timezone review if isolated branches avoid overlapping files.

---

## M1-T02 — Review and integrate Daily Operations station-timezone fix

**Objective**

Integrate only the scoped timezone correctness fix into the clean candidate.

**Relevant requirements**

- Station operational time uses `operation.station.timezone` / station metadata.
- Missing/invalid timezone renders a truthful unavailable value.
- No browser-local fallback.

**Likely files/components affected**

- Daily Operations workspace,
- shared/local date-time formatter,
- focused formatter tests.

**Dependencies**

- Existing TZ Fix implementation.

**Implementation notes**

- Review the exact diff against the clean candidate.
- Exclude unrelated worktree modifications in Customers or DB client files.

**Acceptance criteria**

- Clean timezone-only patch/commit.
- Adjacent station-time displays are consistent.
- No schema/migration/auth/RLS/provisioning change.

**Tests/verification**

- Focused formatter tests.
- Daily Operations E2E.
- Typecheck/lint/build.

**Parallel safety**

- Can run in parallel with M1-T01 if files do not overlap.

---

## M1-T03 — Reconstruct/finalize one clean integrated release branch

**Objective**

Produce one branch that contains only the intended Phase 0 stack.

**Included scope**

- current authoritative main baseline,
- PR #92 UI polish,
- known PR #92 test-only fixes,
- Customers Phase 0,
- Customers-present navigation/shell expectations,
- Daily Ops stale E2E expectation fixes,
- verified A8 precision fix,
- reviewed Daily Ops timezone fix.

**Dependencies**

- M1-T01.
- M1-T02.

**Implementation notes**

- Preserve main-side first-user/security files and CI safeguards.
- Exclude unrelated A12 edits and any unrelated DB-client changes.

**Acceptance criteria**

- Diff contains only intended Phase 0 release work.
- No migration/RLS/auth/provisioning changes unless separately approved.
- Worktree is clean after commit.

**Tests/verification**

- Diff review and `git diff --check` equivalent.

**Parallel safety**

- Integration task; should occur after contributing branches are stable.

---

## M1-T04 — Final combined database/integration verification

**Objective**

Verify the final integrated branch against the dedicated PostgreSQL 18 harness with correct ownership/UTC/bootstrap prerequisites.

**Dependencies**

- M1-T03.

**Implementation notes**

- Use the dedicated project PG18 environment, never the Homebrew default cluster.
- Apply migrations with the expected migration owner.
- Provisioning-specific opt-in suites may remain skipped unless their explicit fixtures/DB URLs are configured; report skips accurately.

**Acceptance criteria**

- Fresh migrations pass.
- Schema/db check passes.
- A8 and A3 focused tests pass.
- Tenant isolation passes.
- Broader non-provisioning integration suite passes with zero failures.
- No cross-tenant leakage/unexpected writes.

**Tests/verification**

- Existing integration suite as defined by repository configuration.

**Parallel safety**

- Run after branch integration; not meaningfully parallel with changes to the same candidate.

---

## M1-T05 — Final combined UI/browser/accessibility verification

**Objective**

Verify the final integrated branch across the owner-facing UI.

**Dependencies**

- M1-T03.

**Acceptance criteria**

- Unit tests pass.
- Typecheck passes.
- Lint/format pass.
- Build passes.
- Shell/navigation tests pass.
- Customers E2E passes.
- Daily Operations E2E passes.
- Accessibility checks pass.
- Responsive checks pass at representative phone/tablet/desktop widths.
- Light/dark behavior remains coherent.
- No duplicate headings/dead navigation/obvious overflow.

**Parallel safety**

- Can run in parallel with M1-T04 once the candidate is frozen.

---

# M2 — Release integration and production verification

## M2-T01 — Integrate the final candidate through the normal review/PR gate

**Objective**

Land the prepared Phase 0 application changes onto the current authoritative main without losing security/release work.

**Dependencies**

- M0-T08 completed or explicit release sequencing approval.
- M1-T04 and M1-T05 green.

**Implementation notes**

- Fetch and record current `origin/main` at execution time.
- Do not rely on stale local `main`.
- Preserve first-user/security artifacts and CI safeguards from current main.
- Review the final diff before merge.

**Acceptance criteria**

- Normal CI passes.
- Review approves the final diff.
- Merged commit/release SHA is recorded.

**Parallel safety**

- Sequential integration gate.

---

## M2-T02 — Deploy and verify the integrated production release

**Objective**

Deploy the approved integrated release and verify that production points to the exact intended SHA.

**Dependencies**

- M2-T01.

**Acceptance criteria**

- Production deployment READY/healthy.
- `https://fuel.shandahr.com` resolves to the intended release.
- Exact production release SHA matches the approved integrated commit.
- No unintended migration is run.

**Tests/verification**

- Deployment health/readiness.
- Exact SHA verification.
- Targeted production smoke.

**Parallel safety**

- Sequential release operation.

---

## M2-T03 — Final production application smoke

**Objective**

Confirm owner-visible product behavior after the integrated deployment.

**Dependencies**

- M2-T02.
- Legitimate production user from M0.

**Acceptance criteria**

- Dashboard truthful state.
- Daily Operations station-local time and core composition.
- Customers list/detail/search/summary.
- Reports/Settings and other navigation reachable.
- Protected-route behavior remains correct.
- No obvious responsive regression.

**Parallel safety**

- Sequential after deployment.

---

# M3 — Owner acceptance and handoff

## M3-T01 — Run the 15–25 minute owner acceptance checklist

**Objective**

Have the human owner review the actual production application, not a preview.

**Dependencies**

- M2-T03.

**Acceptance criteria**

Owner reviews, at minimum:

- sign-in/context/logout,
- Dashboard truthfulness,
- navigation/command search,
- Daily Operations workflow/composition,
- Customers,
- Finance/reporting surfaces,
- phone/tablet/desktop behavior,
- terminology/workflow questions.

**Tests/verification**

- Human review notes.

**Parallel safety**

- Human gate.

---

## M3-T02 — Remediate final P0/P1 findings only

**Objective**

Fix release-blocking correctness/usability findings without reopening Phase 1 scope.

**Dependencies**

- M3-T01.

**Implementation notes**

- P0/P1 defects block handoff.
- P2/nice-to-have items should be documented for Phase 1 unless the owner explicitly promotes them.

**Acceptance criteria**

- No unresolved confirmed P0/P1.
- Regression gates rerun for changed areas.

**Parallel safety**

- Parallelize only independent findings with clear file/domain ownership.

---

## M3-T03 — Record owner decisions on unresolved domain semantics — VERIFIED COMPLETE

**Objective**

Convert owner feedback into explicit decisions without mixing it into ad-hoc code changes.

**Resolved owner decisions**

- Supervisor means the accountable reviewer/approver, distinct from the
  operator/submitter.
- Account sales require a customer/account before finalization; references are
  optional by default and must precede finalization when required by policy.
- Approved-fuel activity carries auditable recipient, authorizer,
  reason/category, and authorization/reference evidence where applicable.
- Cash handover/deposit records preserve amount, actor attribution, date/time,
  and reference; bank deposits require a bank/deposit reference.
- Customer-account Phase 1 priority is credit/limits, prepaid value,
  statements, vehicles/drivers, prepaid litres, then benefits.
- Close summaries are exception-first and include required reconciliation and
  approval/sign-off information.

**Acceptance criteria**

- Decisions are recorded in `docs/PRODUCT_SPEC.md`, `docs/DECISIONS.md`, and
  the bounded configuration rule is reflected in `docs/ARCHITECTURE.md`.
- Resulting Phase 1 specification work and remaining accounting/security gates
  are explicit below.

**Parallel safety**

- Documentation/decision work can run while unrelated technical verification completes.

---

## M3-T04 — Owner handoff

**Objective**

Declare Phase 0 owner-ready and hand over the stable production URL.

**Dependencies**

- M3-T02.
- M3-T03 where decisions are required for acceptance.

**Acceptance criteria**

- Owner-ready status recorded.
- Final production SHA recorded.
- Handoff URL is only `https://fuel.shandahr.com`.
- Known temporary release exceptions remain accurately documented.

**Parallel safety**

- Final sequential gate.

---

# M4 — Phase 1: real management data and operational depth

Phase 1 should begin from verified Phase 0 behavior. The conversation references parked plans for backend gaps, real dashboard data, approval infrastructure, and handover. Agents must inspect those plans and reconcile them with current code before implementation.

## M4-T01 — Audit backend/data gaps against owner-required first version

**Objective**

Map remaining owner requirements to existing schema/APIs/modules and identify true backend gaps.

**Relevant requirements**

- Full owner-required first version beyond Phase 0.
- Avoid duplicate domain models.

**Likely files/components affected**

- No product code initially; architecture/status/plan docs.
- Existing parked backend-gap roadmap should be reviewed.

**Dependencies**

- Phase 0 handoff or explicit permission to begin earlier.

**Acceptance criteria**

- Gap matrix distinguishes existing/partial/missing.
- No speculative requirements promoted to confirmed.
- Dependencies for following Phase 1 tasks are clear.

**Tests/verification**

- Documentation review against schema/code and owner decisions.

**Parallel safety**

- Can run in parallel with read-only dashboard/approval design audits.

---

## M4-T02 — Replace remaining dashboard placeholders/unavailable states with real supported metrics — READY FOR A BOUNDED FIRST SLICE

**Objective**

Implement owner-useful dashboard metrics only where the data contract is established.

**Relevant requirements**

- No synthetic figures.
- Real operational/financial truth.

**Dependencies**

- M4-T01.
- DEC-039 owner dashboard contract.

**Resolved owner decision**

DEC-039 defines the home dashboard as an operational-control and
exception-visibility surface for today’s total sales, expected cash, actual
cash, cash variance, fuel/stock variance, account/credit sales, unresolved
exceptions, and shift approval/close status. The primary audience is the
owner, manager, and Supervisor subject to existing permissions. The default
scope follows existing authorized/current tenant, legal-entity, and station
conventions; no new authorization model is introduced.

**Bounded first-slice contract**

Use existing A10 read-only reporting contracts for supported sales, cash,
account-credit, and fuel/stock variance facts. Do not add tax, GL,
profitability, or other accounting calculations for presentation. Unresolved
exceptions and shift approval/close status must come from authoritative source
state; if the current read model cannot provide them, show a truthful
unavailable state and define the smallest reviewed read-model extension before
implementation. Optional sections, display ordering, station-specific cards,
and variance thresholds are bounded future settings, never a way to disable
required security, reconciliation, exception, or authorization behavior.

**Implementation notes**

- Inspect existing dashboard-real-data plan.
- Define metric source, scope, period, and unavailable semantics before UI code.

**Acceptance criteria**

- Every displayed metric has a documented data source and scope.
- The first slice uses existing A10 sources for supported facts and does not
  fabricate unsupported exception or approval values.
- Tenant/station isolation verified.
- No fake fallback values.

**Tests/verification**

- Unit/integration tests for calculations.
- Browser tests for loaded/empty/error states.

**Parallel safety**

- Individual metric groups can parallelize if they use independent modules/tables.

---

## M4-T03 — Expand Daily Operations workflow where owner semantics are confirmed — READY FOR SCOPED CONTRACT DECOMPOSITION

**Objective**

Move beyond Phase 0 composition into approved workflow depth.

**Potential areas already discussed**

- supervisor/accountability semantics,
- approved fuel,
- cash handover/banking,
- richer sign-off/approval,
- interrupted delivery/calibration/transfer handling.

**Dependencies**

- M3-T03 owner decisions are complete.
- Approval infrastructure where required for a specific workflow slice.
- M4-T01 gap audit before implementation claims are made.

**Implementation notes**

The owner/domain contract is now recorded. Decompose Daily Operations into
bounded contract slices before implementation; do not invent unresolved
accounting, ledger, tax, or approval details.

**Acceptance criteria**

- Each new write transition has authorization, audit, idempotency/error behavior, and tests.

**Parallel safety**

- Separate subdomains may parallelize after shared state-machine/approval boundaries are agreed.

---

# M5 — Phase 1: Customers, finance, expenses, and approvals

## M5-T01 — Define full customer lifecycle contract — READY FOR SPECIFICATION ONLY

**Objective**

Turn the Phase 0 read-oriented Customers surface into a reviewed lifecycle specification before write implementation.

**Questions to resolve**

- credit accounts,
- prepaid value,
- prepaid litres,
- benefits,
- limits,
- vehicles/drivers,
- statements,
- account status transitions,
- permissions and approval requirements.

The owner has fixed the delivery priority but has not supplied detailed
accounting, ledger, tax, credit-control, or authorization policy. The
specification must preserve those as explicit gates rather than guessing.

**Dependencies**

- Owner decisions are recorded in DEC-033, DEC-036, and DEC-037.

**Acceptance criteria**

- Product rules and state transitions documented.
- Existing ledger/reservation concepts reused rather than duplicated.

**Parallel safety**

- Specification can run in parallel with unrelated dashboard work.

---

## M5-T02 — Implement approved customer lifecycle writes — BLOCKED PENDING REVIEWED CONTRACT

**Objective**

Add only the lifecycle writes approved in M5-T01.

**Dependencies**

- M5-T01 reviewed specification.
- Explicit accounting/ledger/tax/credit-control/authorization contracts.
- Security/RLS review.

**Acceptance criteria**

- Tenant-safe writes.
- Auditability.
- Exact monetary/quantity semantics.
- Error/idempotency behavior defined.
- Browser and DB tests.

**Parallel safety**

- Split by independent lifecycle capability only after schema/API contracts are stable.

---

## M5-T03 — Implement expense/fixed-cost/profitability depth

**Objective**

Provide the owner-required expense, fixed-cost, and profit views/workflows using real data and reviewed accounting definitions.

**Dependencies**

- Backend gap audit.
- Owner/accounting definitions.
- Approval infrastructure if expenses require approval.

**Acceptance criteria**

- No synthetic profitability.
- Calculation definitions documented and tested.
- Tenant/period/station scoping explicit.

**Parallel safety**

- Calculation/backend and UI work can parallelize after contracts are fixed.

---

## M5-T04 — Implement reusable approval infrastructure

**Objective**

Provide a consistent approval mechanism for domains that actually require it.

**Dependencies**

- Existing parked approval-infrastructure plan.
- Confirmed domain workflows.

**Implementation notes**

Avoid a generic over-engineered workflow engine if the existing plan specifies a narrower pattern.

**Acceptance criteria**

- Explicit states/actors/permissions.
- Audit trail.
- Safe retry/idempotency.
- Domain integration tests.

**Parallel safety**

- Core approval infrastructure should land before multiple domains integrate it in parallel.

---

# M6 — Phase 1: resilience, settings, alerts, and operations tooling

## M6-T01 — Editable settings with explicit authorization

**Objective**

Turn currently read-only/contextual settings surfaces into approved editable settings where required.

**Dependencies**

- Final settings requirements and permission model.

**Acceptance criteria**

- Authorized edits only.
- Validation and audit behavior.
- Clear error/retry states.

**Parallel safety**

- Independent setting groups may parallelize once permission rules are shared.

---

## M6-T02 — Offline/interrupted draft strategy

**Objective**

Support interrupted operational workflows without inventing unsafe reconciliation behavior.

**Dependencies**

- Confirmed workflows that need offline/interrupted support.
- Conflict/idempotency strategy.

**Implementation notes**

This is a data-consistency feature, not only a frontend cache feature. Define server reconciliation before implementing local persistence.

**Acceptance criteria**

- Clear draft ownership/versioning.
- Conflict behavior documented.
- No duplicate financial/operational posting on retry.
- Recovery tests.

**Parallel safety**

- Architecture/specification can parallelize with alerts; implementation should wait for domain write contracts.

---

## M6-T03 — Alerts / Action Center

**Objective**

Surface actionable operational exceptions using real conditions.

**Dependencies**

- Stable real metrics/state transitions from earlier milestones.

**Acceptance criteria**

- Each alert has an explicit trigger, scope, lifecycle, and destination action.
- No fabricated urgency/metrics.
- Tenant-safe and tested.

**Parallel safety**

- Alert families can parallelize after shared event/state conventions exist.

---

## M6-T04 — Reports/exports expansion

**Objective**

Expand reporting/export behavior around confirmed owner needs and established calculations.

**Dependencies**

- M4/M5 data contracts.

**Acceptance criteria**

- Report definitions and filters documented.
- Export data matches on-screen/report contract.
- Exact decimal/date/time semantics preserved.

**Parallel safety**

- Separate reports can parallelize if calculation/data-source contracts are independent.

---

## 4. Parallelization map

### Safe current parallelism

- M0-T01/M0-T02 access-preflight work can run separately from M1 application candidate work.
- M1-T01 Customers precision integration can run separately from M1-T02 Daily Ops timezone review when isolated worktrees are used.
- M4-T03 scoped Daily Operations contract decomposition and M5-T01 customer
  lifecycle specification can proceed in isolated workstreams while M0-T03
  remains gated; neither authorizes production access or write implementation
  before its remaining contracts are reviewed.
- Once M1-T03 freezes a candidate, M1-T04 database verification and M1-T05 browser verification can run in parallel.

### Avoid parallel edits

- Do not run multiple agents editing the same first-user operator scripts.
- Do not run multiple integrators on the same release worktree.
- Do not let UI test-remediation agents silently alter product behavior while a product agent is working on the same feature.
- Do not parallelize schema/security changes without explicit ownership and integration order.

### Review independence

For security/release-critical tasks, implementation and review should be separate agents. Review agents should inspect the actual diff/files and reproduce key static checks.

## 5. Validation matrix by task type

| Change type | Minimum expected validation |
| --- | --- |
| UI composition | focused unit, relevant browser/E2E, responsive, accessibility, typecheck/lint |
| API/query | unit, real DB integration where feasible, tenant isolation, typecheck/lint |
| Decimal/financial calculation | exact-value unit + DB integration; avoid lossy numeric conversion |
| DB migration | migration on fresh DB, schema check, ownership/RLS/ACL tests, integration suite |
| Security/preflight | targeted adversarial tests, static catalog assertions, independent review |
| Auth/provisioning | dry-run/negative tests, cleanup proof, explicit human approval before production mutation |
| Release integration | full relevant CI, diff review, deployment SHA verification, smoke |

## 6. Definition of a completed task

A task in this plan is complete only when:

1. the intended implementation is present,
2. acceptance criteria are checked,
3. relevant tests are added/updated,
4. relevant existing tests pass,
5. type/lint/format/build checks pass where applicable,
6. security/tenant behavior is revalidated where affected,
7. no unrelated changes are bundled,
8. any required independent review is green,
9. status/documentation is updated if the task changes project truth,
10. the agent reports residual risks/blockers accurately.

## 7. Tasks that must not be invented from this plan

This plan does not authorize an agent to:

- create new production roles merely for diagnostics,
- redesign the auth model,
- replace RLS with application-only filtering,
- add a new accounting/GL model,
- invent tax rules,
- invent approved-fuel/cash/supervisor semantics,
- add provider integrations without a specified contract,
- introduce synthetic dashboard metrics,
- skip independent review for release-critical security changes.

When a required domain decision is missing, mark the task blocked with `TODO — Requires confirmation` rather than guessing.
