# Shanda Fuel — Current Status

## 1. Snapshot

This file is a conservative status snapshot based on the latest project conversation. It is intentionally stricter than a progress report: discussion alone does not count as implementation, and implementation alone does not count as release completion.

Status labels:

- **VERIFIED COMPLETE** — directly validated by tests/review/production evidence.
- **REPORTED COMPLETE** — an implementation agent reported completion but final independent/integration evidence is not yet complete.
- **PARTIAL** — meaningful work exists, but a required gate remains.
- **NOT STARTED** — no implementation evidence.
- **UNKNOWN** — insufficient evidence.

## 2. Release identity and production baseline

### VERIFIED COMPLETE

- Production/main release baseline is `53cf4382487271bed68160386cc41c447ab542e2` at the documented snapshot.
- The production Vercel deployment for that release was reported READY and the production alias `https://fuel.shandahr.com` was verified.
- PR #94, which added the PostgreSQL 18 provider-membership preflight recognition/tests, was merged before this release.
- Production migration `0021_security_first_user_provisioning.sql` is applied exactly once with the reviewed hash.
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

## 3. First-user production access

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

### BLOCKED / IN PROGRESS

- The current Stage 1 preflight still requires `SF_UNRELATED_ROLE` for a single negative helper-EXECUTE spot check.
- Production has no existing role that satisfies the reviewed unrelated-role criteria.
- A review determined that simply removing this probe would weaken current function ACL coverage because current checks are not exhaustive for every possible grantee.
- The current proposed resolution is to replace the spot check with an exhaustive `pg_proc` ACL-grantee assertion that rejects every unexpected `EXECUTE` grantee. This work is **PENDING REVIEW** and must not be treated as complete until implemented and Access Review is GREEN.
- Stage 1 has therefore **not** completed.
- Stage 2 has **not** been run against production.
- No explicit human approval for real first-user provisioning has been recorded.
- No real first production user has been created.
- Authenticated production smoke (login/context/protected route/logout/re-login) has not been completed.

## 4. UI shell / PR #92 work

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

## 5. Customers Phase 0

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

## 6. A3 meter-exception behavior

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

## 7. Daily Operations Phase 0

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

### Timezone correctness P0 — REPORTED FIX READY

A genuine P0 correctness issue was identified: shift times used browser-local `toLocaleTimeString` rather than station timezone.

A scoped fix was implemented in an isolated worktree using the existing `operation.station.timezone` / `app.stations.timezone` source.

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

A clean timezone-only integration review/cherry-pick step is still required so unrelated worktree edits do not leak into the release candidate.

## 8. Clean Phase 0 integration candidate

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

## 9. Integration/browser validation

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

## 10. Owner readiness

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

1. first-user production access/provisioning/login,
2. exhaustive ACL preflight resolution and Stage 1/Stage 2 execution,
3. clean integration of the verified A8 fix,
4. clean integration/review of the Daily Ops timezone fix,
5. final release integration/deploy and production SHA verification,
6. authenticated production smoke,
7. final 15–25 minute owner acceptance review,
8. remediation of any P0/P1 found in that final review.

Owner handoff must use only:

`https://fuel.shandahr.com`

## 11. Observability

### PARTIAL / temporary release exception

- Local observability definitions/panels/tests are reported PASS.
- Desired native production semantics remain constrained by the current Vercel plan.
- A paid alternative was declined.
- Technical status remains blocked/exception, not PASS.

## 12. Rate limiting

### PARTIAL / evidence exception

- Implementation is reported PASS.
- A staging E2E path is blocked because an upstream provider intercepts the relevant request before the application’s target behavior can be observed.
- This must remain an evidence exception, not be relabelled PASS.

## 13. Dependency advisory

### PARTIAL / time-bounded exception

A dev-only transitive advisory affects `braces <= 3.0.3` and had no fixed upstream version at the documented snapshot.

- production-only audit had no high/critical finding,
- a narrow CI exception exists with a review date,
- future agents should re-check whether an upstream fix is available rather than treating the exception as permanent.

## 14. Known bugs/issues

### Active

1. **Production first-user preflight cannot currently proceed past the unrelated-role requirement** because production has no eligible unrelated role and current ACL checks are not exhaustive enough to remove the probe without replacement.
2. **Daily Operations timezone fix is not yet cleanly integrated into the final candidate** even though the scoped implementation/tests are green.
3. **A8 decimal fix is verified but still needs final clean release-candidate integration.**

### Closed / not product bugs

- A3 meter-exception 500s — closed as harness/ownership issue.
- psql 16 URI-via-PGDATABASE behavior — fixed by reviewed process-local libpq parsing.

## 15. Technical debt / documentation debt

- Existing owner-readiness documents contain stale historical SHAs and pre-candidate status.
- Some implementation-status/parallel-execution/traceability documentation references older base SHAs.
- Local integration harness setup is ownership-sensitive and should be documented clearly to avoid future false regressions.
- The first-user preflight should move from a single unrelated-role spot check to exhaustive function ACL-grantee verification if/when the pending patch is approved.

## 16. Open product questions

### UNRESOLVED

- Exact meaning of “supervisor” in Daily Operations accountability.
- Required customer/account reference for account sales and when it is selected.
- Approved-fuel authorization/reference/recipient rules and terminology.
- Minimum cash handover/deposit/bank-reference requirements.
- Priority/order for the fuller customer lifecycle: credit, prepaid value, prepaid litres, benefits, limits, vehicles/drivers, statements.
- Final human application role/permission matrix.

These must not be silently converted into requirements.

## 17. Open technical questions

### UNRESOLVED / needs verification

- Final reviewed implementation of exhaustive function ACL-grantee detection.
- Exact current production release SHA after the next integrated release.
- Whether the dev-only dependency advisory now has an upstream fix.
- Whether hosting/plan changes alter the observability exception.
- Full background-job topology and current production `job_runtime` presence.

## 18. Not started / deferred Phase 1 work

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

## 19. Next recommended work

Use this order unless a current human instruction changes it:

1. **Complete the exhaustive function ACL-grantee preflight change** and obtain independent Access Review GREEN.
2. **Run production Stage 1** through legitimate scope discovery.
3. **Select the legitimate tenant/legal-entity/station scope** from Stage 1 output.
4. **Run production Stage 2 read-only dry run**, asserting exactly 12 permissions, zero writes, unchanged sentinel, and credential cleanup.
5. **Obtain explicit human approval** for the real first user.
6. **Provision the real first production user** using the separately reviewed real-provision procedure.
7. **Run authenticated production smoke**: login, authorised context, protected route, logout, re-login.
8. **Integrate the verified A8 fix** into the clean release candidate.
9. **Integrate the reviewed timezone-only Daily Operations fix** without unrelated worktree changes.
10. **Run final combined DB/CI/browser/accessibility/responsive/security gates.**
11. **Land/deploy the integrated release** and verify exact production SHA/health.
12. **Run the 15–25 minute owner acceptance checklist.**
13. **Fix only genuine P0/P1 findings**, then hand off `https://fuel.shandahr.com`.

## 20. Things agents must not assume

- Do not assume a discussed feature is implemented.
- Do not assume the clean candidate HEAD includes later uncommitted A8/timezone fixes.
- Do not assume an intentionally skipped provisioning suite is a passing provisioning suite.
- Do not assume `job_runtime` exists in production.
- Do not assume production has an unrelated role suitable for security probing; discovery proved zero candidates.
- Do not assume a Vercel deploy runs database migrations.
- Do not assume environment-specific HTTP 500s are product defects without baseline/harness comparison.
- Do not mark observability or rate-limit evidence exceptions as PASS.
