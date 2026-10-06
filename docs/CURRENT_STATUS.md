# Shanda Fuel — Current Status

## 1. Snapshot

This file is a conservative status snapshot based on the latest project conversation. It is intentionally stricter than a progress report: discussion alone does not count as implementation, and implementation alone does not count as release completion.

Status labels:

- **VERIFIED COMPLETE** — directly validated by tests/review/production evidence.
- **REPORTED COMPLETE** — an implementation agent reported completion but final independent/integration evidence is not yet complete.
- **PARTIAL** — meaningful work exists, but a required gate remains.
- **NOT STARTED** — no implementation evidence.
- **UNKNOWN** — insufficient evidence.

## 2. Repository and release identity

### VERIFIED COMPLETE

- PR #95 merged the documentation-only canonical knowledge-base change.
- PR #96 merged the documentation-only canonical status synchronization at
  main `8b9d163763cb4fab52b96aed225f7553f0069e65`.
- The canonical knowledge base is `AGENTS.md`,
  `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
  `docs/CURRENT_STATUS.md`, and `docs/IMPLEMENTATION_PLAN.md`.
- No competing active repository-wide source of truth remains, and the
  temporary nested knowledge-base copy is absent.
- The documentation merge did not change deployed application behavior.

## 3. Production application baseline

### VERIFIED COMPLETE

- The production application release before the documentation-only merge was
  `53cf4382487271bed68160386cc41c447ab542e2`.
- The production Vercel deployment for that application release was reported
  READY and the production alias `https://fuel.shandahr.com` was verified.
- Do not treat the documentation merge SHA as a deployed application release.
- PR #94, which added the PostgreSQL 18 provider-membership preflight recognition/tests, was merged before this release.
- Production migration `0021_security_first_user_provisioning.sql` is applied
  exactly once with approved SHA-256
  `a51bee68bbfec23cfeabaa7a54039aca3672b7e8b4e386a5d2c36b01bd5d7caa`.
- Production PostgreSQL is Neon PostgreSQL 18.6.
- Security checks after migration reported:
  - Force RLS checks passing,
  - helper ACL checks passing,
  - fixed security-definer search paths passing,
  - no PUBLIC bootstrap access,
  - no app_runtime bootstrap access,
  - bootstrap sentinel not consumed,
  - no real production user created yet.

### Important release constraint

Production migrations are not automatic. A deployed web release must not be assumed to imply a database migration occurred.

## 4. First-user production access

### VERIFIED COMPLETE

- Migration 0021 security model has been validated locally on PostgreSQL 18.6.
- Exact Neon/PostgreSQL 18 provider membership behavior has been reproduced and covered by preflight tests.
- The selected temporary credential model is an ephemeral password assigned to `first_user_provisioner` and restored to `PASSWORD NULL` afterward.
- The runbook/operator procedure includes mandatory cleanup on both normal and abnormal exit.
- Security evidence is intentionally split across migration owner, provisioner, runtime, and supplemental diagnostics principals.
- Production connection handling was corrected for the actual Homebrew `psql` 16 behavior:
  - URI parsed into process-local libpq environment variables,
  - URL/password excluded from argv/files/logs,
  - duplicate query keys rejected,
  - `ssl`/`sslmode` conflicts rejected,
  - malformed/empty/out-of-range ports rejected,
  - unsupported parameters rejected,
  - parser and secret handling received independent Access Review GREEN.
- The read-only production role-discovery runner received Access Review GREEN.
- Human role discovery was executed against production and returned zero eligible unrelated-role candidates.
- The former unrelated-role spot check has been replaced by strictly stronger
  exhaustive `pg_proc` ACL-grantee validation, and the final Access Review is
  GREEN.

Verified production role state before provisioning:

- `first_user_provisioner` has LOGIN, NOSUPERUSER, NOINHERIT, NOCREATEROLE,
  NOCREATEDB, NOREPLICATION, and NOBYPASSRLS; its password is NULL.
- The approved Neon membership is `migration_owner` →
  `first_user_provisioner`, granted by `cloud_admin`, with `admin=true`,
  `inherit=false`, and `set=false`.
- No temporary provisioner password was assigned by the latest failed Stage 1
  run.

The actual operator client is Homebrew `psql 16.15`. Human local validation
against PostgreSQL 18.6 verified success exit code 0, deliberate failure exit
code 3, fail-closed `ON_ERROR_STOP=1` behavior, and no false PASS continuation.

The Stage 1 safety-hardening diagnostic is locally safety-verified: its
process-local DEC-011 bootstrap handling, secret safeguards, read-only guard,
and psql 16.15 intentional-refusal path were validated without agent contact
with production. The initial version was subsequently executed by the
approved human operator as the read-only production evidence run described
below.

The human has now established the authoritative independent non-secret
production target invariant in DEC-031 from authenticated Neon control-plane
metadata. The diagnostic incorporates an exact pre-connect `PGHOST` assertion
for the approved endpoint and preserves server-side identity, version,
read-only, migration, membership, RLS, and policy checks. The final
independent security review is GREEN. The approved human operator has now
executed the diagnostic read-only against production; Stage 1 has not been
rerun and no production mutation was performed.

### BLOCKED / IN PROGRESS

- The latest Stage 1 production run passed exact checkout/SHA and local
  migration-hash checks, migration-owner identity, provisioner attributes,
  password-NULL state, provider membership/capability checks, DB/schema
  capability checks, runtime-role assertions, migration 0021 exactly once,
  and nine expected relations with RLS plus FORCE RLS enabled.
- The run printed the production policy catalog and then failed closed with
  `FAIL: RLS/policy preflight failed` and `ERROR: division by zero`.
- The approved human operator subsequently executed the reviewed read-only
  diagnostic from branch `codex/stage1-preflight-calibration` at commit
  `6d436fe0dc35d31a8307de68aac683a22c3922e9`. It completed with exit status
  `0`, confirmed both session identities as `migration_owner`, PostgreSQL
  `18.6` (`server_version_num=180006`), `shanda_fuel`, read-only mode, the
  approved migration fingerprint, the approved provider membership, and
  `relrowsecurity=true` plus `relforcerowsecurity=true` for all nine inspected
  relations. It returned 19 policy rows, including the nine expected
  `first_user_provisioning_definer` policies with the expected
  `CURRENT_USER = 'migration_owner'::name` qualifying expression, and ended
  with `ROLLBACK` without SQL errors.
- The exact historical Stage 1 policy assertion is recoverable in the
  approved local operator tooling. Its `policy_checks_ok` value requires both
  nine exact rows (including exact `qual` and `with_check` text) and the
  absence of any other `first_user_provisioning_%` policy anywhere in
  `pg_policies`; its false branch intentionally executes `SELECT 1 / 0`.
  The supplied diagnostic summary does not include the derived boolean, the
  complete raw policy rows, or the original SQLSTATE/statement context.
  Therefore the inspected invariants show no obvious production drift, but
  the division-by-zero root cause remains unknown and is not yet classified
  as either drift or a tooling/normalization defect.
- A follow-up repo-local diagnostic now reproduces those exact two historical
  subconditions, returns their derived boolean separately, searches globally
  for every `first_user_provisioning_%` policy, and exposes normalized plus
  underlying catalog policy representations. It is prepared for human
  execution only; it has not yet been executed, and Stage 1 must not be rerun
  until its evidence is reviewed.
- Repository inspection established that the operator-side Stage 1 policy
  assertion that raised `division by zero` is not committed in this checkout;
  the committed migration, helper, and policy tests contain no corresponding
  division operation. The approved diagnostic captured the policy catalog but
  not the original failing statement context or the derived assertion boolean.
  The Stage 1 root cause remains unknown; this does not establish production
  drift or an assertion/tooling defect and does not make Stage 1 pass.
- The independent production target invariant is now established and recorded
  in DEC-031. The diagnostic must compare the decoded process-local `PGHOST`
  against the exact approved endpoint before `psql` executes; `APP_ENV`,
  `PGDATABASE`, `PGPORT`, the migration hash, role membership, and server
  version remain defence-in-depth only.
- Diagnostic incorporation is complete locally and the final independent
  security review is GREEN. The initial read-only diagnostic was executed by
  the approved human operator; the updated predicate-level follow-up remains
  human-execution-only. Agents must not execute production procedures.
- The diagnostic safety procedure and its psql 16.15 fail-closed behavior were
  verified locally. The approved human operator has now contacted production
  only through that read-only diagnostic; no agent has contacted production,
  Stage 1 has not been rerun, and no production mutation was performed.
- The failed run stopped before temporary provisioner password assignment.
  No cleanup is required from that run, no first user exists, Stage 2 has not
  run, real-provisioning approval has not been given, and authenticated
  production smoke has not happened.
- Stage 2 has **not** been run against production.
- No explicit human approval for real first-user provisioning has been recorded.
- No real first production user has been created.
- Authenticated production smoke (login/context/protected route/logout/re-login) has not been completed.

## 5. UI shell / PR #92 work

### REPORTED COMPLETE / PREPARED FOR INTEGRATION

A local integration candidate includes the reviewed PR #92 UI polish behavior, including:

- shared shell headings,
- removal of duplicate body titles where the shell owns the title,
- navigation groups closed by default,
- operation-child opening behavior,
- hidden children inert,
- route-title consistency,
- account-context clipping/wrapping fixes,
- responsive light/dark behavior.

Known test-only fixes from the earlier simulation were incorporated into local candidates.

### Not yet production-complete

PR #92 has not been treated as finally integrated/deployed in the latest production release state described here. Final integration must preserve current main’s first-user/security files and safeguards.

## 6. Customers Phase 0

### VERIFIED FUNCTIONAL BEHAVIOR

Customers Phase 0 implementation exists and has been exercised in local integration candidates with:

- Finance navigation entry,
- command/search entry,
- responsive list/detail,
- search,
- type/status,
- balances,
- prepaid litres,
- reservations,
- recent ledger/activity,
- tenant-authorised read API,
- loading/empty/no-match/permission/error handling.

Security/database evidence:

- tenant isolation passed,
- no cross-tenant leakage was observed,
- no new migration/RLS/auth/write semantics were introduced for Customers.

### A8 decimal-contract issue — VERIFIED FIX

A Customers summary integration assertion exposed monetary scale behavior.

Current confirmed contract:

- money uses `NUMERIC(20,4)`,
- derived balances serialize with four decimal places,
- verified example: `"125.3750"`.

Verification after the product fix reported:

- PostgreSQL 18.6 dedicated cluster used,
- 22 migrations passed,
- A8 integration: 1/1 PASS,
- real PostgreSQL customer summary coverage: PASS,
- tenant isolation: PASS,
- broader non-provisioning integration suite: 96 passed / 0 failed / 17 intentional provisioning skips,
- Customers unit tests: 15/15 PASS,
- lint: PASS,
- direct TypeScript check: PASS.

### PARTIAL integration state

The A8 product fix exists in the clean candidate worktree but final release integration/commit/deploy evidence is still pending. An unrelated existing edit in `src/platform/db/client.ts` was observed and must not be accidentally included unless separately justified/reviewed.

## 7. A3 meter-exception behavior

### VERIFIED COMPLETE — no product defect

Initial A3 failures (HTTP 500) were reproduced on both the candidate and exact main under a bad local harness.

Root cause:

- local migrations had been applied under the wrong role,
- a security-definer meter-exception trigger therefore had the wrong owner,
- PostgreSQL correctly rejected the operation.

With the expected PostgreSQL 18.6, UTC, bootstrap-role, migration-owner, and fixture setup:

- candidate focused A3: 5/5 PASS,
- exact main focused A3: 5/5 PASS.

Classification: **HARNESS/ENVIRONMENT**, not a candidate regression. No product fix is required.

## 8. Daily Operations Phase 0

### VERIFIED scope alignment

The Phase 0 Daily Operations scope is primarily UI/composition/workflow alignment, not new schema/accounting/ledger behavior.

The owner-workflow crosswalk includes:

- station/date/shift,
- supervisor/attendants,
- pump readings/litres/price,
- account/POS/EcoCash/approved fuel,
- expenses,
- dips/deliveries,
- reconciliation/variance,
- cash/banking/sign-off.

### Timezone correctness P0 — FIX READY / VERIFIED IN ISOLATION

A genuine P0 correctness issue was identified: shift times used browser-local `toLocaleTimeString` rather than station timezone.

A scoped fix was implemented and verified in isolation using the existing
`operation.station.timezone` / `app.stations.timezone` source.

Reported verification:

- no schema/migration change,
- no guessed timezone,
- invalid/missing timezone renders `—`,
- adjacent timestamps audited,
- focused tests 12/12 PASS,
- Daily Ops E2E 2/2 PASS,
- typecheck PASS,
- lint PASS,
- build PASS.

### PARTIAL

A clean timezone-only integration review/cherry-pick step is still required so
unrelated worktree edits do not leak into the release candidate. It is not
merged or deployed.

## 9. Clean Phase 0 integration candidate

### REPORTED COMPLETE / LOCAL CANDIDATE

A clean isolated candidate was created at documented HEAD:

`06447e1812d30d85532a593389bf35ab10e82422`

Base:

`53cf4382487271bed68160386cc41c447ab542e2`

It was reported to contain:

- PR #92 product work,
- the two known PR #92 test-only fixes,
- Customers implementation,
- Customers-present shell expectations,
- Daily Ops stale E2E expectation fixes,
- real PostgreSQL customer-summary coverage,
- no unrelated A12 delta.

Reported local checks at candidate creation:

- Prettier PASS,
- ESLint PASS,
- TypeScript PASS,
- focused unit PASS,
- full unit suite 513 tests PASS,
- build PASS.

### Important caveat

Subsequent verified A8 and timezone changes are newer than the clean candidate HEAD above unless/until they are deliberately integrated and committed. Do not assume that SHA alone contains every latest fix.

## 10. Integration/browser validation

### VERIFIED

Across the prepared candidate work:

- UI/navigation checks passed,
- shell consistency passed 14/14,
- Customers E2E passed 2/2,
- accessibility checks passed,
- mobile/responsive checks passed,
- A8/database verification passed after the decimal fix,
- broader non-provisioning integration suite passed 96/0 with 17 intentional provisioning-only skips.

### PARTIAL / pending final combined verification

After the A8 fix and Daily Ops timezone patch are cleanly integrated together, the final release candidate still needs a combined gate including:

- full relevant unit suite,
- integration/database checks,
- typecheck,
- lint/format,
- build,
- browser/E2E,
- accessibility,
- responsive checks,
- security/runtime-role checks as applicable.

## 11. Owner readiness

### VERIFIED assessment

A read-only Owner Gate audit found the Phase 0 owner journey complete enough for final QA.

Covered areas include:

- dashboard/navigation,
- Daily Operations,
- Customers,
- Finance/reporting surfaces,
- empty/context-required states,
- responsive shell.

### BLOCKED for handoff

Final owner handoff is not green because the following remain open:

1. diagnose the latest Stage 1 RLS/policy preflight failure and rerun Stage 1,
2. choose legitimate production scope and complete the Stage 2 read-only dry run,
3. obtain explicit approval and provision the real first user,
4. run authenticated production smoke,
5. integrate PR #92 and Customers plus the verified A8 fix,
6. integrate and review the Daily Operations timezone fix,
7. run final release gates, deploy, and verify the exact production SHA,
8. complete owner acceptance and remediate any P0/P1 finding.

Owner handoff must use only:

`https://fuel.shandahr.com`

## 12. Observability

### PARTIAL / temporary release exception

- Local observability definitions/panels/tests are reported PASS.
- Desired native production semantics remain constrained by the current Vercel plan.
- A paid alternative was declined.
- Technical status remains blocked/exception, not PASS.

## 13. Rate limiting

### PARTIAL / evidence exception

- Implementation is reported PASS.
- A staging E2E path is blocked because an upstream provider intercepts the relevant request before the application’s target behavior can be observed.
- This must remain an evidence exception, not be relabelled PASS.

## 14. Dependency advisory

### PARTIAL / time-bounded exception

A dev-only transitive advisory affects `braces <= 3.0.3` and had no fixed upstream version at the documented snapshot.

- production-only audit had no high/critical finding,
- a narrow CI exception exists with a review date,
- future agents should re-check whether an upstream fix is available rather than treating the exception as permanent.

## 15. Known bugs/issues

### Active

1. **Production Stage 1 fails closed in the RLS/policy preflight** with a
   division-by-zero error; the root cause remains unknown. The reviewed
   diagnostic has now been executed by the approved human operator and
   collected read-only evidence. The inspected production invariants show no
   obvious drift, but the exact failing predicate and original SQLSTATE/
   statement context are still missing, so Stage 1 must not be rerun yet.
2. **Daily Operations timezone fix is not yet cleanly integrated into the final candidate** even though the scoped implementation/tests are green.
3. **A8 decimal fix is verified but still needs final clean release-candidate integration.**

### Closed / not product bugs

- A3 meter-exception 500s — closed as harness/ownership issue.
- psql 16 URI-via-PGDATABASE behavior — fixed by reviewed process-local libpq parsing.

## 16. Technical debt / documentation debt

- Existing owner-readiness documents contain stale historical SHAs and pre-candidate status.
- Some implementation-status/parallel-execution/traceability documentation references older base SHAs.
- Local integration harness setup is ownership-sensitive and should be documented clearly to avoid future false regressions.
- The latest Stage 1 RLS/policy preflight failure needs final predicate-level
  classification before a reviewed rerun. The exhaustive function
  ACL-grantee validation is already Access Review GREEN. The local-only
  diagnostic procedure contains the exact human-approved endpoint guard and
  its initial read-only production evidence was collected successfully. The
  predicate-level follow-up is prepared but not yet human-executed; the
  complete policy predicate results and original SQLSTATE/statement context
  remain unavailable.

## 17. Owner-resolved product decisions

The owner has resolved the previously open Daily Operations, account-sale,
approved-fuel, cash-custody, customer-account sequencing, workflow, and
close-summary questions. Durable decisions are recorded in DEC-032 through
DEC-038 and integrated into `PRODUCT_SPEC.md` and `ARCHITECTURE.md`.

The fixed semantics include distinct operator/submitter and Supervisor
approver actors, required customer identity for account sales, auditable
approved-fuel attribution, core cash custody evidence, exception-first close
summaries, and the stated Phase 1 customer-account priority order.

## 18. Remaining product and technical decisions

The following remain unresolved and must not be silently invented:

- complete human application role/permission matrix;
- detailed accounting, ledger, tax, credit-control, and authorization policies
  for customer, approved-fuel, cash, and close workflows;
- formal performance/SLO targets;
- which Phase 1 provider integrations are required first and their exact
  contracts;
- cause of the Stage 1 RLS/policy preflight division-by-zero failure and the
  exact predicate result that selected its intentional failure branch;
- exact current production release SHA after the next integrated release.

### Newly unblocked planning work

- M3-T03 owner-decision documentation is VERIFIED COMPLETE.
- M4-T02 remains WAITING_HUMAN_PRODUCT_DECISION: the repository has an
  established A10 reporting contract, but no authoritative home-dashboard
  metric set, default scope, period/date basis, comparison behavior, or
  attention-section contract. Dashboard implementation must not infer these
  choices from `/reports` or sample UI data.
- M4-T03 is READY FOR SCOPED CONTRACT DECOMPOSITION; implementation still
  requires the relevant approval and accounting/security contracts.
- M5-T01 is READY FOR SPECIFICATION ONLY; M5-T02 customer writes remain
  blocked pending reviewed accounting and security contracts.

These decisions do not alter the M0-T03 production diagnostic gate.

## 19. Open technical questions

### UNRESOLVED / needs verification

- Cause of the Stage 1 RLS/policy preflight division-by-zero failure and the
  exact predicate result that selected its intentional failure branch.
- Exact current production release SHA after the next integrated release.
- Whether the dev-only dependency advisory now has an upstream fix.
- Whether hosting/plan changes alter the observability exception.
- Full background-job topology and current production `job_runtime` presence.

## 20. Not started / deferred Phase 1 work

The following are explicitly not Phase 0 completion requirements unless promoted by a new human instruction:

- full customer lifecycle/write policy,
- richer approved-fuel approval policy,
- complete expense approval/allocation lifecycle,
- full cash custody/banking workflow,
- provider integrations,
- interrupted delivery/calibration/transfer workflows,
- full profitability/exports/Action Center,
- offline sync/interrupted drafts,
- alerts,
- full editable settings behavior,
- general ledger,
- tax treatment.

## 21. Current critical path / next recommended work

Use this order unless a current human instruction changes it:

1. Have the approved human operator execute the updated predicate-level,
   read-only policy diagnostic without rerunning Stage 1.
2. Obtain the missing predicate-level evidence and original SQLSTATE/statement
   context, then determine production drift versus assertion/normalization/
   tooling defect.
3. Access Review any tooling-only correction.
4. Rerun Stage 1 from the beginning only after the correction is reviewed and
   human-approved.
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

## 22. Things agents must not assume

- Do not assume a discussed feature is implemented.
- Do not assume the clean candidate HEAD includes later uncommitted A8/timezone fixes.
- Do not assume an intentionally skipped provisioning suite is a passing provisioning suite.
- Do not assume `job_runtime` exists in production.
- Do not assume the latest Stage 1 run passed; it failed closed at the RLS/policy preflight.
- Do not assume a temporary provisioner password was set by the failed Stage 1 run.
- Do not treat the earlier `\\quit 1`-ignored run as valid evidence.
- Do not assume a Vercel deploy runs database migrations.
- Do not assume environment-specific HTTP 500s are product defects without baseline/harness comparison.
- Do not mark observability or rate-limit evidence exceptions as PASS.
