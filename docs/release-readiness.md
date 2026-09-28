# Release readiness ledger

**Scope:** current RC at `6b85ae5`
**Last reconciled:** 2026-09-28
**Classification:** operational release record; it does not change domain, accounting, authentication, MFA, RLS, authorization, migration, reporting, or settlement behavior.

## Gate status

| Gate | Status | Evidence or owner action |
| --- | --- | --- |
| Merged implementation baseline | **RECORDED** | `docs/implementation-status.md`; current integration tip `6b85ae5`. |
| Repository quality gate | **DEFINED** | `.github/workflows/ci.yml`; attach the CI run for the RC commit. |
| Authenticated staging smoke | **DEFERRED** | Requires staging URL, deployment secrets, synthetic database records, and an approved operator. Use [`staging-auth-smoke-bootstrap.md`](runbooks/staging-auth-smoke-bootstrap.md), [`STAGING_SMOKE.md`](platform/STAGING_SMOKE.md), and the normal sign-in flow. |
| Cross-module staging journeys | **DEFERRED** | Exercise station/day/shift, reconciliation approval, inventory/costing evidence, cash/provider distinction, reporting, and permission-denial paths with synthetic data. |
| Tenant-isolation verification on deployed staging | **DEFERRED** | Prove Tenant A cannot read, write, link, export, or process Tenant B through application and job paths. Do not use production data. |
| Backup/restore drill | **DATABASE DRILL COMPLETE; APP READINESS BLOCKED** | Lane 4 isolated PITR restore and restored-DB integrity/security validation are complete. Local app-to-restored-DB readiness is not verified; see [`backup-restore.md`](runbooks/backup-restore.md). |
| R2 deleted-object recovery | **NOT AVAILABLE; OPEN GAP** | Current staging configuration does not provide deleted-object recovery; a synthetic put/copy round-trip is not recovery evidence. |
| Performance verification | **PROCEDURE READY; EXECUTION OPEN** | Follow [`staging-performance-verification.md`](runbooks/staging-performance-verification.md) and record p50/p95 results against Blueprint planning goals. |
| Monitoring and alert routing | **EXPECTATIONS RECORDED; INTEGRATION OPEN** | Follow [`observability.md`](runbooks/observability.md); connect the deployed platform to the approved log/alert destination. |
| Incident and app rollback path | **DOCUMENTED** | [`incident-response.md`](runbooks/incident-response.md) and [`deployment.md`](runbooks/deployment.md). Provider-specific console access remains an owner prerequisite. |
| Key rotation | **OPEN FOLLOW-UP** | [`key-rotation.md`](runbooks/key-rotation.md) needs provider-specific rotation and verification evidence. |
| Tenant-scoped recovery | **OPEN FOLLOW-UP** | [`tenant-recovery.md`](runbooks/tenant-recovery.md) needs an approved isolated-restore/extract/repair exercise. |
| Client/accounting/onboarding inputs | **EXTERNAL GATE** | Use the existing onboarding workbook and the confirmation register in the Blueprint; do not invent values. |

## Lane 4 recovery evidence

| Check | Result |
| --- | --- |
| Database PITR isolated restore drill | **COMPLETE** — temporary Neon recovery branch `lane4-restore-drill-20260928` remains available and auto-expires after one day. |
| Restored DB integrity/security validation | **COMPLETE** — independently validated through Neon SQL Editor, including migrations, hierarchy, permissions, lineage, audit evidence, RLS/policies, and checksums. |
| Local app process startup | **VERIFIED** — local Next.js instance started against the recovery-branch `DATABASE_URL`. |
| `/api/health` | **HTTP 200**. |
| `/api/readiness` | **HTTP 503**; response reported database `unavailable`; the DB check took approximately 22.8 seconds. |
| App-to-restored-DB readiness | **BLOCKED / NOT VERIFIED** — this is not classified as a restored-database failure. It is consistent with the previously observed local raw PostgreSQL transport limitation, but no definitive root cause is recorded without a captured connection exception. |
| Side-effect scope | No auth, POST, financial, R2, email, cron, migration, or other write-capable route was invoked. The recovery URL was cleared afterward. |
| RPO ≤15 minutes | **NOT DEMONSTRATED BY THIS DRILL**. |
| Full RTO ≤4 hours | **NOT DEMONSTRATED**. |

This evidence does not establish application connectivity to the recovered
branch and does not convert the R2 deleted-object recovery gap into a pass.

## Deferred authenticated staging gate

The gate is deferred because this repository task has no staging deployment
credentials, staging URL, provider console access, or approved synthetic-data
operator. That is an external execution dependency, not permission to weaken
authentication or seed production.

When access is granted, record one evidence bundle containing:

- deployment identifier, commit, environment, operator, UTC start/end times;
- check-only and bootstrap output from the staging auth runbook, without
  passwords, cookies, tokens, or sensitive identifiers;
- normal HTTPS sign-in evidence, including the configured authenticated setup
  and step-up/MFA paths as deployed;
- successful `OpenBusinessDay` and `StartShift` smoke results, followed by
  proof that temporary grants expire;
- platform storage/email smoke results when those adapters are configured;
- cross-module workflow, tenant-isolation, permission-denial, and error-state
  results; and
- links to performance, restore, logs, and incident-test evidence.

Do not create financial data in the auth-bootstrap smoke unless the staging
test plan explicitly expands the scope and names the cleanup owner.

## Known post-release follow-ups

These are not silently converted into implementation work by the RC:

1. Connect production-grade structured log collection, dashboards, alert
   routing, retention, and on-call ownership.
2. Resolve the blocked local app-to-restored-DB connectivity check and establish
   a supported R2 deleted-object recovery procedure before claiming complete
   recovery readiness. Do not claim the RPO/RTO planning targets from this
   drill.
3. Complete the staging performance run with representative synthetic data and
   investigate any regression before pilot.
4. Complete key rotation and tenant-scoped recovery exercises with provider
   owners.
5. Decide, with signed scope, which deferred domain capabilities are required:
   expenses, exports/artifacts, full profitability, customer commercial policy,
   inventory transfer/calibration, offline synchronization, and external APIs.
6. Capture pilot station/master data, opening positions, accountant/tax
   decisions, training/UAT evidence, shadow-operation results, and pilot exit
   approval.

## Release-blocker reconciliation

There is no repository-only blocker preventing this documentation slice from
being completed. The following are genuine gates for the next environment:

- inability to establish the separate database role topology before deployment;
- missing staging access for the authenticated verification;
- failure of tenant-isolation/security checks or critical financial workflow
  tests;
- no recoverable backup or failed restore drill;
- an unreviewed performance or availability regression; or
- missing client/accounting approval for a required pilot behavior.

Unknown station, bank, tank, supplier, customer, threshold, and opening-position
values remain onboarding/cutover inputs, not software-development blockers.
