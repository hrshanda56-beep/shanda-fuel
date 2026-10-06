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

### BLOCKED / IN PROGRESS

- The latest Stage 1 production run passed exact checkout/SHA and local
  migration-hash checks, migration-owner identity, provisioner attributes,
  password-NULL state, provider membership/capability checks, DB/schema
  capability checks, runtime-role assertions, migration 0021 exactly once,
  and nine expected relations with RLS plus FORCE RLS enabled.
- The run printed the production policy catalog and then failed closed with
  `FAIL: RLS/policy preflight failed` and `ERROR: division by zero`.
- Predicate-level evidence established nine valid policies, zero exact
  policies under the historical assertion, and zero unexpected prefixed
  policies. The historical assertion compared normalized `pg_policies.cmd`
  with raw `pg_policy.polcmd`: raw `'*'` is exposed as normalized `'ALL'`,
  so the exact-policy count was zero. This is a verified preflight
  normalization bug, not observed policy drift.
- The repository-local diagnostic now asserts `pg_policies.cmd = 'ALL'` and
  has regression coverage. The external operator helper was not modified;
  its owner must apply and review the one-line correction before a human
  Stage 1 retry.
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

### PARTIAL / CI browser gate pending

The combined Phase 0 candidate has passed the local unit, integration,
typecheck, lint, format, build, browser, accessibility, mobile, runtime-role,
and PostgreSQL 18.6 lifecycle checks. The remaining release gate is the
authoritative GitHub Actions quality job: its browser run continues to show
non-deterministic Next development-server/error-page and DB-backed E2E
failures despite local reproduction passing and the configured CI retry policy
being enabled.

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

1. apply and independently review the external helper's `cmd = 'ALL'`
   correction, then rerun Stage 1,
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

### VERIFIED FOR THE CURRENT PHASE 0 CANDIDATE / time-bounded exception

The release-candidate dependency remediation updates the production-reachable
`source-map-js` and `sharp` dependency paths and moves Vitest to the patched
major line that removes the reported `tinypool` findings. The repository audit
script passes with the existing, explicitly scoped dev-only `braces@3.0.3`
exception; that exception remains time-bounded and is not a production waiver.

## 15. Known bugs/issues

### Active

1. **Production Stage 1 fails closed in the RLS/policy preflight** with a
   division-by-zero error caused by the historical `pg_policies.cmd = '*'
   assertion`; the repository-local diagnostic is corrected, but the external
   helper still needs its owner-applied correction and human retry.
2. **Daily Operations timezone and A8 decimal corrections are present in the
   overnight Phase 0 integration candidate;** final release evidence remains
   dependent on the combined-candidate gates below.

The frozen Phase 0 candidate also had an authorization-projection blocker:
the client shell received an all-visible synthetic navigation projection. The
current release candidate replaces that with a server-derived projection from
the authenticated actor and validated tenant/legal-entity/station context,
fails closed to an empty projection, and limits the synthetic projection to
the explicit non-production `APP_ENV=test` test fixture. This correction was
independently reviewed GREEN on the final candidate; that review did not
approve production release by itself. The CI quality/browser gate remains
open.

### Closed / not product bugs

- A3 meter-exception 500s — closed as harness/ownership issue.
- psql 16 URI-via-PGDATABASE behavior — fixed by reviewed process-local libpq parsing.

## 16. Technical debt / documentation debt

- Existing owner-readiness documents contain stale historical SHAs and pre-candidate status.
- Some implementation-status/parallel-execution/traceability documentation references older base SHAs.
- Local integration harness setup is ownership-sensitive and should be documented clearly to avoid future false regressions.
- The Stage 1 RLS/policy preflight normalization bug is diagnosed and the
  repository-local diagnostic is corrected; the external helper correction
  and human rerun remain open. The exhaustive function ACL-grantee validation
  is already Access Review GREEN.

## 17. Owner-resolved product decisions

The owner has resolved the previously open Daily Operations, account-sale,
approved-fuel, cash-custody, customer-account sequencing, workflow, and
close-summary questions. Durable decisions are recorded in DEC-032 through
DEC-038 and integrated into `PRODUCT_SPEC.md` and `ARCHITECTURE.md`.

The fixed semantics include distinct operator/submitter and Supervisor
approver actors, required customer identity for account sales, auditable
approved-fuel attribution, core cash custody evidence, exception-first close
summaries, the stated Phase 1 customer-account priority order, and the
operational-control purpose and authorized scope of the home dashboard. The
home-dashboard decision is recorded in DEC-039.

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
- M4-T02 is READY FOR A BOUNDED FIRST SLICE: DEC-039 fixes the operational
  headline/status areas, audience, authorized scope, and bounded
  configurability. Existing A10 contracts support the initial read-only sales,
  cash-evidence/variance, account-credit, and fuel/stock variance facts.
  Unresolved-exception and shift approval/close presentation must use
  authoritative source state or remain truthfully unavailable until a reviewed
  read-model extension exists.
- M4-T03 has a bounded contract decomposition in
  `docs/architecture/phase1-contract-decomposition.md`; individual slices
  still require reviewed command/read-model contracts before implementation.
- M5-T01 has a bounded lifecycle specification packet with its unresolved
  accounting, tax, credit-control, and authorization gates recorded; M5-T02
  customer writes remain blocked pending those reviewed contracts.

These decisions do not alter the M0-T03 production diagnostic gate.

## 19. Open technical questions

### UNRESOLVED / needs verification

- Human confirmation after the external helper correction and Stage 1 retry.
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

1. Apply and independently review the external helper's normalized
   `pg_policies.cmd = 'ALL'` assertion.
2. Complete the fresh independent security review of the corrected
   authorization projection on the combined Phase 0 candidate.
3. Confirm the dependency-audit CI job is green with the scoped dev-only
   exception and the patched dependency graph.
4. Complete the disposable PostgreSQL 18.6 lifecycle gate against the exact
   candidate.
5. Human executes the already-reviewed production Stage 1 procedure.
6. Select legitimate production scope and run the Stage 2 READ ONLY dry run.
7. Verify zero writes, sentinel unchanged, and password-NULL cleanup.
8. Obtain explicit human approval, provision the real first user, and run
   authenticated smoke.
9. FINAL RELEASE GO, merge/deploy through the approved workflow, verify the
   exact production SHA, and complete owner handoff.

## 22. Things agents must not assume

- Do not assume a discussed feature is implemented.
- Do not assume the clean candidate HEAD includes later uncommitted A8/timezone fixes.
- Do not assume an intentionally skipped provisioning suite is a passing provisioning suite.
- Do not assume `job_runtime` exists in production.
- Do not assume the latest Stage 1 run passed; it failed closed at the RLS/policy preflight because the historical assertion used raw `'*'` instead of normalized `'ALL'`.
- Do not assume a temporary provisioner password was set by the failed Stage 1 run.
- Do not treat the earlier `\\quit 1`-ignored run as valid evidence.
- Do not assume a Vercel deploy runs database migrations.
- Do not assume environment-specific HTTP 500s are product defects without baseline/harness comparison.
- Do not mark observability or rate-limit evidence exceptions as PASS.
